import { CELL_H, CELL_W } from "../config";
import type { RGB, Theme } from "../palette";
import type { Progress } from "../progress";
import { rasterize, type Raster } from "../render/raster";
import { hash2, mulberry32 } from "../rng";
import { SPECIES } from "../species";
import type { SpeciesId } from "../species/types";
import { bonePrims, deName, EXTRAS, fitScale, orient, primBounds, scaleAll } from "./dig-fossils";
import { SM } from "./scenes.mat";

/**
 * Site de fouille : une coupe de falaise stratifiée (cellules monde 4x7 px), avec des os et des
 * fossiles bonus enfouis. Chaque cellule garde l'épaisseur de sédiment qui reste (`cover`).
 */

export interface Stratum {
  mat: number;
  name: string;
  /** Dureté : 1 = argile ; le pinceau va 2x moins vite dans une roche de dureté 2. */
  hard: number;
  fact: string;
  /** Profondeur du toit de la couche (lignes sous le sol) et ondulation. */
  top: number;
  amp: number;
  f: number;
  ph: number;
}

export interface Fossil {
  kind: "bone" | "extra";
  sp: SpeciesId | null;
  /** Id de l'os, ou de l'extra. */
  id: string;
  /** « Crâne d'Ankylosaure », « Ammonite ». */
  label: string;
  /** Déjà dans la collection au moment de la génération. */
  dup: boolean;
  /** Raster rastérisée à l'origine ; ses cellules vont en (x + r.cx + i, y + r.cy + j) du site. */
  r: Raster;
  x: number;
  y: number;
  cells: number;
  exposed: number;
  /** 1 = intact, 0 = brisé. */
  integrity: number;
  warned: boolean;
  state: "buried" | "lifting" | "done" | "broken";
  t0: number;
}

export interface Site {
  n: number;
  name: string;
  seed: number;
  W: number;
  H: number;
  /** Lignes de roche entre le sol et le haut du site. */
  gTop: number;
  /** Épaisseur de sédiment restante (0 = dégagé). */
  cover: Float32Array;
  cover0: Float32Array;
  layer: Uint8Array;
  /** 0 rien, 1 galet, 2 racine, 3 fissure, 4 éclat de coquille. */
  deco: Uint8Array;
  /** Index du fossile qui occupe la cellule, -1 sinon. */
  owner: Int16Array;
  strata: Stratum[];
  fossils: Fossil[];
  complete: boolean;
}

/** En dessous de cette épaisseur, on atteint la gangue qui entoure les fossiles. */
export const SUB = 1;

const POOL: Omit<Stratum, "top" | "amp" | "f" | "ph">[] = [
  { mat: SM.Sand, name: "Sable", hard: 0.6, fact: "Du sable de riviere : depose tres vite, il a protege les os de l'air." },
  { mat: SM.Silt, name: "Limon", hard: 0.8, fact: "Une boue fine laissee par les crues de la riviere." },
  { mat: SM.Clay, name: "Argile", hard: 1, fact: "L'argile garde les os a l'abri : un ideal pour les fossiles." },
  { mat: SM.Sandstone, name: "Gres", hard: 2, fact: "Du sable devenu roche dure en des millions d'annees. Le burin aide ici." },
  { mat: SM.Shale, name: "Argilite", hard: 1.4, fact: "De la boue tassee en fines feuilles, couche apres couche." },
  { mat: SM.Lignite, name: "Lignite", hard: 1.1, fact: "Un charbon tendre : ce sont d'anciennes plantes de marais ecrasees." },
  { mat: SM.Conglo, name: "Conglomerat", hard: 1.6, fact: "Des galets cimentes : la trace d'une ancienne riviere rapide." },
];
const TOPSOIL = { mat: SM.Topsoil, name: "Terre vegetale", hard: 0.5, fact: "Le sol d'aujourd'hui, plein de racines. Les fossiles sont bien plus bas." };
export const MATRIX_INFO = { name: "Gangue", fact: "La roche collee autour d'un fossile s'appelle la gangue : on la retire tout doucement." };

/** Ordre de déblocage des espèces en fouille : [espèce, squelettes assemblés requis]. */
const UNLOCK: [SpeciesId, number][] = [["ankylo", 0], ["edmonto", 0], ["raptor", 0], ["trike", 2], ["pachy", 2], ["trex", 4]];

export function unlockedSpecies(p: Progress): SpeciesId[] {
  return UNLOCK.filter(([id, n]) => SPECIES[id] && p.assembled.length >= n).map(([id]) => id);
}

const NAMES = ["Hell Creek, Montana", "Formation de Lance, Wyoming", "Badlands, Dakota du Sud", "Dinosaur Park, Alberta", "Horseshoe Canyon, Alberta"];

/** Nom du lieu à partir de celui de l'espèce : « Formation de Hell Creek, Montana (États-Unis) » -> « Hell Creek, Montana ». */
function placeName(sp: SpeciesId | null, rng: () => number): string {
  const raw = sp ? SPECIES[sp]?.place : undefined;
  if (!raw) return NAMES[Math.floor(rng() * NAMES.length)];
  return raw.replace(/\s*\(.*\)\s*$/, "").replace(/^Formation de\s+/i, "");
}

export function stratumAt(s: Site, x: number, d: number): number {
  for (let k = s.strata.length - 1; k > 0; k--) {
    const st = s.strata[k];
    if (d >= st.top + st.amp * Math.sin(x * st.f + st.ph) + st.amp * 0.4 * Math.sin(x * st.f * 2.7 + st.ph * 1.3)) return k;
  }
  return 0;
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Pick { sp: SpeciesId; id: string; dup: boolean }

/** Choisit les os enfouis : surtout des os manquants d'une espèce débloquée, rarement un doublon. */
function pickBones(p: Progress, rng: () => number): { picks: Pick[]; primary: SpeciesId | null } {
  const unlocked = unlockedSpecies(p);
  const missingOf = (sp: SpeciesId) => (SPECIES[sp]?.bones ?? []).filter((b) => !(p.bones[sp] ?? []).includes(b.id)).map((b) => b.id);
  const withMissing = unlocked.filter((sp) => missingOf(sp).length > 0);
  const first = p.digs === 0 && withMissing.includes("ankylo");
  // On aide à finir une espèce commencée, sinon on en ouvre une nouvelle.
  const started = withMissing.filter((sp) => (p.bones[sp]?.length ?? 0) > 0);
  const pool = started.length && rng() < 0.7 ? started : withMissing;
  const primary: SpeciesId | null = first ? "ankylo" : pool[Math.floor(rng() * pool.length)] ?? null;
  const n = first ? 4 : 3 + Math.floor(rng() * 3) + (rng() < 0.25 ? 1 : 0);
  const picks: Pick[] = [];
  if (primary) for (const id of shuffle(missingOf(primary), rng)) if (picks.length < n) picks.push({ sp: primary, id, dup: false });
  const others = shuffle(withMissing.filter((sp) => sp !== primary).flatMap((sp) => missingOf(sp).map((id) => ({ sp, id, dup: false }))), rng);
  while (picks.length < n && others.length) picks.push(others.pop()!);
  // Doublons : rares, ou seuls quand toute la collection est complète.
  const found = shuffle(unlocked.flatMap((sp) => (p.bones[sp] ?? []).filter((id) => SPECIES[sp]?.bones.some((b) => b.id === id)).map((id) => ({ sp, id, dup: true }))), rng);
  if (!first && found.length && (picks.length === 0 || rng() < 0.18)) {
    if (picks.length >= 6) picks.pop();
    picks.push(found.pop()!);
  }
  while (picks.length < 3 && found.length) picks.push(found.pop()!);
  return { picks, primary: primary ?? picks[0]?.sp ?? null };
}

/** Pose une raster dans le site sans chevaucher les autres fossiles. */
function place(s: Site, r: Raster, rng: () => number): [number, number] | null {
  const { W, H, owner } = s;
  for (let t = 0; t < 120; t++) {
    const x0 = 3 + Math.floor(rng() * Math.max(1, W - 6 - r.w));
    const y0 = 4 + Math.floor(rng() * Math.max(1, H - 7 - r.h));
    if (x0 + r.w > W - 3 || y0 + r.h > H - 3) continue;
    let ok = true;
    for (let j = -2; j < r.h + 2 && ok; j++)
      for (let i = -3; i < r.w + 3 && ok; i++) {
        const x = x0 + i, y = y0 + j;
        if (x >= 0 && y >= 0 && x < W && y < H && owner[y * W + x] >= 0) ok = false;
      }
    if (ok) return [x0 - r.cx, y0 - r.cy];
  }
  return null;
}

function addFossil(s: Site, f: Omit<Fossil, "x" | "y" | "cells" | "exposed" | "integrity" | "warned" | "state" | "t0">, rng: () => number): boolean {
  const pos = place(s, f.r, rng);
  if (!pos) return false;
  const [x, y] = pos;
  const idx = s.fossils.length;
  let cells = 0;
  for (let j = 0; j < f.r.h; j++)
    for (let i = 0; i < f.r.w; i++) {
      if (!f.r.mat[j * f.r.w + i]) continue;
      const k = (y + f.r.cy + j) * s.W + (x + f.r.cx + i);
      s.owner[k] = idx;
      s.deco[k] = 0;
      cells++;
    }
  s.fossils.push({ ...f, x, y, cells, exposed: 0, integrity: 1, warned: false, state: "buried", t0: 0 });
  return true;
}

/** Génère un site de W x H cellules monde. */
export function generateSite(p: Progress, W: number, H: number, seed: number): Site {
  const rng = mulberry32(seed);
  const gTop = 5;
  // Couches : terre végétale, puis 5 à 7 couches tirées au sort.
  const strata: Stratum[] = [{ ...TOPSOIL, top: 0, amp: 0, f: 0, ph: 0 }];
  let d = 3 + rng() * 2;
  const total = H + gTop + 20;
  while (d < total) {
    const def = POOL[Math.floor(rng() * POOL.length)];
    if (def.mat === strata[strata.length - 1].mat) continue;
    strata.push({ ...def, top: d, amp: 1 + rng() * 2.5, f: 0.02 + rng() * 0.04, ph: rng() * 6.28 });
    d += def.mat === SM.Lignite ? 3 + rng() * 3 : 9 + rng() * 16;
  }
  const n = W * H;
  const s: Site = {
    n: p.digs + 1, name: "", seed, W, H, gTop,
    cover: new Float32Array(n), cover0: new Float32Array(n), layer: new Uint8Array(n), deco: new Uint8Array(n),
    owner: new Int16Array(n).fill(-1), strata, fossils: [], complete: false,
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      s.layer[k] = stratumAt(s, x, y + gTop);
      const c = 2.3 + hash2(x >> 2, y >> 1, seed) * 0.5 + hash2(x, y, seed + 1) * 0.3 + (y / H) * 0.5;
      s.cover[k] = c;
      s.cover0[k] = c;
    }

  // Os et fossiles bonus.
  const { picks, primary } = pickBones(p, rng);
  for (const pk of picks) {
    const spec = SPECIES[pk.sp];
    if (!spec) continue;
    const raw = bonePrims(spec, pk.id);
    const name = spec.bones.find((b) => b.id === pk.id)?.name ?? pk.id;
    const label = `${name} ${deName(spec.name)}`;
    // Les os allongés restent plutôt couchés : un quart de tour les rendrait trop hauts.
    const [bx0, by0, bx1, by1] = primBounds(raw);
    const long = (bx1 - bx0) / Math.max(1, by1 - by0) > 1.8;
    let placed = false;
    for (let shrink = 1; shrink > 0.4 && !placed; shrink *= 0.8) {
      const q = long && rng() < 0.8 ? (rng() < 0.5 ? 0 : 2) : Math.floor(rng() * 4);
      const ps = orient(raw, q, rng() < 0.3);
      const sc = fitScale(ps, W * CELL_W * 0.3 * shrink, H * CELL_H * 0.34 * shrink, 1.2 * shrink, 5);
      const r = rasterize(scaleAll(ps, sc), 0, 0, rng() < 0.5);
      placed = addFossil(s, { kind: "bone", sp: pk.sp, id: pk.id, label, dup: pk.dup, r }, rng);
    }
  }
  const nx = rng() < 0.55 ? (rng() < 0.3 ? 2 : 1) : 0;
  const fresh = shuffle(EXTRAS.filter((x) => !p.extras.includes(x.id)), rng);
  const old = shuffle(EXTRAS.filter((x) => p.extras.includes(x.id)), rng);
  for (let i = 0; i < nx; i++) {
    const def = fresh.pop() ?? old.pop();
    if (!def) break;
    const ps = orient(def.prims(), Math.floor(rng() * 4));
    const r = rasterize(scaleAll(ps, 1.6 + rng() * 0.6), 0, 0, rng() < 0.5);
    addFossil(s, { kind: "extra", sp: null, id: def.id, label: def.name, dup: p.extras.includes(def.id), r }, rng);
  }

  // Galets, racines, fissures, éclats de coquille.
  const blob = (cx: number, cy: number, rx: number, ry: number, v: number) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = y * W + x;
        if (s.owner[k] < 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) s.deco[k] = v;
      }
  };
  for (let i = 0; i < (W * H) / 900; i++) blob(rng() * W, rng() * H, 1 + rng() * 2, 0.6 + rng() * 1, 1);
  for (let k = 0; k < n; k++) if (strata[s.layer[k]].mat === SM.Conglo && s.owner[k] < 0 && hash2(k, 7, seed) < 0.16) s.deco[k] = 1;
  const walk = (x: number, y: number, len: number, v: number, dx: number) => {
    for (let t = 0; t < len; t++) {
      if (x < 0 || x >= W || y < 0 || y >= H) break;
      const k = Math.floor(y) * W + Math.floor(x);
      if (s.owner[k] < 0) s.deco[k] = v;
      x += dx + (rng() - 0.5) * 1.6;
      y += v === 2 ? 0.6 + rng() * 0.5 : (rng() - 0.5) * 1.2;
    }
  };
  for (let i = 0; i < W / 14; i++) walk(rng() * W, 0, 6 + rng() * 14, 2, (rng() - 0.5) * 0.6);
  for (let i = 0; i < W / 30; i++) walk(rng() * W, rng() * H, 8 + rng() * 20, 3, rng() < 0.5 ? 1 : -1);
  for (let k = 0; k < n; k++) if (!s.deco[k] && s.owner[k] < 0 && hash2(k, 3, seed) < 0.004) s.deco[k] = 4;
  for (let k = 0; k < n; k++) if (s.deco[k] === 1) { s.cover[k] += 0.4; s.cover0[k] += 0.4; }

  s.name = `Site ${s.n} - ${placeName(primary, rng)}`;
  return s;
}

/** Dureté d'une cellule (galets durs, racines tendres, gangue un peu plus ferme). */
export function hardness(s: Site, k: number): number {
  const c = s.cover[k];
  if (c <= SUB) return 1.25;
  const d = s.deco[k];
  if (d === 1) return 2.6;
  if (d === 2) return 0.6;
  return s.strata[s.layer[k]].hard;
}

// ---------------------------------------------------------------------------
// Décor de fond : ciel, buttes des badlands, sol, falaise stratifiée (en cache).
// ---------------------------------------------------------------------------
export interface Backdrop {
  key: string;
  ch: Uint8Array;
  fg: Uint8ClampedArray;
  bg: Uint8ClampedArray;
}

const lerp = (a: RGB, b: RGB, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Ligne du sol (rangée monde) pour un site posé en `oy`. */
export const groundRow = (s: Site, oy: number) => oy - s.gTop;

export function buildBackdrop(s: Site, th: Theme, cols: number, rows: number, ox: number, oy: number): Backdrop {
  const n = cols * rows;
  const ch = new Uint8Array(n), fg = new Uint8ClampedArray(n * 4), bg = new Uint8ClampedArray(n * 4);
  const set = (k: number, c: number, f: readonly number[], b: readonly number[]) => {
    ch[k] = c;
    fg[k * 4] = f[0]; fg[k * 4 + 1] = f[1]; fg[k * 4 + 2] = f[2]; fg[k * 4 + 3] = 255;
    bg[k * 4] = b[0]; bg[k * 4 + 1] = b[1]; bg[k * 4 + 2] = b[2]; bg[k * 4 + 3] = 255;
  };
  const cart = th.style === "cartoon";
  const g = groundRow(s, oy);
  const skyTop: RGB = cart ? [92, 184, 240] : [7, 7, 13];
  const skyLow: RGB = cart ? [205, 238, 252] : [30, 28, 44];
  const butte = th.mats[SM.Butte].color;
  const sunX = Math.floor(cols * 0.78), sunY = Math.max(2, Math.floor(g * 0.4));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x;
      if (y < g) {
        // Ciel et buttes au loin.
        const t = g > 1 ? y / (g - 1) : 1;
        const sky = lerp(skyTop, skyLow, t * t);
        const bt = g - 1 - Math.floor((g * 0.5) * (0.45 + 0.3 * Math.sin(x * 0.021 + s.seed) + 0.2 * Math.sin(x * 0.057 + 2) + 0.15 * Math.sign(Math.sin(x * 0.011 + s.seed * 0.3))));
        if (y >= bt) {
          const band = 0.78 + 0.22 * ((y % 3) / 2);
          const c = lerp(butte, sky, cart ? 0.15 : 0.35).map((v) => v * band);
          set(k, (y + x) % 7 === 0 ? 61 : 45, c.map((v) => v * (cart ? 0.85 : 1.25)), c);
          continue;
        }
        const dx = (x - sunX) / 2, dy = y - sunY;
        const dd = Math.hypot(dx, dy);
        if (dd < 2.2) { set(k, cart ? 64 : 79, cart ? [255, 230, 90] : [216, 212, 192], cart ? [255, 214, 74] : lerp(sky, [120, 120, 130], 0.4)); continue; }
        if (cart) {
          const cl = Math.sin(x * 0.05 + y * 0.4 + s.seed) + Math.sin(x * 0.013 - s.seed);
          if (cl > 1.35 && y < g - 3) { set(k, 32, [255, 255, 255], lerp(sky, [255, 255, 255], 0.85)); continue; }
          set(k, dd < 4 ? 46 : 32, [255, 240, 160], sky);
        } else {
          const h = hash2(x, y, 41);
          set(k, h < 0.004 ? 42 : h < 0.02 ? 46 : 32, [150 + 80 * h * 40, 150, 180], dd < 5 ? lerp(sky, [60, 60, 80], (5 - dd) / 8) : sky);
        }
        continue;
      }
      if (y === g) {
        // Herbe au bord de la falaise.
        const gc = th.mats[SM.Grass].color;
        const h = hash2(x, y, 5);
        set(k, h < 0.3 ? 118 : h < 0.6 ? 34 : 44, gc.map((v) => v * 1.2), cart ? gc : gc.map((v) => v * 0.4));
        continue;
      }
      // Falaise : mêmes couches que le site, prolongées.
      const dpt = y - g;
      const li = stratumAt(s, x - ox, dpt);
      const st = s.strata[li];
      const m = th.mats[st.mat];
      const edge = li !== stratumAt(s, x - ox, dpt - 1);
      const lam = 0.92 + 0.08 * Math.sin(dpt * 1.7 + (x - ox) * 0.05) + (hash2(x >> 3, y, 9) - 0.5) * 0.12;
      const vig = cart ? 1 : 0.75 + 0.25 * (1 - Math.abs(x / cols - 0.5) * 1.4);
      const sh = lam * vig * (edge ? 0.72 : 1);
      const h = hash2(x, y, 17);
      const glyph = edge ? 95 : m.ramp.charCodeAt(Math.floor(h * m.ramp.length));
      const fk = cart ? 0.72 : 0.85, bk = cart ? 0.92 : 0.3;
      set(k, h < (cart ? 0.35 : 0.15) && !edge ? 32 : glyph, m.color.map((v) => v * fk * sh), m.color.map((v) => v * bk * sh));
    }
  }
  // Racines qui pendent sous l'herbe.
  for (let x = 0; x < cols; x += 1) {
    if (hash2(x, 1, s.seed) > 0.08) continue;
    const len = 1 + Math.floor(hash2(x, 2, s.seed) * 4);
    for (let j = 1; j <= len && g + j < rows; j++) {
      const k = (g + j) * cols + x;
      if (k < 0) continue;
      ch[k] = j === len ? 39 : 124;
      const rc = th.mats[SM.Root].color;
      fg[k * 4] = rc[0]; fg[k * 4 + 1] = rc[1]; fg[k * 4 + 2] = rc[2];
    }
  }
  return { key: "", ch, fg, bg };
}
