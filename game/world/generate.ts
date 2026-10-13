import { createNoise2D } from "simplex-noise";
import { CELL_H, CELL_W, LAND_COLS, WORLD_COLS, WORLD_H, WORLD_ROWS } from "../config";
import { hash2, mulberry32 } from "../rng";
import { M } from "../render/materials";
import { rasterize, type Prim } from "../render/raster";
import type { Style } from "../palette";
import {
  araucaria, bones, cycad, deadTree, fernClump, fossilOutcrop, ginkgo, herbs, horsetails, magnolia, palm, rock, runeStone,
  sequoia, treeFern,
} from "../sprites/decor";
import { COVER, T, isWater } from "./tiles";
import { haloRect, stampTree, type Tree } from "./trees";

export interface Light {
  x: number;
  y: number;
  radius: number;
  phase: number;
}

/** Source de nourriture végétale pour l'IA (même liste dans les deux styles). */
export interface Plant {
  id: number;
  /** px monde, au pied */
  x: number;
  y: number;
  kind: string;
  /** "low" = broutable au sol (fougères, prêles, cycas), "high" = feuillage en hauteur (conifères, magnolias, palmiers) */
  level: "low" | "high";
  /** nourriture 0..1, l'IA la consomme et elle repousse */
  food: number;
}

/** Endroit où boire : cellule d'eau peu profonde de la rive, accessible à pied (px monde). */
export interface WaterPoint {
  x: number;
  y: number;
}

export interface Pond {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Monde statique : généré une fois, jamais modifié (sauf `plants[].food`). */
export interface World {
  cols: number;
  rows: number;
  terrain: Uint8Array;
  /** Couvert végétal des cellules T.Grass (voir COVER). */
  cover: Uint8Array;
  /** Bruit basse fréquence (teinte) et haute fréquence (texture), 0..1. */
  tone: Float32Array;
  grain: Float32Array;
  /** Profondeur de l'eau 0..1. */
  depth: Float32Array;
  /** Ligne d'eau la plus haute de la colonne d'eau (pour les reflets). */
  surfTop: Int16Array;
  shore: Uint8Array;
  /** Couche décor pré-rastérisée. */
  decorMat: Uint8Array;
  decorLum: Float32Array;
  decorGlyph: Uint8Array;
  /** Y monde (px) du pied de l'objet, pour trier la profondeur avec le joueur. */
  decorBase: Float32Array;
  shadow: Float32Array;
  /** Cellules vides qui bordent le décor (contours à l'encre en cartoon). */
  decorHalo: Uint8Array;
  /** Objet propriétaire de chaque cellule décor / solide : id d'arbre, -1 sinon (voir trees.ts). */
  decorOwner: Int32Array;
  solid: Uint8Array;
  solidOwner: Int32Array;
  /** Arbres (renversables par le T. rex et la météorite, ils repoussent). */
  trees: Tree[];
  lights: Light[];
  /** Début de la mer (px) : au-delà, la côte puis le large (mosasaures). */
  seaX: number;
  /** Grand étang (reflet de lune). Les autres plans d'eau : `ponds`. */
  pond: Pond;
  ponds: Pond[];
  spawn: { x: number; y: number };
  plants: Plant[];
  waterPoints: WaterPoint[];
}

type Spot = "water" | "forest" | "edge" | "meadow";
type Kind = "sequoia" | "araucaria" | "palm" | "tree-fern" | "magnolia" | "ginkgo" | "cycad" | "snag";

/** Essences par milieu : [espèce, poids]. */
const MIX: Record<Spot, [Kind, number][]> = {
  water: [["palm", 0.3], ["tree-fern", 0.25], ["sequoia", 0.2], ["magnolia", 0.15], ["cycad", 0.1]],
  forest: [["sequoia", 0.38], ["araucaria", 0.22], ["tree-fern", 0.12], ["magnolia", 0.1], ["ginkgo", 0.1], ["snag", 0.08]],
  edge: [["araucaria", 0.25], ["magnolia", 0.2], ["ginkgo", 0.15], ["cycad", 0.15], ["palm", 0.1], ["snag", 0.15]],
  meadow: [["araucaria", 0.3], ["cycad", 0.3], ["palm", 0.2], ["magnolia", 0.1], ["snag", 0.1]],
};

/** Modèle, empreinte solide (px), rayon d'ombre (px), étage de nourriture. */
const TREES: Record<Exclude<Kind, "snag">, [(r: () => number, dark: boolean) => Prim[], number, number, Plant["level"]]> = {
  sequoia: [sequoia, 9, 70, "high"],
  araucaria: [araucaria, 7, 80, "high"],
  palm: [palm, 6, 46, "high"],
  "tree-fern": [treeFern, 5, 40, "high"],
  magnolia: [magnolia, 9, 80, "high"],
  ginkgo: [ginkgo, 7, 56, "high"],
  cycad: [cycad, 8, 26, "low"],
};

/**
 * Génère le monde pour un style donné. Les positions viennent toutes du même tirage :
 * les deux styles partagent la même carte, seules les formes du décor changent (`shape()`).
 * Aucune décision de placement ne lit le décor rastérisé, qui diffère selon le style.
 */
export function generateWorld(style: Style, seed = 7): World {
  const rng = mulberry32(seed);
  let objId = 0;
  const shape = () => mulberry32(seed * 7919 + ++objId);
  const dark = style === "dark";
  const n2 = createNoise2D(rng);
  const cols = WORLD_COLS, rows = WORLD_ROWS, N = cols * rows;
  // Le paysage des terres est calé sur LAND_W (la mer s'ajoute à l'est sans rien déplacer).
  const LW = LAND_COLS * CELL_W;
  const pond: Pond = { x: LW * 0.6, y: WORLD_H * 0.56, rx: 560, ry: 380 };
  const mare: Pond = { x: LW * 0.17, y: WORLD_H * 0.25, rx: 240, ry: 165 };
  const w: World = {
    cols, rows,
    terrain: new Uint8Array(N),
    cover: new Uint8Array(N),
    tone: new Float32Array(N),
    grain: new Float32Array(N),
    depth: new Float32Array(N),
    surfTop: new Int16Array(N),
    shore: new Uint8Array(N),
    decorMat: new Uint8Array(N),
    decorLum: new Float32Array(N),
    decorGlyph: new Uint8Array(N),
    decorBase: new Float32Array(N).fill(-1),
    shadow: new Float32Array(N).fill(1),
    decorHalo: new Uint8Array(N),
    decorOwner: new Int32Array(N).fill(-1),
    solid: new Uint8Array(N),
    solidOwner: new Int32Array(N).fill(-1),
    trees: [],
    lights: [],
    pond,
    ponds: [pond, mare],
    spawn: { x: LW * 0.3, y: WORLD_H * 0.62 },
    seaX: LW,
    plants: [],
    waterPoints: [],
  };

  // --- Eau : distance normalisée au plus proche plan d'eau (<1 = dans l'eau) + facteur de profondeur ---
  const wd = new Float32Array(N).fill(9);
  const wsc = new Float32Array(N).fill(1);
  const lake = (o: Pond, wob: number) => {
    const m = 2.2;
    const y0 = Math.max(0, Math.floor((o.y - o.ry * m) / CELL_H)), y1 = Math.min(rows - 1, Math.ceil((o.y + o.ry * m) / CELL_H));
    const x0 = Math.max(0, Math.floor((o.x - o.rx * m) / CELL_W)), x1 = Math.min(cols - 1, Math.ceil((o.x + o.rx * m) / CELL_W));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = ((x + 0.5) * CELL_W - o.x) / o.rx, dy = ((y + 0.5) * CELL_H - o.y) / o.ry;
        const r = Math.hypot(dx, dy);
        if (r > m) continue;
        const ca = dx / (r || 1), sa = dy / (r || 1);
        const rim = 1 + 0.22 * n2(ca * 1.3 + wob, sa * 1.3) + 0.08 * Math.sin(Math.atan2(dy, dx) * 3 + 1 + wob);
        const d = r / rim, i = y * cols + x;
        if (d < wd[i]) { wd[i] = d; wsc[i] = 1; }
      }
    }
  };
  /** Rivière : spline par points de contrôle, largeur variable, gués peu profonds (traversables). */
  const river = (pts: [number, number][], hw: number, fords: number[]) => {
    const smp: [number, number][] = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = pts[Math.max(0, s - 1)], p1 = pts[s], p2 = pts[s + 1], p3 = pts[Math.min(pts.length - 1, s + 2)];
      const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 8);
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const cr = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        smp.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    for (let k = 0; k < smp.length; k++) {
      const u = k / (smp.length - 1);
      let f = 0;
      for (const fu of fords) f = Math.max(f, Math.exp(-(((u - fu) / 0.025) ** 2)));
      const h = hw * (0.85 + 0.3 * n2(u * 7, 3.3)) * (1 + 0.6 * f);
      const sc = 1 - 0.86 * f;
      const [sx, sy] = smp[k];
      const R = h * 2.2;
      const y0 = Math.max(0, Math.floor((sy - R) / CELL_H)), y1 = Math.min(rows - 1, Math.ceil((sy + R) / CELL_H));
      const x0 = Math.max(0, Math.floor((sx - R) / CELL_W)), x1 = Math.min(cols - 1, Math.ceil((sx + R) / CELL_W));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot((x + 0.5) * CELL_W - sx, (y + 0.5) * CELL_H - sy) / h, i = y * cols + x;
          if (d < wd[i]) { wd[i] = d; wsc[i] = sc; }
        }
      }
    }
  };
  const W = LW, H = WORLD_H;
  // Mer à l'est : côte découpée (baies, caps), plage peu profonde puis le large.
  const coast = (py: number) => LW * 0.985 + 90 * n2(py * 0.0012, 51) + 40 * n2(py * 0.004, 77);
  for (let y = 0; y < rows; y++) {
    const cx = coast((y + 0.5) * CELL_H);
    for (let x = Math.max(0, Math.floor((cx - 600) / CELL_W)); x < cols; x++) {
      const px = (x + 0.5) * CELL_W, i = y * cols + x;
      const d = px >= cx ? Math.max(0, 1 - (px - cx) / 520) : 1 + (cx - px) / 380;
      if (d < wd[i]) { wd[i] = d; wsc[i] = 1; }
    }
  }
  lake(pond, 0);
  lake(mare, 4.7);
  // Affluent qui descend du nord jusqu'au grand étang, puis exutoire vers le sud-est (estuaire sur la mer).
  river([[W * 0.36, -90], [W * 0.4, H * 0.1], [W * 0.32, H * 0.22], [W * 0.38, H * 0.33], [W * 0.48, H * 0.4], [pond.x - pond.rx * 0.45, pond.y - pond.ry * 0.4]], 34, [0.3, 0.66]);
  river([[pond.x + pond.rx * 0.5, pond.y + pond.ry * 0.5], [W * 0.84, H * 0.76], [W * 0.78, H * 0.88], [W * 0.86, H + 90]], 28, [0.55]);

  // Lisières de forêt (>0), prairies (<0).
  const forestAt = (px: number, py: number) => n2(px * 0.0009 + 17, py * 0.0011 - 5) + 0.35 * n2(px * 0.003, py * 0.003 + 9);

  // --- Terrain et couvert ---
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const px = (x + 0.5) * CELL_W, py = (y + 0.5) * CELL_H;
      const d = wd[i];
      w.tone[i] = 0.5 + 0.5 * n2(px * 0.004, py * 0.004);
      w.grain[i] = 0.5 + 0.5 * n2(px * 0.08, py * 0.05);
      if (d < 1) {
        w.depth[i] = Math.min(1, (1 - d) * 1.8) * wsc[i];
        w.terrain[i] = w.depth[i] < 0.28 ? T.Shallow : T.Deep;
        continue;
      }
      const g = n2(px * 0.0035, py * 0.005);
      let cv: number = COVER.None;
      if (d < 1.07) cv = g > 0.3 ? COVER.Horsetail : COVER.None; // berge de vase
      else if (d < 1.55 + 0.25 * g) cv = g > -0.45 ? COVER.Horsetail : COVER.None;
      else if (Math.abs(n2(px * 0.0016 + 40, py * 0.0021)) < 0.035) cv = COVER.None; // pistes des troupeaux
      else if (forestAt(px, py) > 0.25) {
        const h = n2(px * 0.012, py * 0.016);
        cv = h > 0.25 ? COVER.Moss : h > -0.3 ? COVER.Fern : COVER.None;
      } else if (g > -0.5) cv = n2(px * 0.009 + 9, py * 0.011) > 0.45 ? COVER.Herb : COVER.Fern;
      else cv = g > -0.7 ? COVER.Moss : COVER.None;
      w.cover[i] = cv;
      w.terrain[i] = cv ? T.Grass : T.Dirt;
    }
  }
  for (let x = 0; x < cols; x++) {
    let top = -1;
    for (let y = 0; y < rows; y++) {
      const i = y * cols + x;
      if (isWater(w.terrain[i])) { if (top < 0) top = y; w.surfTop[i] = top; } else top = -1;
    }
  }
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (!isWater(w.terrain[i])) continue;
      if (!isWater(w.terrain[i - 1]) || !isWater(w.terrain[i + 1]) || !isWater(w.terrain[i - cols]) || !isWater(w.terrain[i + cols])) w.shore[i] = 1;
    }
  }

  // --- Décor ---
  const wdAt = (x: number, y: number) => {
    const cx = Math.floor(x / CELL_W), cy = Math.floor(y / CELL_H);
    return cx < 0 || cy < 0 || cx >= cols || cy >= rows ? 0 : wd[cy * cols + cx];
  };
  // Emprises déjà prises (grille de seaux) : ne dépend que des positions, donc identique dans les deux styles.
  const B = 64, nbx = Math.ceil(W / B) + 1, nby = Math.ceil(H / B) + 1;
  const buckets: [number, number, number][][] = Array.from({ length: nbx * nby }, () => []);
  const room = (x: number, y: number, r: number) => {
    const bx = Math.floor(x / B), by = Math.floor(y / B), k = Math.ceil((r + 50) / B);
    for (let j = Math.max(0, by - k); j <= Math.min(nby - 1, by + k); j++) {
      for (let i = Math.max(0, bx - k); i <= Math.min(nbx - 1, bx + k); i++) {
        for (const [px, py, pr] of buckets[j * nbx + i]) if (Math.hypot(px - x, (py - y) * 1.4) < r + pr) return false;
      }
    }
    return true;
  };
  const claim = (x: number, y: number, r: number) => buckets[Math.floor(y / B) * nbx + Math.floor(x / B)].push([x, y, r]);
  const inside = (x: number, y: number) => x > 40 && x < W - 40 && y > 70 && y < H - 12;
  const nearSpawn = (x: number, y: number, r: number) => Math.hypot(x - w.spawn.x, y - w.spawn.y) < r;
  const plant = (x: number, y: number, kind: string, level: Plant["level"]) =>
    w.plants.push({ id: w.plants.length, x, y, kind, level, food: 1 });

  const place = (prims: Prim[], ox: number, oy: number, solidW: number, shadowR: number, flip = rng() < 0.5, tree = false) => {
    if (tree) {
      // Arbre : objet vivant (il peut tomber et repousser), voir trees.ts. Sa plante nourricière est
      // ajoutée juste après par l'appelant, d'où l'index w.plants.length.
      const t: Tree = { id: w.trees.length, x: ox, y: oy, flip, prims, solidW, plant: w.plants.length, cells: [], under: [], solid: [], state: "up", t: 0, dir: 1 };
      w.trees.push(t);
      stampTree(w, t);
      stampShadow(w, ox, oy, shadowR);
      return;
    }
    const r = rasterize(prims, ox, oy, flip);
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const k = j * r.w + i;
        if (!r.mat[k]) continue;
        const x = r.cx + i, y = r.cy + j;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const wi = y * cols + x;
        if (oy < w.decorBase[wi]) continue;
        w.decorMat[wi] = r.mat[k];
        w.decorLum[wi] = r.lum[k];
        w.decorGlyph[wi] = r.glyph[k];
        w.decorBase[wi] = oy;
        w.decorOwner[wi] = -1;
      }
    }
    stampShadow(w, ox, oy, shadowR);
    if (solidW > 0) {
      for (let x = Math.floor((ox - solidW) / CELL_W); x <= Math.floor((ox + solidW) / CELL_W); x++) {
        for (let y = Math.floor((oy - 10) / CELL_H); y <= Math.floor(oy / CELL_H); y++) {
          if (x >= 0 && y >= 0 && x < cols && y < rows) w.solid[y * cols + x] = 1;
        }
      }
    }
  };
  /** Tirages au hasard : chaque essai consomme toujours 2 nombres (x, y) + 2 (u, v) pour garder le tirage synchronisé. */
  const tries = (count: number, fn: (x: number, y: number, u: number, v: number) => boolean) => {
    for (let k = 0, made = 0; k < count * 40 && made < count; k++) {
      const x = rng() * W, y = rng() * H, u = rng(), v = rng();
      if (inside(x, y) && fn(x, y, u, v)) made++;
    }
  };

  // Monuments : pierres runiques (dark) ou affleurements fossilifères (cartoon), sur les rives.
  for (const [o, a] of [[pond, -2.1], [pond, 2.9], [mare, 0.4]] as const) {
    let f = 1.05, x = 0, y = 0;
    do { x = o.x + Math.cos(a) * o.rx * f; y = o.y + Math.sin(a) * o.ry * f; f += 0.03; } while (wdAt(x, y) < 1.18 && f < 2);
    const sr = shape();
    if (dark) {
      const { prims, runeCells } = runeStone(sr);
      place(prims, x, y, 26, 40, false);
      for (const [rx, ry, ch] of runeCells) {
        const wi = Math.floor((y + ry) / CELL_H) * cols + Math.floor((x + rx) / CELL_W);
        if (w.decorMat[wi] === M.Stone) { w.decorMat[wi] = M.Rune; w.decorGlyph[wi] = ch; }
      }
      w.lights.push({ x, y: y - 60, radius: 70, phase: sr() * 6.28 });
    } else {
      place(fossilOutcrop(sr), x, y, 26, 50, false);
    }
    claim(x, y, 60);
  }

  // Arbres : forêts denses, lisières, quelques isolés dans les prairies, palmiers et fougères au bord de l'eau.
  tries(240, (x, y, u, v) => {
    const d = wdAt(x, y);
    if (d < 1.3 || nearSpawn(x, y, 190)) return false;
    const fo = forestAt(x, y);
    const spot: Spot = d < 2.4 ? "water" : fo > 0.25 ? "forest" : fo > 0.02 ? "edge" : "meadow";
    const [p, r] = spot === "forest" ? [0.9, 24] : spot === "edge" ? [0.35, 30] : spot === "water" ? [0.3, 30] : [0.06, 44];
    if (u > p || !room(x, y, r)) return false;
    let kind: Kind = "snag";
    for (const [k, wt] of MIX[spot]) { if ((v -= wt) < 0) { kind = k; break; } }
    claim(x, y, r);
    if (kind === "snag") {
      // Bois mort en dark ; en cartoon, un gros rocher moussu à la même place.
      if (dark) {
        place(deadTree(shape()), x, y, 10, 46, undefined, true);
        w.trees[w.trees.length - 1].plant = -1;
      }
      else place(rock(shape(), 1.5), x, y, 10, 24);
      return true;
    }
    const [model, solid, shadow, level] = TREES[kind];
    place(model(shape(), dark), x, y, solid, shadow, undefined, true);
    plant(x, y, kind, level);
    return true;
  });
  // Cycas des lisières et des prairies.
  tries(120, (x, y, u) => {
    const fo = forestAt(x, y);
    if (wdAt(x, y) < 1.4 || fo > 0.35 || u > 0.7 || nearSpawn(x, y, 120) || !room(x, y, 16)) return false;
    claim(x, y, 16);
    place(cycad(shape(), dark), x, y, 8, 26, undefined, true);
    plant(x, y, "cycad", "low");
    return true;
  });
  // Prêles au bord de l'eau.
  tries(170, (x, y) => {
    const d = wdAt(x, y);
    if (d < 1.03 || d > 1.9 || !room(x, y, 10)) return false;
    claim(x, y, 10);
    place(horsetails(shape()), x, y, 0, 0);
    plant(x, y, "horsetail", "low");
    return true;
  });
  // Touffes de fougères, surtout en sous-bois.
  tries(240, (x, y, u) => {
    if (wdAt(x, y) < 1.1 || (forestAt(x, y) < 0 && u > 0.45) || !room(x, y, 10)) return false;
    claim(x, y, 10);
    place(fernClump(shape(), dark), x, y, 0, 0);
    plant(x, y, "fern", "low");
    return true;
  });
  // Herbacées à fleurs dans les prairies.
  tries(150, (x, y) => {
    if (wdAt(x, y) < 1.4 || forestAt(x, y) > 0.05 || !room(x, y, 8)) return false;
    claim(x, y, 8);
    place(herbs(shape()), x, y, 0, 0);
    plant(x, y, "herbs", "low");
    return true;
  });
  tries(110, (x, y, u) => {
    if (wdAt(x, y) < 1.15 || nearSpawn(x, y, 150) || !room(x, y, 18)) return false;
    claim(x, y, 18);
    place(rock(shape(), 0.7 + u * 0.8), x, y, 12, 18);
    return true;
  });
  tries(16, (x, y) => {
    if (wdAt(x, y) < 1.2 || !room(x, y, 40)) return false;
    claim(x, y, 40);
    place(bones(shape()), x, y, 0, 26);
    return true;
  });

  // Couvert broutable : un point de nourriture par carré de ~110 px de fougères, prêles ou fleurs.
  const PATCH: Partial<Record<number, string>> = { [COVER.Fern]: "fern-meadow", [COVER.Horsetail]: "horsetail-bed", [COVER.Herb]: "herb-patch" };
  for (let gy = 0; gy < H; gy += 110) {
    for (let gx = 0; gx < W; gx += 110) {
      const x = gx + 20 + hash2(gx, gy, 31) * 70, y = gy + 20 + hash2(gx, gy, 32) * 70;
      if (!inside(x, y)) continue;
      const i = Math.floor(y / CELL_H) * cols + Math.floor(x / CELL_W);
      const kind = PATCH[w.cover[i]];
      if (kind && !w.solid[i]) plant(x, y, kind, "low");
    }
  }
  // Points d'eau : rive peu profonde, un par carré de 56 px.
  const seen = new Set<number>();
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (w.terrain[i] !== T.Shallow || !w.shore[i] || w.solid[i]) continue;
      const px = (x + 0.5) * CELL_W, py = (y + 0.5) * CELL_H;
      const key = Math.floor(px / 56) * 1000 + Math.floor(py / 56);
      // Pas de point d'eau sur la plage : l'eau de mer ne se boit pas.
      if (seen.has(key) || !inside(px, py) || px > coast(py) - 60) continue;
      seen.add(key);
      w.waterPoints.push({ x: px, y: py });
    }
  }

  // Contours à l'encre (cartoon). Les tiges fines n'en reçoivent pas : elles deviendraient des pâtés d'encre.
  haloRect(w, 0, 0, cols, rows);
  return w;
}

function stampShadow(w: World, ox: number, oy: number, r: number) {
  if (r <= 0) return;
  const ry = r * 0.28;
  for (let y = Math.floor((oy - ry) / CELL_H); y <= Math.ceil((oy + ry) / CELL_H); y++) {
    for (let x = Math.floor((ox - r) / CELL_W); x <= Math.ceil((ox + r) / CELL_W); x++) {
      if (x < 0 || y < 0 || x >= w.cols || y >= w.rows) continue;
      const dx = ((x + 0.5) * CELL_W - ox) / r, dy = ((y + 0.5) * CELL_H - oy) / ry;
      const d = dx * dx + dy * dy;
      if (d < 1) {
        const i = y * w.cols + x;
        w.shadow[i] = Math.min(w.shadow[i], 0.45 + 0.55 * d);
      }
    }
  }
}
