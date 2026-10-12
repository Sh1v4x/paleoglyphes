import { M } from "../render/materials";
import type { Prim } from "../render/raster";
import { F } from "../world/flora.mat";

/**
 * Décor modélisé en primitives, px locaux, origine au pied de l'objet.
 * Flore de Hell Creek (fin du Crétacé) : conifères, cycas, palmiers Sabalites, premières plantes
 * à fleurs, fougères arborescentes, prêles, ginkgos. `dark` = version malade et tordue.
 */

type Rng = () => number;
const TAU = Math.PI * 2;
const e = (x: number, y: number, rx: number, ry: number, m: number, z: number, h: number): Prim =>
  ({ k: "e", x, y, rx, ry, m, z, h });
const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: number, z: number, h: number, stroke = false): Prim =>
  ({ k: "c", ax, ay, bx, by, ra, rb, m, z, h, stroke });
/** Trait fin d'une cellule : le glyphe suit la direction. */
const s = (ax: number, ay: number, bx: number, by: number, m: number, z: number): Prim => c(ax, ay, bx, by, 1, 1, m, z, 1, true);

/**
 * Fronde pennée : limbe en capsules effilées (rampe de folioles, éclairé dessus, sombre dessous)
 * et rachis en trait fin par-dessus ; la fronde se courbe vers le sol (`droop` rad par segment).
 */
function frond(P: Prim[], x: number, y: number, a: number, len: number, r: number, droop: number, m: number, z: number, segs = 3) {
  let px = x, py = y, rr = r;
  const l = len / segs;
  const down = Math.cos(a) >= 0 ? 1 : -1;
  for (let i = 0; i < segs; i++) {
    const nx = px + Math.cos(a) * l, ny = py + Math.sin(a) * l * 0.8;
    const r2 = Math.max(1.6, rr * (i === segs - 2 ? 0.6 : 0.85));
    P.push(c(px, py, nx, ny, i === 0 ? rr * 0.5 : rr, r2, m, z, rr));
    if (i > 0) P.push(s(px, py, nx, ny, m, z + rr + 0.5));
    a += down * droop;
    px = nx; py = ny; rr = r2;
  }
}

/** Mousse espagnole pendante (dark). */
function hangMoss(P: Prim[], rng: Rng, x: number, y: number, z: number) {
  const l = 10 + rng() * 22;
  P.push(c(x, y, x + (rng() - 0.5) * 5, y + l, 2.4, 1, M.Moss, z, 2));
}

// ---------------------------------------------------------------------------
// Conifères
// ---------------------------------------------------------------------------

/** Séquoia / métaséquoia : tronc roux évasé, couronne conique en étages qui se recouvrent. */
export function sequoia(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 260 + rng() * 120;
  const R = 9 + rng() * 4;
  const lean = (rng() - 0.5) * (dark ? 34 : 12);
  const bend = dark ? (rng() - 0.5) * 22 : 0;
  // Tronc en deux tronçons (légère torsion en dark), contreforts à la base.
  P.push(c(0, 0, lean * 0.5 + bend, -H * 0.5, R, R * 0.62, F.Bark, 0, R));
  P.push(c(lean * 0.5 + bend, -H * 0.5, lean, -H * 0.97, R * 0.62, 1.8, F.Bark, 0, R * 0.6));
  for (const sd of [-1, 1]) P.push(c(0, -16, sd * (R + 8 + rng() * 6), 2, R * 0.6, 2, F.Bark, 1, R * 0.8));
  P.push(c(-2, -2, 3, -26, R * 0.5, R * 0.3, F.Bark, 2, R * 0.7));
  // Étages de feuillage, du bas vers la cime : chaque étage recouvre le haut du précédent.
  const n = 10 + Math.floor(rng() * 4);
  const W0 = 34 + H * 0.12;
  const x = (t: number) => (t < 0.5 ? lean * t + bend * t * 2 : lean * t + bend * (2 - t * 2));
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const ty = -H * (0.3 + 0.66 * t);
    const W = Math.pow(1 - t, 0.85) * W0 + 7;
    const ry = 8 + (1 - t) * 6;
    const tx = x(0.3 + 0.66 * t) + (rng() - 0.5) * 6;
    const z = 20 + k * 3;
    if (dark && rng() < 0.35) {
      // Étage déchiré : deux lambeaux séparés, le tronc se voit au milieu.
      for (const sd of [-1, 1]) P.push(e(tx + sd * W * 0.55, ty + 2, W * 0.42, ry * 0.8, F.Needle, z, ry));
      if (rng() < 0.7) hangMoss(P, rng, tx + (rng() - 0.5) * W, ty + ry * 0.5, z + 1);
      continue;
    }
    P.push(e(tx, ty, W, ry, F.Needle, z, ry * 1.2));
    // Pointes retombantes aux deux bouts de l'étage.
    for (const sd of [-1, 1]) P.push(e(tx + sd * W * 0.82, ty + ry * 0.45, W * 0.3, ry * 0.55, F.Needle, z + 1, ry * 0.7));
    if (!dark && t < 0.8 && rng() < 0.4) P.push(e(tx + (rng() - 0.5) * W, ty + ry * 0.3, 2.6, 3, F.Cone, z + ry * 1.3, 2));
    if (dark && rng() < 0.3) hangMoss(P, rng, tx + (rng() - 0.5) * W * 1.4, ty + ry * 0.6, z + 1);
  }
  // Flèche de la cime.
  P.push(c(lean, -H * 0.96, lean + (dark ? 6 : 0), -H - 16, 5, 1, F.Needle, 20 + n * 3, 4));
  return P;
}

/** Araucaria (désespoir des singes) : fût nu, verticilles de branches à cordes écailleuses relevées en ombrelle. */
export function araucaria(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 230 + rng() * 90;
  const R = 6.5 + rng() * 2;
  const lean = (rng() - 0.5) * (dark ? 26 : 10);
  P.push(c(0, 0, lean, -H * 0.94, R, 2.5, F.BarkSmooth, 0, R));
  for (const sd of [-1, 1]) P.push(c(0, -8, sd * (R + 6), 2, R * 0.55, 1.5, F.BarkSmooth, 1, R * 0.6));
  const m = 7 + Math.floor(rng() * 2);
  for (let j = 0; j < m; j++) {
    const t = j / (m - 1);
    const y = -H * (0.6 + 0.35 * t);
    const tx = lean * (0.6 + 0.35 * t);
    const L = (1 - t * 0.75) * (50 + H * 0.13);
    const z = 20 + j * 4;
    for (const sd of [-1, 1]) {
      if (dark && rng() < 0.22) {
        // Branche cassée : moignon nu.
        P.push(c(tx, y, tx + sd * L * 0.4, y + L * 0.12, 2.6, 1.4, F.BarkSmooth, z - 2, 2));
        continue;
      }
      const l = L * (0.85 + rng() * 0.3);
      const bx = tx + sd * l * 0.82, by = y + l * 0.16;
      P.push(c(tx, y, bx, by, 3, 1.8, F.BarkSmooth, z - 2, 2.5));
      // Cordes de feuillage : le long de la branche puis la pointe relevée.
      P.push(c(tx + sd * l * 0.3, y + 4, bx, by + 3, 6, 6.5, F.Araucaria, z, 6));
      P.push(c(bx, by + 2, bx + sd * l * 0.2, by - l * 0.3, 7, 5, F.Araucaria, z + 1, 7));
      if (dark && rng() < 0.5) hangMoss(P, rng, bx, by + 6, z + 2);
    }
    // Branches tournées vers le spectateur : une touffe sous le verticille.
    if (j % 2 === 0) P.push(e(tx + (rng() - 0.5) * 8, y + 6, 7 + (1 - t) * 5, 6, F.Araucaria, z + 2, 6));
  }
  // Coiffe sommitale.
  P.push(e(lean, -H * 0.97, 16, 11, F.Araucaria, 20 + m * 4 + 2, 10));
  if (!dark) for (let i = 0; i < 3; i++) P.push(e(lean + (rng() - 0.5) * 50, -H * (0.75 + rng() * 0.2), 4, 5, F.Cone, 60, 4));
  return P;
}

// ---------------------------------------------------------------------------
// Cycas, palmiers, fougères arborescentes
// ---------------------------------------------------------------------------

/** Cycas : tronc trapu en écailles losangées, rosette de frondes raides et cône central. */
export function cycad(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const th = 14 + rng() * 26, R = 8 + rng() * 3;
  P.push(c(0, 0, 0, -th, R, R * 0.85, F.CycadBark, 0, R));
  P.push(e(0, -th - 2, R * 0.9, 5, F.CycadBark, 2, 4));
  const n = 10 + Math.floor(rng() * 4);
  const L = 38 + rng() * 18;
  for (let i = 0; i < n; i++) {
    // Éventail sur le dessus, quelques frondes vers l'avant (plus basses, devant).
    const front = i % 4 === 3;
    const a = front ? Math.PI * (0.15 + rng() * 0.7) : Math.PI + (i / (n - 1)) * Math.PI + (rng() - 0.5) * 0.2;
    const dry = dark ? rng() < 0.35 : rng() < 0.06;
    frond(P, 0, -th - 3, a, L * (front ? 0.55 : 0.9 + rng() * 0.2), 9, dark ? 0.4 : 0.14,
      dry ? F.DryFrond : F.Frond, front ? 22 : 10 + (1 + Math.sin(a)) * 4);
  }
  if (rng() < 0.6) P.push(e(0, -th - 9, 6, 9, F.Cone, 18, 8));
  return P;
}

/** Palmier Sabalites : stipe annelé courbé, éventails à rayons, jupe de palmes sèches. */
export function palm(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 150 + rng() * 80;
  const bend = (rng() - 0.5) * (dark ? 70 : 44);
  const mx = bend * 0.3, cx = bend, cy = -H;
  P.push(e(0, -3, 11, 5, F.PalmBark, 0, 4));
  P.push(c(0, 0, mx, -H * 0.5, 7, 6, F.PalmBark, 0, 6));
  P.push(c(mx, -H * 0.5, cx, cy, 6, 5, F.PalmBark, 0, 5));
  // Jupe de palmes mortes qui pendent sous la couronne.
  const skirt = dark ? 6 : 2;
  for (let i = 0; i < skirt; i++) {
    const dx = (i - (skirt - 1) / 2) * 7;
    P.push(c(cx + dx * 0.5, cy + 2, cx + dx * 1.4, cy + 28 + rng() * 20, 4, 1.6, F.DryFrond, 8, 3));
  }
  const n = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1.02 + (i / (n - 1)) * 0.96) + (rng() - 0.5) * 0.15;
    const droop = Math.abs(Math.cos(a)) * (dark ? 0.9 : 0.5);
    const dx = Math.cos(a), dy = Math.sin(a) + droop;
    const L = 52 + rng() * 18;
    const qx = cx + dx * L * 0.42, qy = cy + dy * L * 0.42 * 0.8;
    const z = 20 + (1 - Math.abs(dx)) * 6 + i * 0.3;
    const m = dark && rng() < 0.25 ? F.DryFrond : F.PalmLeaf;
    P.push(s(cx, cy, qx, qy, F.PalmBark, z));
    // Éventail : limbe plein, puis rayons en traits fins qui dessinent les segments.
    const ang = Math.atan2(dy, dx);
    P.push(e(qx + dx * L * 0.3, qy + dy * L * 0.24, L * 0.3, L * 0.2, m, z, 6));
    for (let r = -3; r <= 3; r++) {
      const ra = ang + r * 0.26;
      P.push(s(qx, qy, qx + Math.cos(ra) * L * 0.58, qy + Math.sin(ra) * L * 0.46, m, z + 7));
    }
  }
  if (!dark) for (let i = 0; i < 4; i++) P.push(e(cx + (rng() - 0.5) * 14, cy + 4 + rng() * 6, 2.6, 2.4, F.Cone, 40, 2));
  return P;
}

/** Fougère arborescente : stipe fibreux, couronne de grandes frondes arquées et crosses au centre. */
export function treeFern(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 80 + rng() * 60;
  const lean = (rng() - 0.5) * (dark ? 40 : 18);
  P.push(c(0, 0, lean * 0.4, -H * 0.5, 6, 5, F.FernTrunk, 0, 5));
  P.push(c(lean * 0.4, -H * 0.5, lean, -H, 5, 4.2, F.FernTrunk, 0, 5));
  P.push(e(0, -4, 9, 5, F.FernTrunk, 0, 4));
  const n = 9 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1.0 + (i / (n - 1))) + (rng() - 0.5) * 0.25;
    const dry = dark ? rng() < 0.3 : false;
    frond(P, lean, -H, a, 58 + rng() * 22, 10, dark ? 0.5 : 0.32, dry ? F.DryFrond : F.Frond, 10 + (1 + Math.sin(a)) * 3, 4);
  }
  // Frondes vers l'avant, plus courtes.
  for (let i = 0; i < 3; i++) frond(P, lean, -H, Math.PI * (0.25 + i * 0.25), 30, 8, 0.4, F.Frond, 20);
  // Crosses (jeunes frondes enroulées).
  for (let i = 0; i < 3; i++) P.push(e(lean + (i - 1) * 5, -H - 6 - rng() * 4, 3, 3.5, F.Frond, 26, 3));
  return P;
}

// ---------------------------------------------------------------------------
// Premières plantes à fleurs, ginkgo
// ---------------------------------------------------------------------------

/** Magnolia primitif : plusieurs troncs lisses, dôme irrégulier de feuilles luisantes, grandes fleurs pâles. */
export function magnolia(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 170 + rng() * 70;
  const R = 60 + rng() * 25;
  const cx = (rng() - 0.5) * 16, cy = -H * 0.68;
  const stems = 2 + Math.floor(rng() * 2);
  const tops: [number, number][] = [];
  for (let i = 0; i < stems; i++) {
    const sx = (i - (stems - 1) / 2) * (20 + rng() * 14) + cx;
    const sy = -H * (0.42 + rng() * 0.1);
    P.push(c((i - (stems - 1) / 2) * 5, 0, sx, sy, 6.5, 4, F.BarkSmooth, i, 5));
    tops.push([sx, sy]);
  }
  for (const sd of [-1, 1]) P.push(c(0, -6, sd * 18, 2, 5, 1.5, F.BarkSmooth, 0, 4));
  const n = dark ? 9 + Math.floor(rng() * 4) : 12 + Math.floor(rng() * 5);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * 0.85;
    const x = cx + Math.cos(a) * R * d, y = cy + Math.sin(a) * R * 0.55 * d - (1 - d) * 10;
    const rx = (dark ? 14 : 17) + rng() * 10;
    blobs.push([x, y, rx]);
    P.push(e(x, y, rx, rx * 0.72, F.Broadleaf, 14 + (Math.sin(a) * d + 1) * 4, rx * 0.7));
  }
  // Branches : des têtes de tronc vers les touffes, visibles dans les trous du feuillage.
  for (const [bx, by] of blobs) {
    const [sx, sy] = tops[Math.floor(rng() * tops.length)];
    const mx = (sx + bx) / 2 + (dark ? (rng() - 0.5) * 20 : 0), my = (sy + by) / 2;
    P.push(c(sx, sy, mx, my, 3.2, 2.4, F.BarkSmooth, 10, 2.5));
    P.push(c(mx, my, bx, by, 2.4, 1.4, F.BarkSmooth, 10, 2));
    if (dark && rng() < 0.35) hangMoss(P, rng, bx, by + 8, 30);
  }
  // Fleurs : grandes corolles posées sur le dessus du dôme.
  const fl = dark ? 3 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * 5);
  for (let i = 0; i < fl; i++) {
    const [bx, by, rx] = blobs[Math.floor(rng() * blobs.length)];
    const x = bx + (rng() - 0.5) * rx, y = by - rx * 0.3 * rng();
    P.push(e(x, y, 5.5, 4, F.Blossom, 40, 4));
    if (!dark) P.push(e(x, y - 0.5, 1.6, 1.4, F.Cone, 46, 1));
  }
  return P;
}

/** Ginkgo : port élancé et irrégulier, branches montantes, bouquets de feuilles en éventail. */
export function ginkgo(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const H = 190 + rng() * 70;
  const lean = (rng() - 0.5) * (dark ? 30 : 12);
  P.push(c(0, 0, lean, -H * 0.9, 7.5, 2.5, F.BarkSmooth, 0, 6));
  for (const sd of [-1, 1]) P.push(c(0, -6, sd * 15, 2, 4.5, 1.5, F.BarkSmooth, 1, 4));
  const nb = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < nb; i++) {
    const t = 0.3 + (i / (nb - 1)) * 0.58;
    const sd = i % 2 ? 1 : -1;
    const x = lean * t, y = -H * t;
    const L = (1.15 - t) * 70 + 18;
    // Branches montantes (en dark : certaines retombent).
    const up = dark && rng() < 0.4 ? 0.1 : 0.75 + rng() * 0.25;
    const bx = x + sd * L * 0.85, by = y - L * up * 0.75;
    P.push(c(x, y, bx, by, 3, 1.3, F.BarkSmooth, 2, 2));
    const k = dark ? 3 : 4 + Math.floor(rng() * 2);
    for (let j = 0; j < k; j++) {
      const u = 0.3 + (j / Math.max(1, k - 1)) * 0.7;
      const lx = x + (bx - x) * u, ly = y + (by - y) * u;
      const rx = (dark ? 8 : 11) + rng() * 6;
      P.push(e(lx + (rng() - 0.5) * 8, ly - 3 + (rng() - 0.5) * 8, rx, rx * 0.85, F.Ginkgo, 12 + j, rx * 0.5));
    }
  }
  P.push(e(lean, -H * 0.94, 14, 12, F.Ginkgo, 14, 9));
  return P;
}

// ---------------------------------------------------------------------------
// Sous-bois
// ---------------------------------------------------------------------------

/** Touffe de prêles (Equisetum) : tiges articulées, verticilles en goupillon ou épis fertiles. */
export function horsetails(rng: Rng): Prim[] {
  const P: Prim[] = [];
  const n = 6 + Math.floor(rng() * 7);
  const spread = 12 + rng() * 12;
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * 2 * spread, h = 26 + rng() * 34;
    const tip = x + (rng() - 0.5) * 6;
    const y0 = (rng() - 0.5) * 6;
    P.push(s(x, y0, tip, y0 - h, F.Horsetail, 4 + i));
    if (rng() < 0.6) {
      // Tige stérile : verticilles de rameaux à chaque nœud.
      for (let ny = 9; ny < h - 5; ny += 10) {
        const nx = x + (tip - x) * (ny / h);
        const l = 5 * (1 - ny / h) + 3;
        P.push(s(nx, y0 - ny, nx - l, y0 - ny - 4, F.Horsetail, 2 + i));
        P.push(s(nx, y0 - ny, nx + l, y0 - ny - 4, F.Horsetail, 2 + i));
      }
    } else {
      P.push(e(tip, y0 - h - 3, 2.4, 4, F.Cone, 10 + i, 3));
    }
  }
  return P;
}

/** Touffe de fougères : frondes en traits fins qui s'ouvrent en éventail et retombent. */
export function fernClump(rng: Rng, dark = false): Prim[] {
  const P: Prim[] = [];
  const n = 5 + Math.floor(rng() * 5);
  const h = 24 + rng() * 22;
  for (let i = 0; i < n; i++) {
    let a = -Math.PI / 2 + (i - (n - 1) / 2) * (0.36 + rng() * 0.14);
    let x = 0, y = 0;
    const segs = 3;
    for (let k = 0; k < segs; k++) {
      const l = h / segs * (k === 0 ? 1.2 : 0.9);
      const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      P.push(s(x, y, nx, ny, F.Fern, i));
      x = nx; y = ny;
      a += (a + Math.PI / 2) * (dark ? 0.9 : 0.6);
    }
  }
  return P;
}

/** Petites herbacées à fleurs (angiospermes pionnières) : tiges fines et corolles. */
export function herbs(rng: Rng): Prim[] {
  const P: Prim[] = [];
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 8 + (rng() - 0.5) * 4;
    const h = 10 + rng() * 14;
    const top = x + (rng() - 0.5) * 8;
    P.push(s(x, 0, top, -h, F.Fern, i));
    P.push(e(top, -h - 2, 4.5, 3.2, rng() < 0.5 ? F.Herb : F.HerbAlt, 10 + i, 4));
  }
  return P;
}

// ---------------------------------------------------------------------------
// Minéral et ossements
// ---------------------------------------------------------------------------

export function rock(rng: Rng, size = 1): Prim[] {
  const P: Prim[] = [];
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const rx = (8 + rng() * 10) * size, ry = (6 + rng() * 7) * size;
    P.push(e((rng() - 0.5) * 18 * size, -ry * 0.7 - rng() * 4 * size, rx, ry, M.Stone, i * 2, ry * 1.2));
  }
  if (rng() < 0.4) P.push(e(0, -10 * size, 9 * size, 3 * size, F.Moss, 14 * size, 2));
  return P;
}

/** Affleurement de grès stratifié, un crâne de cératopsien pris dans la roche (cartoon). */
export function fossilOutcrop(rng: Rng): Prim[] {
  const P: Prim[] = [];
  const W = 52 + rng() * 16, H = 58 + rng() * 16;
  P.push({ k: "e", x: 0, y: -H * 0.35, rx: W, ry: H * 0.75, m: F.Sandstone, z: 0, h: 22, yMin: -H });
  P.push({ k: "e", x: W * 0.35, y: -H * 0.2, rx: W * 0.6, ry: H * 0.6, m: F.Sandstone, z: 2, h: 18, yMin: -H * 0.8 });
  // Strates : lignes horizontales ondulées sur la face.
  for (let k = 1; k <= 3; k++) {
    const y = -H * (0.22 * k);
    const w = W * (0.9 - k * 0.12);
    P.push(s(-w, y, 0, y - 2 + rng() * 4, F.Strata, 40));
    P.push(s(0, y - 2 + rng() * 4, w, y, F.Strata, 40));
  }
  // Crâne : collerette, orbite, deux cornes, bec.
  const x = (rng() - 0.5) * W * 0.6, y = -H * 0.55;
  P.push(e(x, y, 15, 11, M.Bone, 44, 6));
  P.push(e(x + 14, y + 6, 9, 6, M.Bone, 46, 5));
  P.push(e(x + 9, y + 1, 2.4, 2.4, M.Socket, 52, 1));
  P.push(c(x + 12, y - 2, x + 30, y - 14, 2.4, 1, M.Bone, 50, 2));
  P.push(c(x + 22, y + 6, x + 30, y + 3, 2, 1, M.Bone, 50, 2));
  // Vertèbres alignées.
  for (let i = 0; i < 4; i++) P.push(e(x - 22 - i * 9, y + 10 + i * 2, 3.5, 3, M.Bone, 44, 2));
  for (let i = 0; i < 5; i++) P.push(e((rng() - 0.5) * W * 2, -2 - rng() * 3, 4 + rng() * 6, 3 + rng() * 3, F.Sandstone, 0, 4));
  return P;
}

const RUNES = "|/\\<>XYTVKAH+-";

/** Pierre levée en ruine, gravée de runes (traits lumineux d'accent). Dark uniquement. */
export function runeStone(rng: Rng): { prims: Prim[]; runeCells: [number, number, number][] } {
  const P: Prim[] = [];
  const H = 95 + rng() * 25, W = 20 + rng() * 5;
  const lean = (rng() - 0.5) * 18;
  P.push(c(0, -10, lean, -H, W, W * 0.78, M.Stone, 0, 16));
  P.push(e(lean * 0.4, -6, W + 6, 8, M.Stone, -4, 6));
  // Sommet cassé
  P.push({ k: "cut", x: lean + W * 0.8, y: -H - 12, rx: W * 0.9, ry: 22 });
  // Fissure
  P.push(c(-W * 0.3, -H * 0.3, W * 0.1, -H * 0.55, 1, 1, M.Socket, 30, 1, true));
  // Gravats
  for (let i = 0; i < 5; i++) P.push(e((rng() - 0.5) * 80, -3 - rng() * 3, 4 + rng() * 6, 3 + rng() * 3, M.Stone, 0, 4));
  // Runes : positions relatives (px) + glyphe, gravées sur la face.
  const runeCells: [number, number, number][] = [];
  for (let y = -H + 28; y < -22; y += 14) {
    const t = (-y - 10) / (H - 10);
    const xs = lean * t;
    for (let x = -W * 0.45; x <= W * 0.45; x += 6) {
      if (rng() < 0.75) runeCells.push([xs + x, y, RUNES.charCodeAt(Math.floor(rng() * RUNES.length))]);
    }
  }
  return { prims: P, runeCells };
}

/** Arbre mort tordu (dark uniquement) : tronc + branches récursives, rameaux en traits fins, mousse pendante. */
export function deadTree(rng: Rng): Prim[] {
  const P: Prim[] = [];
  const mossy = rng() < 0.7;
  const branch = (x: number, y: number, a: number, len: number, r: number, depth: number, z: number) => {
    const bend = (rng() - 0.5) * 0.5;
    const mx = x + Math.cos(a) * len * 0.5, my = y + Math.sin(a) * len * 0.5;
    const a2 = a + bend;
    const x2 = mx + Math.cos(a2) * len * 0.5, y2 = my + Math.sin(a2) * len * 0.5;
    const thin = r < 2.6;
    P.push(c(x, y, mx, my, r, r * 0.85, F.DeadWood, z, r, thin));
    P.push(c(mx, my, x2, y2, r * 0.85, r * 0.7, F.DeadWood, z, r, thin));
    if (depth <= 0) {
      if (mossy && rng() < 0.6) P.push(c(x2, y2, x2 + (rng() - 0.5) * 4, y2 + 10 + rng() * 16, 3, 1.5, M.Moss, z + 2, 3));
      return;
    }
    const n = depth > 2 ? 2 : 2 + (rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * (0.5 + rng() * 0.45);
      branch(x2, y2, a2 + spread + (rng() - 0.5) * 0.3, len * (0.6 + rng() * 0.18), r * 0.62, depth - 1, z + 1);
    }
  };
  const h = 150 + rng() * 90;
  const r = 8 + rng() * 4;
  branch(0, 0, -Math.PI / 2 + (rng() - 0.5) * 0.35, h * 0.55, r, 4, 0);
  for (const sd of [-1, 1]) P.push(c(0, -4, sd * (14 + rng() * 10), 2, r * 0.8, 1.5, F.DeadWood, 1, r));
  if (mossy) {
    const n = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      const rx = 12 + rng() * 18, ry = 8 + rng() * 12;
      P.push(e((rng() - 0.5) * h * 0.7, -h * (0.6 + rng() * 0.45), rx, ry, M.Moss, 10 + rng() * 6, ry));
    }
  }
  return P;
}

/** Ossements : crâne, côtes en arc, os long. */
export function bones(rng: Rng): Prim[] {
  const P: Prim[] = [];
  const sd = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < 5; i++) {
    const x = sd * (-20 + i * 9);
    P.push(s(x, -2, x + sd * 4, -14 - (i % 2) * 3, M.Bone, 4));
    P.push(s(x + sd * 4, -14 - (i % 2) * 3, x + sd * 9, -18, M.Bone, 4));
  }
  P.push(c(sd * -24, -2, sd * 26, -2, 2.5, 2, M.Bone, 2, 3));
  const kx = sd * 40;
  P.push(e(kx, -9, 11, 8, M.Bone, 4, 8));
  P.push(e(kx + sd * 10, -5, 7, 4, M.Bone, 3, 5));
  P.push(e(kx - sd * 2, -11, 2.6, 2.6, M.Socket, 14, 1));
  P.push(c(sd * -45, 3, sd * -12, 6, 2.2, 2.2, M.Bone, 2, 3));
  P.push(e(sd * -46, 3, 4, 3, M.Bone, 4, 3));
  P.push(e(sd * -11, 6, 4, 3, M.Bone, 4, 3));
  return P;
}
