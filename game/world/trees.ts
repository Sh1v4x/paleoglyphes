import { CELL_H, CELL_W } from "../config";
import { M } from "../render/materials";
import { rasterize, RasterCache, scalePrim, type Prim, type Raster } from "../render/raster";
import { F } from "./flora.mat";
import type { World } from "./generate";

/**
 * Arbres vivants de la réserve : un arbre peut être renversé (par le T. rex, par l'onde de choc
 * de la météorite), rester couché un moment, laisser une souche, puis repousser.
 * Debout, il vit dans la couche décor pré-rastérisée du monde ; le reste du temps, c'est un
 * objet dessiné comme un animal (raster animée).
 */

export type TreeState = "up" | "falling" | "down" | "stump" | "growing";

export interface Tree {
  id: number;
  /** Pied de l'arbre (px monde). */
  x: number;
  y: number;
  flip: boolean;
  prims: Prim[];
  /** Demi-largeur de l'empreinte solide au sol (px). */
  solidW: number;
  /** Plante nourricière associée (index dans world.plants), -1 sinon. */
  plant: number;
  /** Cellules gagnées dans la couche décor, et ce qu'il y avait dessous (restauré à la chute). */
  cells: number[];
  under: { mat: number; lum: number; glyph: number; base: number; owner: number }[];
  solid: number[];
  state: TreeState;
  /** Temps passé dans l'état courant (s) et sens de la chute. */
  t: number;
  dir: 1 | -1;
}

/** Durées des états (s). La repousse peut être accélérée (fin de la météorite). */
export const TREE_TIMES = { falling: 1.3, down: 25, stump: 150, growing: 7 };

/** Pose l'arbre dans la couche décor (en notant ce qu'il recouvre) et dans les collisions. */
export function stampTree(w: World, t: Tree) {
  const r = rasterize(t.prims, t.x, t.y, t.flip);
  t.cells = []; t.under = [];
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      const k = j * r.w + i;
      if (!r.mat[k]) continue;
      const x = r.cx + i, y = r.cy + j;
      if (x < 0 || y < 0 || x >= w.cols || y >= w.rows) continue;
      const wi = y * w.cols + x;
      if (t.y < w.decorBase[wi]) continue;
      t.cells.push(wi);
      t.under.push({ mat: w.decorMat[wi], lum: w.decorLum[wi], glyph: w.decorGlyph[wi], base: w.decorBase[wi], owner: w.decorOwner[wi] });
      w.decorMat[wi] = r.mat[k]; w.decorLum[wi] = Math.round(r.lum[k] * 255); w.decorGlyph[wi] = r.glyph[k];
      w.decorBase[wi] = Math.round(t.y); w.decorOwner[wi] = t.id;
    }
  }
  t.solid = [];
  if (t.solidW > 0) {
    for (let x = Math.floor((t.x - t.solidW) / CELL_W); x <= Math.floor((t.x + t.solidW) / CELL_W); x++) {
      for (let y = Math.floor((t.y - 10) / CELL_H); y <= Math.floor(t.y / CELL_H); y++) {
        if (x < 0 || y < 0 || x >= w.cols || y >= w.rows) continue;
        const wi = y * w.cols + x;
        if (w.solid[wi]) continue;
        w.solid[wi] = 1; w.solidOwner[wi] = t.id;
        t.solid.push(wi);
      }
    }
  }
  if (t.plant >= 0 && w.plants[t.plant]) w.plants[t.plant].food = 1;
  refresh(w, r.cx, r.cy, r.cx + r.w, r.cy + r.h);
}

/** Retire l'arbre de la couche décor et des collisions (ce qu'il cachait réapparaît). */
function unstampTree(w: World, t: Tree) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let n = t.cells.length - 1; n >= 0; n--) {
    const wi = t.cells[n];
    if (w.decorOwner[wi] !== t.id) continue; // recouvert depuis par un objet plus proche
    const u = t.under[n];
    w.decorMat[wi] = u.mat; w.decorLum[wi] = u.lum; w.decorGlyph[wi] = u.glyph; w.decorBase[wi] = u.base; w.decorOwner[wi] = u.owner;
    const x = wi % w.cols, y = Math.floor(wi / w.cols);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  for (const wi of t.solid) if (w.solidOwner[wi] === t.id) { w.solid[wi] = 0; w.solidOwner[wi] = -1; }
  if (t.plant >= 0 && w.plants[t.plant]) w.plants[t.plant].food = 0;
  if (isFinite(x0)) refresh(w, x0, y0, x1 + 1, y1 + 1);
}

/** Écouteurs prévenus quand les collisions changent (la navigation recalcule la zone). */
const listeners: ((w: World, x0: number, y0: number, x1: number, y1: number) => void)[] = [];
export function onTerrainChange(fn: (w: World, x0: number, y0: number, x1: number, y1: number) => void) {
  listeners.push(fn);
}

/** Recalcule les contours à l'encre et prévient la navigation, sur un rectangle de cellules. */
function refresh(w: World, x0: number, y0: number, x1: number, y1: number) {
  haloRect(w, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  for (const fn of listeners) fn(w, x0 * CELL_W - 40, y0 * CELL_H - 20, x1 * CELL_W + 40, y1 * CELL_H + 20);
}

/** Contours à l'encre (cartoon) : cellule vide qui touche un décor épais. Les tiges fines n'en ont pas. */
const thin = (m: number) => m === 0 || m === M.Fern || m === F.Fern || m === F.Horsetail;
export function haloRect(w: World, x0: number, y0: number, x1: number, y1: number) {
  const { cols, rows } = w;
  for (let y = Math.max(1, y0); y < Math.min(rows - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(cols - 1, x1); x++) {
      const i = y * cols + x;
      w.decorHalo[i] = !w.decorMat[i] && (!thin(w.decorMat[i - 1]) || !thin(w.decorMat[i + 1]) || !thin(w.decorMat[i - cols]) || !thin(w.decorMat[i + cols])) ? 1 : 0;
    }
  }
}

/** Renverse un arbre debout. Renvoie true s'il tombe. */
export function knockTree(w: World, t: Tree, dir: 1 | -1): boolean {
  if (t.state !== "up") return false;
  unstampTree(w, t);
  t.state = "falling";
  t.t = 0;
  t.dir = dir;
  active.add(t);
  return true;
}

const active = new Set<Tree>();

/** Fait avancer les arbres renversés : chute, tronc couché, souche, repousse. `speed` accélère la repousse. */
export function updateTrees(w: World, dt: number, speed = 1) {
  for (const t of active) {
    if (!w.trees.includes(t)) { active.delete(t); continue; }
    t.t += dt * (t.state === "stump" || t.state === "growing" ? speed : 1);
    if (t.state === "falling" && t.t >= TREE_TIMES.falling) { t.state = "down"; t.t = 0; }
    else if (t.state === "down" && t.t >= TREE_TIMES.down) { t.state = "stump"; t.t = 0; }
    else if (t.state === "stump" && t.t >= TREE_TIMES.stump) { t.state = "growing"; t.t = 0; }
    else if (t.state === "growing" && t.t >= TREE_TIMES.growing) { t.state = "up"; t.t = 0; stampTree(w, t); active.delete(t); }
  }
}

/** Arbres actuellement hors de la couche décor (à dessiner comme des objets animés). */
export function activeTrees(): Iterable<Tree> {
  return active;
}

/** Tout repousse d'un coup (fin de la météorite) : souche -> pousse rapide. */
export function regrowAll(w: World) {
  for (const t of active) {
    if (!w.trees.includes(t)) continue;
    if (t.state === "down" || t.state === "stump" || t.state === "falling") { t.state = "growing"; t.t = 0; }
  }
}

// ---------------------------------------------------------------------------
// Dessin des arbres animés
// ---------------------------------------------------------------------------

const cache = new RasterCache(600);

/** Pivote une primitive autour du pied (sens écran : y vers le bas). */
function rotate(p: Prim, a: number): Prim {
  const c = Math.cos(a), s = Math.sin(a);
  const R = (x: number, y: number) => [x * c - y * s, x * s + y * c] as const;
  if (p.k === "c") {
    const [ax, ay] = R(p.ax, p.ay), [bx, by] = R(p.bx, p.by);
    return { ...p, ax, ay, bx, by };
  }
  const [x, y] = R(p.x, p.y);
  if (p.k === "cut") return { ...p, x, y };
  // Ellipse alignée sur les axes : on échange progressivement ses rayons.
  const rx = Math.sqrt((p.rx * c) ** 2 + (p.ry * s) ** 2), ry = Math.sqrt((p.rx * s) ** 2 + (p.ry * c) ** 2);
  return { ...p, x, y, rx, ry, yMin: undefined, yMax: undefined };
}

/** Matière du tronc : celle de la première capsule épaisse (sinon du bois). */
function barkOf(t: Tree): number {
  for (const p of t.prims) if (p.k === "c" && !p.stroke && Math.max(p.ra, p.rb) > 4) return p.m;
  return M.Wood;
}

/** Raster de l'arbre animé (origine au pied), ou null s'il n'y a rien à dessiner. */
export function treeRaster(t: Tree): Raster | null {
  const flip = t.flip;
  // Le modèle est déjà retourné par la rastérisation : la chute « vers dir » doit en tenir compte.
  const d = (flip ? -t.dir : t.dir) as 1 | -1;
  if (t.state === "falling") {
    const u = Math.min(1, t.t / TREE_TIMES.falling);
    const q = Math.round(u * u * 12);
    return cache.get(`${t.id}|f|${d}|${q}`, () => t.prims.map((p) => rotate(p, (d * Math.PI * 0.5 * q) / 12)), flip);
  }
  if (t.state === "down") {
    // Couché, puis il s'effrite à la fin (moins de primitives = le bois se désagrège).
    const crumble = Math.max(0, (t.t - TREE_TIMES.down * 0.75) / (TREE_TIMES.down * 0.25));
    const q = Math.floor(crumble * 4);
    return cache.get(`${t.id}|d|${d}|${q}`, () => t.prims.filter((_, i) => (i * 7) % 4 >= q).map((p) => rotate(p, d * Math.PI * 0.5)), flip);
  }
  if (t.state === "stump") {
    const r = Math.max(5, t.solidW * 0.9);
    const m = barkOf(t);
    return cache.get(`${t.id}|s`, () => [
      { k: "c", ax: 0, ay: -2, bx: 0, by: -9, ra: r, rb: r * 0.9, m, z: 0, h: r },
      { k: "e", x: 0, y: -10, rx: r * 0.85, ry: 3, m: M.Bone, z: r, h: 2 },
      { k: "c", ax: -r, ay: -1, bx: -r - 6, by: 1, ra: 3, rb: 1.5, m, z: 0, h: 3 },
      { k: "c", ax: r, ay: -1, bx: r + 6, by: 1, ra: 3, rb: 1.5, m, z: 0, h: 3 },
    ], flip);
  }
  if (t.state === "growing") {
    const u = Math.min(1, t.t / TREE_TIMES.growing);
    const q = Math.max(1, Math.round((0.12 + 0.88 * (1 - (1 - u) ** 2)) * 10));
    return cache.get(`${t.id}|g|${q}`, () => t.prims.map((p) => scalePrim(p, q / 10)), flip);
  }
  return null;
}
