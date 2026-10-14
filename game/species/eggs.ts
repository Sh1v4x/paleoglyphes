import { CELL_H, CELL_W } from "../config";
import { M } from "../render/materials";
import type { Prim } from "../render/raster";
import { SPECIES } from "./index";
import { liveBirth } from "./life";
import { NM } from "./nest.mat";
import type { SpeciesId } from "./types";

/**
 * Nids et œufs : px locaux, origine au sol au centre du nid (ou sous l'œuf seul).
 * - nestModel : le nid avec `eggs` œufs ; `crack` 0..1 = éclosion en cours ; `hatched` = coquilles vides.
 * - eggModel : un œuf seul (fouille, atelier), `crack` 0..1.
 * Les petits détails (taches, œil) sont calés sur les centres de cellule : les rasters sont
 * calculées à l'origine 0,0, donc un point d'une cellule tombe toujours sur un glyphe.
 */



type NestKind = "mound" | "scrape" | "sand";

interface EggSpec {
  nest: NestKind;
  /** Largeur du nid (px). */
  W: number;
  /** Hauteur de la butte ou du bourrelet (px). */
  H: number;
  shell: number;
  /** Largeur et hauteur d'un œuf (px). */
  w: number;
  h: number;
  /** Œufs allongés, inclinés et rangés par paires (théropodes). */
  paired: boolean;
  /** Taches par œuf. */
  speck: number;
  /** Quantité de plantes sur le nid (0..1.5). */
  veg: number;
  /** Hauteur de l'œuf seul (fouille, atelier). */
  big: number;
}

const SPEC: Partial<Record<SpeciesId, EggSpec>> = {
  ankylo: { nest: "scrape", W: 70, H: 4, shell: NM.ShellCream, w: 13, h: 15, paired: false, speck: 0, veg: 0.8, big: 17 },
  trike: { nest: "mound", W: 80, H: 9, shell: NM.ShellCream, w: 13, h: 16, paired: false, speck: 0, veg: 1, big: 18 },
  edmonto: { nest: "mound", W: 90, H: 11, shell: NM.ShellTan, w: 14, h: 17, paired: false, speck: 2, veg: 1.4, big: 19 },
  pachy: { nest: "scrape", W: 62, H: 3, shell: NM.ShellCream, w: 12, h: 14, paired: false, speck: 1, veg: 0.5, big: 15 },
  raptor: { nest: "scrape", W: 74, H: 4, shell: NM.ShellBlue, w: 9, h: 20, paired: true, speck: 2, veg: 0.2, big: 21 },
  trex: { nest: "scrape", W: 90, H: 5, shell: NM.ShellBrown, w: 11, h: 24, paired: true, speck: 3, veg: 0.3, big: 24 },
  quetzal: { nest: "sand", W: 56, H: 4, shell: NM.ShellLeather, w: 11, h: 13, paired: false, speck: 0, veg: 0, big: 14 },
};

/** Œuf et nid par défaut, pour toute nouvelle espèce ovipare qui n'a pas encore les siens. */
const GENERIC: EggSpec = { nest: "scrape", W: 70, H: 4, shell: NM.ShellCream, w: 12, h: 15, paired: false, speck: 1, veg: 0.6, big: 16 };

/** Réglages d'œuf d'une espèce (générique si elle n'en a pas), ou null si elle met bas. */
function eggSpec(sp: SpeciesId): EggSpec | null {
  if (liveBirth(SPECIES[sp])) return null;
  return SPEC[sp] ?? GENERIC;
}

/** Hauteur d'un œuf (px, taille réelle dans la réserve) ; 0 = pas d'œuf (espèce vivipare). */
export const eggSize = (sp: SpeciesId) => eggSpec(sp)?.h ?? 0;

/** Hasard déterministe (le modèle doit rester stable d'une image à l'autre pour le cache). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recale un point sur le centre de sa cellule. */
const snapX = (x: number) => Math.floor(x / CELL_W) * CELL_W + CELL_W / 2;
const snapY = (y: number) => Math.floor(y / CELL_H) * CELL_H + CELL_H / 2;

/** Un point (une cellule) de matière `m`, au-dessus de la hauteur `z`. */
function dot(x: number, y: number, m: number, z: number): Prim {
  return { k: "e", x: snapX(x), y: snapY(y), rx: CELL_W * 0.4, ry: CELL_H * 0.4, m, z, h: 1 };
}

interface EggOpts {
  /** Base de l'œuf (px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Inclinaison : décalage horizontal de la pointe, en fraction de la hauteur. */
  tilt: number;
  z: number;
  shell: number;
  crack: number;
  hatched: boolean;
  speck: number;
  seed: number;
  /** Œuf enterré : rien n'est dessiné sous cette ordonnée. */
  clip?: number;
}

/**
 * Un œuf : entier (taches, fissures qui s'étendent avec `crack`), fendu au-delà de 0.7
 * (le bébé passe la tête et soulève le chapeau de coquille), ou coquille vide une fois éclos.
 */
function egg(o: EggOpts): Prim[] {
  const P: Prim[] = [];
  const r = rng(o.seed);
  const eh = o.w * 0.6; // relief de la coquille
  const top = o.z + eh;
  const at = (f: number): [number, number] => [o.x + o.tilt * o.h * f, o.y - o.h * f];
  const rw = o.w / 2;

  // Coquille ouverte : moitié basse, intérieur sombre et bord en dents de scie.
  const cup = (f: number) => {
    const [cx, cy] = at(f * 0.5);
    P.push({ k: "e", x: cx, y: cy, rx: rw, ry: o.h * f * 0.5 + 1, m: o.shell, z: o.z, h: eh, yMin: at(f)[1] - 1, yMax: o.clip });
    const [mx, my] = at(f);
    P.push({ k: "e", x: mx, y: my, rx: rw * 0.8, ry: Math.max(1.6, o.h * 0.12), m: NM.Inside, z: top + 0.2, h: 0.6 });
    const n = Math.max(2, Math.round(o.w / 3));
    for (let i = 0; i < n; i++) {
      const xa = mx - rw + 0.5 + (i * (o.w - 1)) / n, xb = mx - rw + 0.5 + ((i + 1) * (o.w - 1)) / n;
      const up = i % 2 === 0;
      P.push({ k: "c", ax: xa, ay: my + (up ? 0 : -3), bx: xb, by: my + (up ? -3 : 0), ra: 0.5, rb: 0.5, m: o.shell, z: top + 0.5, h: 0, stroke: true });
    }
  };

  if (o.hatched) {
    cup(0.42);
    // Le chapeau tombé à côté, retourné.
    const side = r() < 0.5 ? -1 : 1;
    const lx = o.x + side * (o.w * 0.75), ly = o.y - 1.5;
    P.push({ k: "e", x: lx, y: ly, rx: rw * 0.7, ry: o.h * 0.16, m: o.shell, z: o.z - 0.5, h: eh * 0.6, yMax: o.clip });
    P.push({ k: "e", x: lx, y: ly - o.h * 0.08, rx: rw * 0.5, ry: 1.4, m: NM.Inside, z: o.z + eh * 0.6, h: 0.4 });
    return P;
  }

  if (o.crack > 0.7) {
    const lift = Math.min(1, (o.crack - 0.7) / 0.3);
    cup(0.55);
    const [mx, my] = at(0.55);
    // La tête du bébé, grosse et ronde, qui sort de l'œuf.
    const hy = my - o.h * (0.08 + 0.22 * lift), hr = Math.max(3, rw * 0.75), hry = Math.max(3.5, o.h * 0.2);
    P.push({ k: "e", x: mx, y: hy, rx: hr, ry: hry, m: NM.Baby, z: top + 1, h: eh });
    P.push({ k: "c", ax: mx, ay: hy + 1, bx: mx + hr + 2.5, by: hy + 2, ra: hry * 0.6, rb: hry * 0.4, m: NM.Baby, z: top + 1, h: eh * 0.8 });
    P.push(dot(mx + hr * 0.3, hy - 1, M.Eye, top + eh + 2));
    // Le chapeau de coquille posé de travers sur la tête.
    const cy = hy - hry * 0.7;
    P.push({ k: "e", x: mx - 1.5, y: cy, rx: rw * 0.85, ry: o.h * 0.22, m: o.shell, z: top + eh + 1, h: eh * 0.7, yMax: cy + 1 });
    return P;
  }

  // Œuf entier : bout large en bas, bout étroit en haut.
  if (o.clip !== undefined) {
    const [cx, cy] = at(0.5);
    P.push({ k: "e", x: cx, y: cy, rx: rw, ry: o.h / 2, m: o.shell, z: o.z, h: eh, yMax: o.clip });
  } else {
    const ra = rw, rb = rw * 0.8;
    const [ax, ay] = at(ra / o.h), [bx, by] = at(1 - rb / o.h);
    P.push({ k: "c", ax, ay, bx, by, ra, rb, m: o.shell, z: o.z, h: eh });
  }
  const yLim = o.clip ?? Infinity;
  for (let i = 0; i < o.speck; i++) {
    const [sx, sy] = at(0.3 + r() * 0.5);
    const y = sy + (r() - 0.5) * 2;
    if (y < yLim - 1) P.push(dot(sx + (r() - 0.5) * rw, y, NM.Speck, top - 0.5));
  }
  if (o.crack > 0.04) {
    // Fissure en zigzag autour du milieu de l'œuf, puis une branche vers le haut.
    const f = Math.min(1, o.crack / 0.7);
    const [cx, cy] = at(o.clip !== undefined ? 0.7 : 0.55);
    const n = 3, seg = Math.ceil(f * n);
    for (let i = 0; i < seg; i++) {
      const xa = cx - rw * 0.6 + (i * rw * 1.2) / n, xb = cx - rw * 0.6 + ((i + 1) * rw * 1.2) / n;
      const ya = cy + (i % 2 ? -2 : 1.5), yb = cy + (i % 2 ? 1.5 : -2);
      P.push({ k: "c", ax: xa, ay: ya, bx: xb, by: yb, ra: 0.5, rb: 0.5, m: NM.Crack, z: top + 0.5, h: 0, stroke: true });
    }
    if (f > 0.6) {
      const [tx, ty] = at(0.78);
      P.push({ k: "c", ax: cx + 0.5, ay: cy - 2, bx: tx + 1, by: ty, ra: 0.5, rb: 0.5, m: NM.Crack, z: top + 0.5, h: 0, stroke: true });
    }
  }
  return P;
}

/** Brindilles et feuilles posées sur une surface de hauteur `zAt`. */
function plants(P: Prim[], r: () => number, n: number, rx: number, ry: number, cy: number, zAt: (x: number, y: number) => number, skip?: (x: number, y: number) => boolean) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 0.85 * Math.sqrt(r());
    const x = Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
    if (skip?.(x, y)) continue;
    const z = zAt(x, y);
    if (r() < 0.35) {
      const l = 4 + r() * 6, t = (r() - 0.5) * 1.2;
      P.push({ k: "c", ax: x - l / 2, ay: y - t * l / 2, bx: x + l / 2, by: y + t * l / 2, ra: 0.5, rb: 0.5, m: NM.Twig, z: z + 0.6, h: 0, stroke: true });
    } else {
      P.push({ k: "e", x, y, rx: 2.5 + r() * 3, ry: 2 + r() * 2, m: NM.Veg, z: z - 0.3, h: 1.6 });
    }
  }
}

/** Hauteur d'une demi-ellipsoïde (butte) au point (x, y). */
function domeAt(cx: number, cy: number, rx: number, ry: number, z: number, h: number) {
  return (x: number, y: number) => {
    const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    return z + h * Math.sqrt(Math.max(0, 1 - e));
  };
}

export function nestModel(sp: SpeciesId, eggs: number, crack: number, hatched: boolean): Prim[] {
  const s = eggSpec(sp);
  if (!s) return [];
  const r = rng(sp.length * 977 + sp.charCodeAt(0) * 131);
  const P: Prim[] = [];
  const W = s.W, R = W / 2;
  const fy = W * 0.13; // demi-profondeur du nid vu en perspective

  // Le nid : butte (hadrosaures, cératopsiens), cuvette creusée (théropodes…) ou sable.
  let floorZ: number, hy: number, hrx: number, hry: number;
  if (s.nest === "mound") {
    const my = -s.H * 0.7, mry = fy + s.H * 0.75;
    P.push({ k: "e", x: 0, y: my, rx: R, ry: mry, m: NM.Earth, z: 0, h: s.H });
    hy = my - mry * 0.25; hrx = R * 0.58; hry = fy * 0.62;
    // Bourrelet de terre autour du creux, plus haut à l'arrière.
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + (i / 13) * Math.PI;
      P.push({ k: "e", x: Math.cos(a) * hrx * 1.02, y: hy + Math.sin(a) * hry * 1.1, rx: 6, ry: 3.2, m: NM.Earth, z: s.H - 1, h: 3 });
    }
    P.push({ k: "e", x: 0, y: hy, rx: hrx, ry: hry, m: NM.Hollow, z: s.H + 0.3, h: 1 });
    floorZ = s.H + 4;
    // Végétaux en décomposition sur les flancs de la butte (ils couvaient les œufs par leur chaleur).
    plants(P, r, Math.round(26 * s.veg), R * 0.95, mry * 0.95, my, domeAt(0, my, R, mry, 0, s.H),
      (x, y) => ((x / hrx) ** 2 + ((y - hy) / hry) ** 2) < 1.1);
  } else if (s.nest === "scrape") {
    const my = -2;
    P.push({ k: "e", x: 0, y: my, rx: R, ry: fy + s.H * 0.4, m: NM.Earth, z: 0, h: s.H });
    hy = my - 0.5; hrx = R * 0.74; hry = fy * 0.78;
    P.push({ k: "e", x: 0, y: hy, rx: hrx, ry: hry, m: NM.Hollow, z: s.H + 0.3, h: 0.8 });
    // Petits tas de terre et cailloux sur le bord de la cuvette.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r() * 0.3;
      const front = Math.sin(a) > 0.3;
      P.push({ k: "e", x: Math.cos(a) * hrx * 1.05, y: hy + Math.sin(a) * hry * 1.12, rx: 3 + r() * 3, ry: 2 + r() * 1.5,
        m: r() < 0.35 ? NM.Pebble : NM.Earth, z: front ? s.H - 1.5 : s.H, h: 2.2 });
    }
    floorZ = s.H + 3;
    plants(P, r, Math.round(22 * s.veg), R, fy + 2, my, () => s.H + 0.8,
      (x, y) => ((x / hrx) ** 2 + ((y - hy) / hry) ** 2) < 0.9);
  } else {
    const my = -1.5;
    P.push({ k: "e", x: 0, y: my, rx: R, ry: fy + s.H * 0.5, m: NM.Sand, z: 0, h: s.H });
    hy = my - 0.5; hrx = R * 0.62; hry = fy * 0.7;
    floorZ = s.H + 0.5;
  }

  // Place des œufs : en cercle (ou en paires pour les théropodes), de l'arrière vers l'avant.
  const spots: { x: number; y: number; tilt: number }[] = [];
  const n = Math.max(0, Math.floor(eggs));
  if (s.paired) {
    const pairs = Math.ceil(n / 2);
    for (let p = 0; p < pairs; p++) {
      const a = -Math.PI / 2 + (p + 0.5) * (Math.PI * 2 / Math.max(1, pairs)) + (pairs === 1 ? Math.PI / 2 : 0);
      for (let q = 0; q < (p === pairs - 1 && n % 2 ? 1 : 2); q++) {
        const b = a + (q ? 0.24 : -0.24) * (pairs === 1 ? 2.4 : 1);
        const x = Math.cos(b) * hrx * 0.62, y = hy + Math.sin(b) * hry * 0.55 + s.h * 0.3;
        spots.push({ x, y, tilt: -Math.cos(b) * 0.45 });
      }
    }
  } else {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + ((k + 0.5) / n) * Math.PI * 2 + 0.35;
      const d = n === 1 ? 0 : n <= 3 ? 0.45 : 0.56;
      spots.push({ x: Math.cos(a) * hrx * d, y: hy + Math.sin(a) * hry * d + s.h * 0.25, tilt: 0 });
    }
  }
  spots.sort((a, b) => a.y - b.y);
  const zStep = 0.8;
  spots.forEach((o, k) => {
    const buried = s.nest === "sand";
    const y = buried ? o.y + s.h * 0.45 : o.y;
    P.push(...egg({
      x: o.x, y, w: s.w, h: s.h, tilt: o.tilt, z: floorZ + k * zStep, shell: s.shell,
      crack: crack * (0.85 + 0.15 * ((k * 7) % 3) / 2), hatched, speck: Math.min(1, s.speck), seed: k * 31 + sp.length,
      clip: buried ? o.y : undefined,
    }));
    if (buried) P.push({ k: "e", x: o.x, y: o.y + 0.5, rx: s.w * 0.8, ry: 2.4, m: NM.SandDim, z: floorZ + k * zStep - 1, h: 1.2 });
  });
  return P;
}

export function eggModel(sp: SpeciesId, crack: number): Prim[] {
  const s = eggSpec(sp);
  if (!s) return [];
  const k = s.big / s.h;
  return egg({ x: 0, y: 0, w: s.w * k, h: s.big, tilt: 0, z: 0, shell: s.shell, crack, hatched: false, speck: s.speck + 1, seed: sp.charCodeAt(1) });
}
