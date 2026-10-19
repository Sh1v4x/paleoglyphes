import { CELL_H, CELL_W } from "../config";
import { M, strokeGlyph } from "./materials";

/**
 * Primitives de modélisation des sprites, en px locaux (origine au sol, x vers la droite).
 * Le moteur les rastérise en cellules ASCII : couverture, hauteur, normale, puis ombrage.
 * `bone` (facultatif) rattache la primitive à un os du squelette (fouille, atelier).
 */
export type Prim =
  | { k: "e"; x: number; y: number; rx: number; ry: number; m: number; z: number; h: number; yMin?: number; yMax?: number; bone?: string }
  | { k: "c"; ax: number; ay: number; bx: number; by: number; ra: number; rb: number; m: number; z: number; h: number; stroke?: boolean; bone?: string }
  | { k: "cut"; x: number; y: number; rx: number; ry: number; bone?: string };

export interface Raster {
  /** Cellule monde du coin haut-gauche. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Matière par cellule (Uint16 : les espèces ont dépassé les 255 matières). */
  mat: Uint16Array;
  /** Luminance d'ombrage 0..1 (éclairage de lune sur la normale). */
  lum: Float32Array;
  /** Glyphe imposé (traits fins), 0 sinon. */
  glyph: Uint8Array;
}

// Lumière : vient d'en haut à gauche, vers le spectateur.
const LX = -0.45, LY = -0.75, LZ = 0.5;
const LN = Math.hypot(LX, LY, LZ);

function bounds(p: Prim): [number, number, number, number] {
  if (p.k === "c") {
    const r = Math.max(p.ra, p.rb) + (p.stroke ? CELL_H : 0);
    return [Math.min(p.ax, p.bx) - r, Math.min(p.ay, p.by) - r, Math.max(p.ax, p.bx) + r, Math.max(p.ay, p.by) + r];
  }
  return [p.x - p.rx, p.y - p.ry, p.x + p.rx, p.y + p.ry];
}

/**
 * Rastérise des primitives à l'origine monde (ox, oy) en px.
 * `flip` retourne le modèle horizontalement AVANT rastérisation : les glyphes sont choisis ensuite,
 * donc aucun ASCII n'est miroité.
 *
 * Chaque primitive ne parcourt que les cellules de sa boîte englobante (z-buffer) :
 * le coût dépend de la surface couverte, pas du nombre de primitives x surface totale.
 */
export function rasterize(prims: Prim[], ox: number, oy: number, flip = false): Raster {
  const sx = flip ? -1 : 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of prims) {
    if (p.k === "cut") continue;
    const [a, b, c, d] = bounds(p);
    const wa = ox + sx * a, wc = ox + sx * c;
    x0 = Math.min(x0, wa, wc); x1 = Math.max(x1, wa, wc);
    y0 = Math.min(y0, oy + b); y1 = Math.max(y1, oy + d);
  }
  if (!isFinite(x0)) return { cx: 0, cy: 0, w: 1, h: 1, mat: new Uint16Array(1), lum: new Float32Array(1), glyph: new Uint8Array(1) };
  const cx = Math.floor(x0 / CELL_W), cy = Math.floor(y0 / CELL_H);
  const w = Math.max(1, Math.ceil(x1 / CELL_W) - cx + 1);
  const h = Math.max(1, Math.ceil(y1 / CELL_H) - cy + 1);
  const n = w * h;
  const mat = new Uint16Array(n);
  const glyph = new Uint8Array(n);
  const hgt = new Float32Array(n).fill(-Infinity);
  const lum = new Float32Array(n);
  const cut = new Uint8Array(n);

  for (const p of prims) {
    const [a, b, c, d] = bounds(p);
    const wa = ox + sx * a, wc = ox + sx * c;
    const i0 = Math.max(0, Math.floor(Math.min(wa, wc) / CELL_W) - cx);
    const i1 = Math.min(w - 1, Math.ceil(Math.max(wa, wc) / CELL_W) - cx);
    const j0 = Math.max(0, Math.floor((oy + b) / CELL_H) - cy);
    const j1 = Math.min(h - 1, Math.ceil((oy + d) / CELL_H) - cy);
    for (let j = j0; j <= j1; j++) {
      const ly = (cy + j + 0.5) * CELL_H - oy;
      for (let i = i0; i <= i1; i++) {
        const lx = sx * ((cx + i + 0.5) * CELL_W - ox);
        const k = j * w + i;
        if (p.k === "e") {
          if ((p.yMin !== undefined && ly < p.yMin) || (p.yMax !== undefined && ly > p.yMax)) continue;
          const ex = (lx - p.x) / p.rx, ey = (ly - p.y) / p.ry;
          const e = ex * ex + ey * ey;
          if (e >= 1) continue;
          const v = p.z + p.h * Math.sqrt(1 - e);
          if (v > hgt[k]) { hgt[k] = v; mat[k] = p.m; glyph[k] = 0; }
        } else if (p.k === "c") {
          const dx = p.bx - p.ax, dy = p.by - p.ay;
          const len2 = dx * dx + dy * dy || 1;
          let t = ((lx - p.ax) * dx + (ly - p.ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = lx - (p.ax + dx * t), qy = ly - (p.ay + dy * t);
          if (p.stroke) {
            // Trait d'une cellule d'épaisseur, mesuré en cellules.
            const cxd = qx / CELL_W, cyd = qy / CELL_H;
            if (cxd * cxd + cyd * cyd > 0.3) continue;
            const v = p.z + p.h;
            if (v > hgt[k]) { hgt[k] = v; mat[k] = p.m; glyph[k] = strokeGlyph(dx * sx, dy); }
          } else {
            const r = p.ra + (p.rb - p.ra) * t;
            const d2 = (qx * qx + qy * qy) / (r * r);
            if (d2 >= 1) continue;
            const v = p.z + p.h * Math.sqrt(1 - d2);
            if (v > hgt[k]) { hgt[k] = v; mat[k] = p.m; glyph[k] = 0; }
          }
        } else {
          const ex = (lx - p.x) / p.rx, ey = (ly - p.y) / p.ry;
          if (ex * ex + ey * ey < 1) cut[k] = 1;
        }
      }
    }
  }
  for (let k = 0; k < n; k++) {
    if (cut[k] || mat[k] === M.None) { mat[k] = 0; hgt[k] = 0; glyph[k] = 0; }
  }

  // Ombrage : normale par différences finies sur la carte de hauteur.
  // Les cellules vides valent 0, ce qui crée un liseré de lumière/ombre sur la silhouette.
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!mat[k]) continue;
      const hl = i > 0 ? hgt[k - 1] : 0, hr = i < w - 1 ? hgt[k + 1] : 0;
      const hu = j > 0 ? hgt[k - w] : 0, hd = j < h - 1 ? hgt[k + w] : 0;
      const nx = -(hr - hl) / (2 * CELL_W), ny = -(hd - hu) / (2 * CELL_H), nz = 1;
      const nn = Math.hypot(nx, ny, nz);
      const lam = (nx * LX + ny * LY + nz * LZ) / (nn * LN);
      lum[k] = Math.min(1, 0.26 + 0.82 * Math.max(0, lam));
    }
  }
  return { cx, cy, w, h, mat, lum, glyph };
}

/** Met une primitive à l'échelle (taille d'un modèle). */
export function scalePrim(p: Prim, s: number): Prim {
  if (p.k === "c") return { ...p, ax: p.ax * s, ay: p.ay * s, bx: p.bx * s, by: p.by * s, ra: p.ra * s, rb: p.rb * s, z: p.z * s, h: p.h * s };
  if (p.k === "e")
    return { ...p, x: p.x * s, y: p.y * s, rx: p.rx * s, ry: p.ry * s, z: p.z * s, h: p.h * s,
      yMin: p.yMin === undefined ? undefined : p.yMin * s, yMax: p.yMax === undefined ? undefined : p.yMax * s };
  return { ...p, x: p.x * s, y: p.y * s, rx: p.rx * s, ry: p.ry * s };
}

/** Décale une raster (rastérisée à l'origine 0,0) vers une cellule monde, sans copier les données. */
export function placed(r: Raster, cellX: number, cellY: number): Raster {
  return { ...r, cx: r.cx + cellX, cy: r.cy + cellY };
}

/**
 * Cache de rasters : les poses sont quantifiées (quelques images par cycle), donc des dizaines
 * d'animaux à l'écran réutilisent les mêmes rasters. Rastérisées à l'origine 0,0 : il suffit de
 * les décaler d'un nombre entier de cellules (voir `placed`).
 */
export class RasterCache {
  private map = new Map<string, Raster>();
  constructor(private max = 4000) {}
  get(key: string, build: () => Prim[], flip: boolean): Raster {
    let r = this.map.get(key);
    if (!r) {
      r = rasterize(build(), 0, 0, flip);
      if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
      this.map.set(key, r);
    }
    return r;
  }
}
