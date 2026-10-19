import { PX_PER_M } from "../config";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { M } from "../render/materials";
import { metrics } from "../render/metrics";
import { rasterize, scalePrim, type Prim, type Raster } from "../render/raster";
import { clearWorld, drawRaster } from "../render/sprite";
import { SPECIES_LIST } from "../species";
import type { Pose, Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { put, text } from "../ui/kit";

/**
 * Outils partagés par les pages du carnet (espèces, frise du temps, quiz, tailles) :
 * cache de rendus de studio, papier réglé, cadres, formats de nombres, espèces connues.
 */

export const factKey = (sp: SpeciesId, id: string) => `${sp}:${id}`;
export const hasF = (s: GameState, sp: SpeciesId, id: string) => s.progress.facts.includes(factKey(sp, id));

/** Une espèce est connue (nom, fiche) une fois son squelette assemblé : avant, c'est une espèce mystère. */
export function known(s: GameState, sp: SpeciesId): boolean {
  const p = s.progress;
  return p.assembled.includes(sp) || (p.population[sp] ?? 0) > 0;
}
export const knownList = (s: GameState) => SPECIES_LIST.filter((sp) => known(s, sp.id));

export const DEFENSE: Record<Species["behavior"]["defense"], string> = {
  club: "massue d'os au bout de la queue",
  horns: "cornes et collerette, il fait face",
  headbutt: "crâne épais en dôme, coups de tête",
  flee: "la fuite en troupeau, et le cri d'alerte",
  bite: "dents et griffes",
};

/** Ce qu'était vraiment l'animal (tous ne sont pas des dinosaures !). */
export const GROUP: Record<SpeciesId, string> = {
  ankylo: "dinosaure", raptor: "dinosaure", trike: "dinosaure", edmonto: "dinosaure", pachy: "dinosaure",
  trex: "dinosaure", pectinodon: "dinosaure", allosaurus: "dinosaure", alamosaurus: "dinosaure",
  quetzal: "ptérosaure (reptile volant)", pteranodon: "ptérosaure (reptile volant)", nyctosaurus: "ptérosaure (reptile volant)",
  mosa: "reptile marin (cousin des lézards)", archelon: "tortue marine géante", xiphactinus: "poisson géant",
  nanuq: "dinosaure", pachyrhino: "dinosaure", velociraptor: "dinosaure", protoceratops: "dinosaure", citipati: "dinosaure",
};
export const isDino = (id: SpeciesId) => GROUP[id] === "dinosaure";

// ---------------------------------------------------------------------------
// Rendus de studio (cache de rasters, poses quantifiées)
// ---------------------------------------------------------------------------
const rcache = new Map<string, Raster>();
export function cached(key: string, build: () => Prim[]): Raster {
  let r = rcache.get(key);
  if (!r) {
    if (rcache.size > 400) rcache.clear();
    r = rasterize(build(), 0, 0, false);
    rcache.set(key, r);
  }
  return r;
}
export const idle = (time: number): Pose => ({ walk: 0, moving: 0, time, action: "idle", actionT: 0 });

/** Silhouette humaine de 1,75 m (px modèle, origine aux pieds). */
export function human(): Prim[] {
  const e = (x: number, y: number, rx: number, ry: number): Prim => ({ k: "e", x, y, rx, ry, m: M.Stone, z: 4, h: 4 });
  const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number): Prim => ({ k: "c", ax, ay, bx, by, ra, rb, m: M.Stone, z: 2, h: 3 });
  const H = 1.75 * PX_PER_M / 52.5;
  return [
    e(0, -48, 3.6, 4.4), c(0, -43, 0, -26, 4.4, 3.6),
    c(-1.7, -26, -2.3, -1, 2, 1.6), c(1.7, -26, 2.3, -1, 2, 1.6),
    c(-4.4, -41, -5.6, -26, 1.4, 1.1), c(4.4, -41, 5.6, -26, 1.4, 1.1),
  ].map((p) => scalePrim(p, H));
}

export const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Fond « papier » réglé du carnet sur le calque monde. */
export function paper(th: Theme, world: Frame) {
  const u = th.ui;
  const bg = th.style === "dark" ? lerp(u.panel, u.panelAlt, 0.6) : lerp(u.panel, u.panelAlt, 0.5);
  clearWorld(world, bg);
  const line = lerp(bg, u.border, th.style === "dark" ? 0.35 : 0.18);
  for (let y = 5; y < world.rows; y += 9) {
    for (let x = 0; x < world.cols; x++) {
      const i = y * world.cols + x;
      world.ch[i] = 95; // _
      const k = i * 4;
      world.fg[k] = line[0]; world.fg[k + 1] = line[1]; world.fg[k + 2] = line[2];
    }
  }
}

/** Cadre ASCII sans fond (le dessin du calque monde reste visible). */
export function box(ui: Frame, th: Theme, x: number, y: number, w: number, h: number, col: RGB, title?: string) {
  for (let i = x; i < x + w; i++) { put(ui, i, y, 45, col); put(ui, i, y + h - 1, 45, col); }
  for (let j = y; j < y + h; j++) { put(ui, x, j, 124, col); put(ui, x + w - 1, j, 124, col); }
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) put(ui, cx, cy, 43, col);
  if (title) text(ui, x + 2, y, ` ${title} `, th.ui.hi, th.ui.panel, th.ui.alpha);
}

/** Conversion cellules d'interface -> cellules monde. */
export const RW = () => metrics.uiW / metrics.cellW;
export const RH = () => metrics.uiH / metrics.cellH;

/**
 * Dessine un modèle centré dans un rectangle d'interface (calque monde), mis à l'échelle pour tenir
 * (entre `minK` et `maxK`).
 */
export function fitSprite(world: Frame, th: Theme, key: string, model: (p: Pose) => Prim[], x: number, y: number, w: number, h: number,
  time: number, maxK: number, tint?: RGB, minK = 0.3) {
  const rw = RW(), rh = RH();
  const aw = w * rw, ah = h * rh;
  const r1 = cached(`${key}|1`, () => model(idle(0)));
  const k = Math.max(minK, Math.min(maxK, (aw * 0.92) / r1.w, (ah * 0.9) / r1.h));
  const kq = Math.round(k * 16) / 16;
  const tq = Math.floor(time * 5) % 6;
  const r = cached(`${key}|${kq}|${tq}`, () => model(idle(tq / 5)).map((p) => scalePrim(p, kq)));
  const ox = Math.round(x * rw + aw / 2 - (r.cx + r.w / 2));
  const oy = Math.round(y * rh + ah / 2 - (r.cy + r.h / 2));
  drawRaster(world, th, r, ox, oy, tint ? { tint, light: th.style === "dark" ? 0.55 : 0.4 } : {});
}

/** Trace une ligne de sol (calque monde) entre deux colonnes. */
export function groundLine(world: Frame, th: Theme, x0: number, x1: number, y: number) {
  const u = th.ui;
  if (y < 0 || y >= world.rows) return;
  for (let x = Math.max(0, Math.round(x0)); x < Math.min(world.cols, x1); x++) {
    const i = y * world.cols + x;
    world.ch[i] = x % 3 ? 45 : 61; // - =
    const kk = i * 4;
    world.fg[kk] = u.dim[0]; world.fg[kk + 1] = u.dim[1]; world.fg[kk + 2] = u.dim[2];
  }
}

export function fmtNum(v: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(v * f) / f).replace(".", ",");
}
export function fmtM(m: number) { return `${fmtNum(m)} m`; }
export function fmtKg(kg: number) { return kg >= 1000 ? `${fmtNum(kg / 1000)} t` : `${Math.round(kg)} kg`; }

/** « le Tricératops », « l'Ankylosaure ». */
export function le(name: string): string {
  return /^[aeiouyhAEIOUYHÉÈéè]/.test(name) ? `l'${name}` : `le ${name}`;
}
/** « du Tricératops », « de l'Ankylosaure ». */
export function du(name: string): string {
  return /^[aeiouyhAEIOUYHÉÈéè]/.test(name) ? `de l'${name}` : `du ${name}`;
}

/** Âge d'une espèce (Ma) lu dans sa période : « Crétacé supérieur, 68-66 Ma » -> [68, 66]. */
export function ageRange(sp: Species): [number, number] {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*Ma/.exec(sp.period);
  if (!m) return [67, 66];
  const a = parseFloat(m[1].replace(",", ".")), b = m[2] ? parseFloat(m[2].replace(",", ".")) : a;
  return [Math.max(a, b), Math.min(a, b)];
}
export const ageMid = (sp: Species) => { const [a, b] = ageRange(sp); return (a + b) / 2; };
