import { CELL_H, CELL_W } from "../config";
import type { RGB } from "../palette";
import { setBg, setFg, type Frame } from "../render/frame";
import { M } from "../render/materials";
import { scalePrim, type Prim, type Raster } from "../render/raster";
import type { Pose, Species, SpeciesId } from "../species/types";
import { SM } from "./scenes.mat";

/**
 * Outils partagés par la fouille et l'atelier : os extraits des squelettes, fossiles bonus,
 * petites opérations sur les rasters (recadrage, contour).
 */

export const IDLE_POSE: Pose = { walk: 0, moving: 0, time: 0.4, action: "idle", actionT: 0 };

const skelCache = new Map<SpeciesId, Prim[]>();

/** Squelette au repos (mis en cache : les squelettes ne bougent pas à l'atelier ni en fouille). */
export function skeletonPrims(spec: Species): Prim[] {
  let ps = skelCache.get(spec.id);
  if (!ps) {
    try { ps = spec.skeleton(IDLE_POSE); } catch { ps = []; }
    skelCache.set(spec.id, ps);
  }
  return ps;
}

/** Os générique (os long à deux têtes) pour une espèce qui ne dessine pas encore cet os. */
function genericBone(bone: string): Prim[] {
  const B = M.Bone;
  return [
    { k: "c", ax: -18, ay: -30, bx: 18, by: -30, ra: 3.5, rb: 3.5, m: B, z: 8, h: 3, bone },
    { k: "e", x: -20, y: -33, rx: 5, ry: 4, m: B, z: 10, h: 4, bone },
    { k: "e", x: -20, y: -27, rx: 5, ry: 4, m: B, z: 10, h: 4, bone },
    { k: "e", x: 20, y: -33, rx: 5, ry: 4, m: B, z: 10, h: 4, bone },
    { k: "e", x: 20, y: -27, rx: 5, ry: 4, m: B, z: 10, h: 4, bone },
  ];
}

/** Primitives d'un seul os, dans le repère du squelette. */
export function bonePrims(spec: Species, bone: string): Prim[] {
  const ps = skeletonPrims(spec).filter((p) => p.bone === bone);
  return ps.length ? ps : genericBone(bone);
}

/** Boîte englobante des primitives, px [x0, y0, x1, y1]. */
export function primBounds(ps: Prim[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) {
    if (p.k === "cut") continue;
    let a: number, b: number, c: number, d: number;
    if (p.k === "c") {
      const r = Math.max(p.ra, p.rb) + (p.stroke ? CELL_H * 0.5 : 0);
      a = Math.min(p.ax, p.bx) - r; b = Math.min(p.ay, p.by) - r; c = Math.max(p.ax, p.bx) + r; d = Math.max(p.ay, p.by) + r;
    } else { a = p.x - p.rx; b = p.y - p.ry; c = p.x + p.rx; d = p.y + p.ry; }
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

/**
 * Recentre des primitives sur l'origine, puis les tourne d'un quart de tour `q` fois (et les retourne
 * verticalement si `flipY`). Les ellipses restent alignées sur les axes : les quarts de tour échangent rx/ry.
 */
export function orient(ps: Prim[], q: number, flipY = false): Prim[] {
  const [x0, y0, x1, y1] = primBounds(ps);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const qq = ((q % 4) + 4) % 4;
  const tr = (x: number, y: number): [number, number] => {
    x -= cx; y -= cy;
    if (flipY) y = -y;
    return qq === 0 ? [x, y] : qq === 1 ? [-y, x] : qq === 2 ? [-x, -y] : [y, -x];
  };
  const swap = qq % 2 === 1;
  return ps.map((p): Prim => {
    if (p.k === "c") {
      const [ax, ay] = tr(p.ax, p.ay), [bx, by] = tr(p.bx, p.by);
      return { ...p, ax, ay, bx, by };
    }
    const [x, y] = tr(p.x, p.y);
    if (p.k === "cut") return { ...p, x, y, rx: swap ? p.ry : p.rx, ry: swap ? p.rx : p.ry };
    return { ...p, x, y, rx: swap ? p.ry : p.rx, ry: swap ? p.rx : p.ry, yMin: undefined, yMax: undefined };
  });
}

/** Échelle pour faire tenir des primitives dans une boîte (px), bornée. */
export function fitScale(ps: Prim[], wPx: number, hPx: number, min: number, max: number): number {
  const [x0, y0, x1, y1] = primBounds(ps);
  const s = Math.min(wPx / Math.max(1, x1 - x0), hPx / Math.max(1, y1 - y0));
  return Math.max(min, Math.min(max, s));
}

export const scaleAll = (ps: Prim[], s: number) => ps.map((p) => scalePrim(p, s));

/** Centre d'une raster, en cellules (repère de la raster). */
export const rasterMid = (r: Raster) => ({ x: r.cx + r.w / 2, y: r.cy + r.h / 2 });

/** Copie d'une raster dont on ne garde que les colonnes absolues [c0, c1). */
export function clipCols(r: Raster, c0: number, c1: number): Raster {
  const mat = new Uint8Array(r.mat);
  for (let j = 0; j < r.h; j++)
    for (let i = 0; i < r.w; i++) {
      const c = r.cx + i;
      if (c < c0 || c >= c1) mat[j * r.w + i] = 0;
    }
  return { ...r, mat };
}

/** Contour d'une cellule autour d'une raster (encre en cartoon, halo en dark). */
export function outlineRaster(f: Frame, r: Raster, x0: number, y0: number, col: RGB, ch = 32) {
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < r.w && j < r.h && r.mat[j * r.w + i] !== 0;
  for (let j = -1; j <= r.h; j++) {
    const y = y0 + r.cy + j;
    if (y < 0 || y >= f.rows) continue;
    for (let i = -1; i <= r.w; i++) {
      const x = x0 + r.cx + i;
      if (x < 0 || x >= f.cols || at(i, j)) continue;
      if (!(at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1))) continue;
      const k = y * f.cols + x;
      f.ch[k] = ch;
      setFg(f, k, col[0], col[1], col[2]);
      setBg(f, k, col[0], col[1], col[2]);
    }
  }
}

/** « d'Ankylosaure », « de Tyrannosaure ». */
export const deName = (n: string) => (/^[aeiouyhéèêâîôAEIOUYHÉÈÊ]/.test(n) ? `d'${n}` : `de ${n}`);

/** Cellules monde d'une longueur en px (pour placer des choses à l'échelle). */
export const pxToCols = (px: number) => px / CELL_W;
export const pxToRows = (px: number) => px / CELL_H;

// ---------------------------------------------------------------------------
// Fossiles bonus : petits trésors cachés dans la roche, avec un fait à apprendre.
// ---------------------------------------------------------------------------
export interface ExtraDef {
  id: string;
  name: string;
  fact: string;
  prims: () => Prim[];
}

const e = (x: number, y: number, rx: number, ry: number, m: number, z: number, h: number): Prim => ({ k: "e", x, y, rx, ry, m, z, h });
const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: number, z: number, h: number, stroke = false): Prim =>
  ({ k: "c", ax, ay, bx, by, ra, rb, m, z, h, stroke });

export const EXTRAS: ExtraDef[] = [
  {
    id: "ammonite", name: "Ammonite",
    fact: "Cousine des calmars, elle vivait dans une coquille en spirale, dans les mers du temps des dinosaures.",
    prims: () => {
      const P: Prim[] = [e(0, 0, 20, 17, SM.Ammonite, 0, 8)];
      let px = 17, py = 0;
      for (let t = 0.3; t < Math.PI * 5; t += 0.35) {
        const r = 17 * Math.exp(-t * 0.16);
        const x = Math.cos(t) * r, y = Math.sin(t) * r * 0.85;
        P.push(c(px, py, x, y, 1, 1, SM.Matrix, 12, 1, true));
        px = x; py = y;
      }
      return P;
    },
  },
  {
    id: "ambre", name: "Ambre avec un insecte",
    fact: "L'ambre est de la resine d'arbre durcie : elle a emprisonne cet insecte pendant 66 millions d'annees.",
    prims: () => [
      e(0, 0, 15, 11, SM.Amber, 0, 10), e(-4, -3, 6, 4, SM.Amber, 6, 6),
      e(2, 1, 4, 2.5, SM.Insect, 12, 1), e(-3, 1, 2.5, 2.5, SM.Insect, 12, 1),
      c(1, 0, -2, -6, 1, 1, SM.Insect, 13, 1, true), c(2, 0, 6, -6, 1, 1, SM.Insect, 13, 1, true),
    ],
  },
  {
    id: "feuille", name: "Feuille fossile",
    fact: "Les plantes aussi deviennent des fossiles. Cette empreinte montre ce que mangeaient les herbivores.",
    prims: () => {
      const P: Prim[] = [e(0, 0, 22, 8, SM.LeafFossil, 0, 4), c(-26, 1, 20, 0, 1, 1, SM.Matrix, 8, 1, true)];
      for (let x = -14; x <= 12; x += 7) P.push(c(x, 0, x + 6, -6, 1, 1, SM.Matrix, 8, 1, true), c(x, 0, x + 6, 6, 1, 1, SM.Matrix, 8, 1, true));
      return P;
    },
  },
  {
    id: "dent-requin", name: "Dent de requin",
    fact: "Un requin perd et remplace ses dents toute sa vie : on en retrouve des milliers dans les anciennes mers.",
    prims: () => [c(0, -16, 0, 6, 1, 10, SM.SharkTooth, 0, 8), e(0, 9, 12, 4, SM.Coprolite, 2, 4)],
  },
  {
    id: "coprolithe", name: "Coprolithe",
    fact: "Un coprolithe est un caca fossilise ! En le coupant, on decouvre ce que l'animal avait mange.",
    prims: () => [e(-10, 1, 9, 7, SM.Coprolite, 0, 7), e(2, -1, 10, 8, SM.Coprolite, 2, 8), e(13, 1, 7, 6, SM.Coprolite, 0, 6)],
  },
  {
    id: "oeuf", name: "Coquille d'oeuf",
    fact: "Les dinosaures pondaient des oeufs. Leurs coquilles fossiles racontent comment ils faisaient leur nid.",
    prims: () => [
      e(0, 0, 16, 11, SM.Fossil, 0, 10),
      c(-10, -4, -2, 2, 1, 1, SM.Matrix, 12, 1, true), c(-2, 2, 6, -3, 1, 1, SM.Matrix, 12, 1, true), c(6, -3, 12, 4, 1, 1, SM.Matrix, 12, 1, true),
    ],
  },
  {
    id: "cone", name: "Cone de conifere",
    fact: "Les forets du Cretace etaient pleines de conifères, cousins des sequoias et des pins d'aujourd'hui.",
    prims: () => {
      const P: Prim[] = [e(0, 0, 9, 15, SM.Coprolite, 0, 8)];
      for (let y = -11; y <= 11; y += 5) for (const x of [-4, 4]) P.push(e(x + (y % 2 ? 1 : 0), y, 3.5, 2.5, SM.Amber, 6, 3));
      return P;
    },
  },
];
export const EXTRA_BY_ID = Object.fromEntries(EXTRAS.map((x) => [x.id, x])) as Record<string, ExtraDef>;
