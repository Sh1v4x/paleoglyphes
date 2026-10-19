import { CELL_H, CELL_W } from "../config";
import { mulberry32 } from "../rng";
import type { World } from "../world/generate";
import { T, isWater } from "../world/tiles";

/**
 * Lenia (Bert Chan, 2019) : automate cellulaire continu. Chaque case vaut 0..1 ; à chaque pas elle
 * « perçoit » son voisinage par un noyau en anneau (u = K * A) et grandit si u est proche de `mu`,
 * dépérit sinon : A <- clip(A + dt * G(u)), G(u) = 2 exp(-(u - mu)² / 2 sigma²) - 1.
 *
 * Deux champs dans la réserve, sur une grille grossière posée sur le monde :
 * - la végétation basse des terres (taches et bandes de fougères qui s'étalent, se referment, reculent) ;
 * - le plancton de la mer : des Orbium, la « créature » de Lenia qui nage d'elle-même.
 */

export interface Field {
  /** Taille de la grille, et taille d'une case en cellules monde. */
  W: number;
  H: number;
  cw: number;
  ch: number;
  /** Première colonne monde couverte (la mer commence loin à l'est). */
  x0: number;
  A: Float32Array;
  B: Float32Array;
  /** 1 là où le champ peut vivre (terre ferme, ou eau profonde), 0 ailleurs. */
  mask: Uint8Array;
  R: number;
  mu: number;
  sigma: number;
  dt: number;
  /** Le monde boucle verticalement (plancton : un Orbium qui sort au sud revient au nord). */
  wrapY: boolean;
  /** Noyau aplati : décalages et poids normalisés. */
  kx: Int32Array;
  ky: Int32Array;
  kw: Float32Array;
  /** Pas en attente (le champ avance à son propre rythme, indépendant des images). */
  acc: number;
}

function kernel(R: number) {
  const x: number[] = [], y: number[] = [], w: number[] = [];
  let s = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const r = Math.hypot(dx, dy) / R;
    if (r <= 0 || r >= 1) continue;
    const v = Math.exp(4 - 1 / (r * (1 - r)));
    x.push(dx); y.push(dy); w.push(v); s += v;
  }
  return { kx: Int32Array.from(x), ky: Int32Array.from(y), kw: Float32Array.from(w, (v) => v / s) };
}

function makeField(w: World, x0: number, cols: number, cw: number, ch: number, keep: (t: number) => boolean,
  p: { R: number; mu: number; sigma: number; wrapY: boolean }): Field {
  const W = Math.ceil(cols / cw), H = Math.ceil(w.rows / ch);
  const mask = new Uint8Array(W * H);
  // Une case vit si au moins la moitié de ses cellules monde conviennent.
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    let ok = 0, n = 0;
    for (let y = gy * ch; y < Math.min(w.rows, (gy + 1) * ch); y++)
      for (let x = x0 + gx * cw; x < Math.min(w.cols, x0 + (gx + 1) * cw); x++, n++) if (keep(w.terrain[y * w.cols + x])) ok++;
    mask[gy * W + gx] = n && ok * 2 >= n ? 1 : 0;
  }
  return { W, H, cw, ch, x0, A: new Float32Array(W * H), B: new Float32Array(W * H), mask, dt: 0.1, acc: 0, ...p, ...kernel(p.R) };
}

/**
 * Végétation basse : réglages qui donnent des taches immobiles (pas des créatures qui nagent).
 * Une trouée broutée se referme depuis ses bords en une centaine de pas ; `sigma` (la météo)
 * fait varier la couverture d'environ 40 % (sécheresse) à 55 % (pluies).
 */
export function createVegetation(w: World, scorched = false): Field {
  // Cases de 48 × 49 px : sur la grande carte, ~66 000 cases (un pas ≈ 6 ms).
  const f = makeField(w, 0, w.cols, 12, 7, (t) => !isWater(t) && t !== T.Rock, { R: 5, mu: 0.3, sigma: 0.1, wrapY: false });
  const rng = mulberry32(9);
  if (scorched) {
    // Après la météorite : quelques taches de spores survivent, la végétation repart de là.
    for (let k = 0; k < 40; k++) seed(f, rng() * f.W, rng() * f.H, 3, 1);
  } else {
    for (let i = 0; i < f.A.length; i++) f.A[i] = f.mask[i] && rng() < 0.5 ? rng() : 0;
    for (let k = 0; k < 60; k++) stepField(f); // un paysage déjà installé, pas du bruit
  }
  return f;
}

/** Plancton : quelques Orbium qui dérivent dans l'eau profonde de la mer. */
export function createPlankton(w: World): Field {
  const x0 = Math.max(0, Math.floor(w.seaX / CELL_W) - 20);
  // Cases de 64 × 56 px : un Orbium (20 cases) forme une nuée d'environ 1 300 px.
  const f = makeField(w, x0, w.cols - x0, 16, 8, (t) => t === T.Deep, { R: 13, mu: 0.15, sigma: 0.015, wrapY: true });
  for (let k = 0; k < PLANKTON_BLOOMS; k++) spawnOrbium(f, Math.random);
  return f;
}

/** Nombre de nuées entretenues dans la mer (une nouvelle apparaît quand l'une disparaît). */
const PLANKTON_BLOOMS = 3;
/** Masse d'un Orbium vivant (somme des cases), mesurée sur la créature de référence. */
const ORBIUM_MASS = 71;

/** Un pas de Lenia sur tout le champ. */
export function stepField(f: Field): void {
  const { W, H, R, kx, ky, kw, mask, wrapY } = f;
  const A = f.A, Bf = f.B, n = kw.length, inv = 1 / (2 * f.sigma * f.sigma), mu = f.mu, dt = f.dt;
  for (let y = 0; y < H; y++) {
    // Bords nets (rien au-delà) sauf en boucle verticale ; les cases loin des bords sautent les tests.
    const inner = y >= R && y < H - R;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) { Bf[i] = 0; continue; }
      let u = 0;
      if (inner && x >= R && x < W - R) {
        for (let k = 0; k < n; k++) u += A[i + ky[k] * W + kx[k]] * kw[k];
      } else {
        for (let k = 0; k < n; k++) {
          const xx = x + kx[k];
          if (xx < 0 || xx >= W) continue;
          let yy = y + ky[k];
          if (yy < 0 || yy >= H) { if (!wrapY) continue; yy = (yy + H) % H; }
          u += A[yy * W + xx] * kw[k];
        }
      }
      const v = A[i] + dt * (2 * Math.exp(-(u - mu) * (u - mu) * inv) - 1);
      Bf[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  f.A = Bf; f.B = A;
}

/** Fait avancer le champ de `rate` pas par seconde (au plus `max` pas par appel). */
export function advance(f: Field, dt: number, rate: number, max = 2): void {
  f.acc = Math.min(max, f.acc + dt * rate);
  while (f.acc >= 1) { stepField(f); f.acc -= 1; }
}

/** Densité au point (px monde), interpolée entre les cases. */
export function fieldAt(f: Field, px: number, py: number): number {
  return sample(f, px / CELL_W, py / CELL_H);
}

/** Densité en coordonnées de cellules monde (rendu), interpolée entre les cases. */
export function sample(f: Field, wx: number, wy: number): number {
  const gx = (wx - f.x0) / f.cw - 0.5, gy = wy / f.ch - 0.5;
  if (gx < -0.5 || gx > f.W - 0.5 || gy < -0.5 || gy > f.H - 0.5) return 0;
  const x = Math.max(0, Math.min(f.W - 1.001, gx)), y = Math.max(0, Math.min(f.H - 1.001, gy));
  const ix = x | 0, iy = y | 0, tx = x - ix, ty = y - iy, i = iy * f.W + ix, A = f.A;
  return (A[i] * (1 - tx) + A[i + 1] * tx) * (1 - ty) + (A[i + f.W] * (1 - tx) + A[i + f.W + 1] * tx) * ty;
}

/** Ajoute (ou retire, si `amount` < 0) de la densité dans un disque de `r` cases autour d'un point (px monde). */
export function addAt(f: Field, px: number, py: number, r: number, amount: number): void {
  const cx = (px / CELL_W - f.x0) / f.cw, cy = py / CELL_H / f.ch;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (x < 0 || y < 0 || x >= f.W || y >= f.H) continue;
    const i = y * f.W + x, d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (!f.mask[i] || d > r) continue;
    f.A[i] = Math.max(0, Math.min(1, f.A[i] + amount * (1 - d / (r + 1))));
  }
}

/** Densité moyenne dans un rayon (px monde) : la nourriture disponible autour d'un animal. */
export function meanAround(f: Field, px: number, py: number, radius: number): number {
  const cx = (px / CELL_W - f.x0) / f.cw, cy = py / CELL_H / f.ch;
  const rx = radius / CELL_W / f.cw, ry = radius / CELL_H / f.ch;
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(f.H - 1, Math.ceil(cy + ry)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(f.W - 1, Math.ceil(cx + rx)); x++) {
      const i = y * f.W + x;
      if (f.mask[i]) { s += f.A[i]; n++; }
    }
  return n ? s / n : 0;
}

/** Case la plus dense à moins de `range` px (centre en px monde), ou null si tout est vide. */
export function densest(f: Field, px: number, py: number, range: number): { x: number; y: number; v: number } | null {
  let best = -1, bv = 0.25;
  for (let i = 0; i < f.A.length; i++) {
    if (f.A[i] <= bv) continue;
    const x = (f.x0 + ((i % f.W) + 0.5) * f.cw) * CELL_W, y = (Math.floor(i / f.W) + 0.5) * f.ch * CELL_H;
    if (Math.hypot(x - px, y - py) > range) continue;
    best = i; bv = f.A[i];
  }
  if (best < 0) return null;
  return { x: (f.x0 + ((best % f.W) + 0.5) * f.cw) * CELL_W, y: (Math.floor(best / f.W) + 0.5) * f.ch * CELL_H, v: bv };
}

export function mass(f: Field): number {
  let m = 0;
  for (let i = 0; i < f.A.length; i++) m += f.A[i];
  return m;
}

/** Une tache pleine de rayon `r` cases (graines, carcasse qui fertilise). */
export function seed(f: Field, cx: number, cy: number, r: number, v: number): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (x < 0 || y < 0 || x >= f.W || y >= f.H || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    const i = y * f.W + x;
    if (f.mask[i]) f.A[i] = Math.max(f.A[i], v);
  }
}

/** Entretient les nuées : une nouvelle apparaît quand la mer en compte moins que prévu. */
export function tendPlankton(f: Field, rng: () => number = Math.random): void {
  const m = mass(f);
  // Deux Orbium qui se percutent peuvent « exploser » et envahir la mer : la nuée s'effondre.
  if (m > ORBIUM_MASS * (PLANKTON_BLOOMS + 2)) f.A.fill(0);
  else if (m < ORBIUM_MASS * (PLANKTON_BLOOMS - 0.5)) spawnOrbium(f, rng);
}

/**
 * Pose un Orbium (motif de référence de Bert Chan, 20 × 20) dans une zone d'eau profonde libre.
 * Transposé, il nage vers le sud (ou le nord, retourné) le long de la côte, en dérivant lentement
 * vers l'ouest : il naît au large et finit par s'échouer sur la côte, une autre nuée prend le relais.
 */
function spawnOrbium(f: Field, rng: () => number) {
  for (let tries = 0; tries < 30; tries++) {
    const x0 = f.W - 20 - Math.floor(rng() * 4), y0 = Math.floor(rng() * f.H);
    // Eau profonde sous la créature, et rien de vivant à portée de son noyau (sinon elles se percutent).
    let ok = true;
    for (let y = -f.R; y < 20 + f.R && ok; y++) for (let x = Math.max(0, x0 - f.R); x < Math.min(f.W, x0 + 20 + f.R) && ok; x++) {
      const i = (((y0 + y) % f.H + f.H) % f.H) * f.W + x;
      const under = y >= 0 && y < 20 && x >= x0 && x < x0 + 20;
      if ((under && !f.mask[i]) || f.A[i] > 0.05) ok = false;
    }
    if (!ok) continue;
    const north = rng() < 0.5;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const v = ORBIUM[x][north ? 19 - y : y];
      if (v) f.A[((y0 + y) % f.H) * f.W + x0 + x] = v;
    }
    return;
  }
}

const ORBIUM = [[0,0,0,0,0,0,0.1,0.14,0.1,0,0,0.03,0.03,0,0,0.3,0,0,0,0],[0,0,0,0,0,0.08,0.24,0.3,0.3,0.18,0.14,0.15,0.16,0.15,0.09,0.2,0,0,0,0],[0,0,0,0,0,0.15,0.34,0.44,0.46,0.38,0.18,0.14,0.11,0.13,0.19,0.18,0.45,0,0,0],[0,0,0,0,0.06,0.13,0.39,0.5,0.5,0.37,0.06,0,0,0,0.02,0.16,0.68,0,0,0],[0,0,0,0.11,0.17,0.17,0.33,0.4,0.38,0.28,0.14,0,0,0,0,0,0.18,0.42,0,0],[0,0,0.09,0.18,0.13,0.06,0.08,0.26,0.32,0.32,0.27,0,0,0,0,0,0,0.82,0,0],[0.27,0,0.16,0.12,0,0,0,0.25,0.38,0.44,0.45,0.34,0,0,0,0,0,0.22,0.17,0],[0,0.07,0.2,0.02,0,0,0,0.31,0.48,0.57,0.6,0.57,0,0,0,0,0,0,0.49,0],[0,0.59,0.19,0,0,0,0,0.2,0.57,0.69,0.76,0.76,0.49,0,0,0,0,0,0.36,0],[0,0.58,0.19,0,0,0,0,0,0.67,0.83,0.9,0.92,0.87,0.12,0,0,0,0,0.22,0.07],[0,0,0.46,0,0,0,0,0,0.7,0.93,1,1,1,0.61,0,0,0,0,0.18,0.11],[0,0,0.82,0,0,0,0,0,0.47,1,1,0.98,1,0.96,0.27,0,0,0,0.19,0.1],[0,0,0.46,0,0,0,0,0,0.25,1,1,0.84,0.92,0.97,0.54,0.14,0.04,0.1,0.21,0.05],[0,0,0,0.4,0,0,0,0,0.09,0.8,1,0.82,0.8,0.85,0.63,0.31,0.18,0.19,0.2,0.01],[0,0,0,0.36,0.1,0,0,0,0.05,0.54,0.86,0.79,0.74,0.72,0.6,0.39,0.28,0.24,0.13,0],[0,0,0,0.01,0.3,0.07,0,0,0.08,0.36,0.64,0.7,0.64,0.6,0.51,0.39,0.29,0.19,0.04,0],[0,0,0,0,0.1,0.24,0.14,0.1,0.15,0.29,0.45,0.53,0.52,0.46,0.4,0.31,0.21,0.08,0,0],[0,0,0,0,0,0.08,0.21,0.21,0.22,0.29,0.36,0.39,0.37,0.33,0.26,0.18,0.09,0,0,0],[0,0,0,0,0,0,0.03,0.13,0.19,0.22,0.24,0.24,0.23,0.18,0.13,0.05,0,0,0,0],[0,0,0,0,0,0,0,0,0.02,0.06,0.08,0.09,0.07,0.05,0.01,0,0,0,0,0]];
