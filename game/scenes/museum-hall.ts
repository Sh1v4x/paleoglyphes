import { CELL_H, CELL_W } from "../config";
import { hex, type RGB, type Theme } from "../palette";
import type { Progress } from "../progress";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { rasterize, type Prim, type Raster } from "../render/raster";
import { drawRaster } from "../render/sprite";
import { hash2 } from "../rng";
import { SPECIES_LIST } from "../species";
import { eggModel, eggSize } from "../species/eggs";
import type { Pose, Species, SpeciesId } from "../species/types";
import { EXTRAS, fitScale, IDLE_POSE, outlineRaster, primBounds, scaleAll, skeletonPrims } from "./dig-fossils";
import { UI_TOP } from "./types";

/**
 * Musée : plan du grand couloir (salles mises bout à bout) et décor « cuit » une fois pour toutes.
 * Le hall entier est dessiné dans une bande hors écran (cellules du calque monde) : murs, colonnes,
 * fenêtres hautes, parquet, socles, cordons, vitrines et squelettes montés. La scène n'en recopie
 * que la fenêtre visible à chaque image, puis ajoute ce qui bouge (survol, poussière, visiteurs).
 */

// ---------------------------------------------------------------------------
// Couleurs du musée (par style) : pas de matières dédiées, des couleurs directes.
// ---------------------------------------------------------------------------
export interface Look {
  ceiling: RGB; ceilLine: RGB; cornice: RGB; corniceHi: RGB;
  /** Mur de chaque salle (accueil, grand hall, mers, fossiles, vie). */
  walls: RGB[];
  frame: RGB; wood: RGB; woodDark: RGB; floor: RGB; floorDark: RGB;
  column: RGB; columnShade: RGB; sky: RGB; skyHi: RGB; light: RGB;
  rope: RGB; brass: RGB; plinth: RGB; plinthTop: RGB;
  glass: RGB; glassHi: RGB; ghost: RGB; banner: RGB; bannerHi: RGB; cable: RGB; fern: RGB;
  hills: RGB; ground: RGB; seaTop: RGB; seaDeep: RGB;
  /** Force des cônes de lumière. */
  spot: number;
}

const LOOKS: Record<Theme["style"], Look> = {
  cartoon: {
    ceiling: hex("#efe4cc"), ceilLine: hex("#cdbb98"), cornice: hex("#d9c6a0"), corniceHi: hex("#fff6e0"),
    walls: [hex("#f1e2c4"), hex("#e6d8bb"), hex("#9fd0e6"), hex("#a3cdb0"), hex("#bdb8e2")],
    frame: hex("#b89a6a"), wood: hex("#a8683a"), woodDark: hex("#7a4a26"), floor: hex("#c98a4e"), floorDark: hex("#a86a38"),
    column: hex("#fbf5e8"), columnShade: hex("#d6c9ab"), sky: hex("#8fd3ff"), skyHi: hex("#e8f7ff"), light: hex("#fff3c0"),
    rope: hex("#c0392b"), brass: hex("#d9a640"), plinth: hex("#5d6379"), plinthTop: hex("#8a91aa"),
    glass: hex("#d8f2ff"), glassHi: hex("#ffffff"), ghost: hex("#8a7f6a"), banner: hex("#b03a32"), bannerHi: hex("#ffd75a"),
    cable: hex("#555a66"), fern: hex("#4aab45"), hills: hex("#8fc77a"), ground: hex("#d9b06a"), seaTop: hex("#5ab4e8"), seaDeep: hex("#1f5a9a"),
    spot: 0.2,
  },
  dark: {
    ceiling: hex("#141219"), ceilLine: hex("#221f2a"), cornice: hex("#2c2836"), corniceHi: hex("#4a4458"),
    walls: [hex("#221e28"), hex("#1d1a24"), hex("#101a28"), hex("#132018"), hex("#1a1828")],
    frame: hex("#3a3346"), wood: hex("#3a2a22"), woodDark: hex("#251a15"), floor: hex("#2e241e"), floorDark: hex("#211a15"),
    column: hex("#3c3848"), columnShade: hex("#2a2734"), sky: hex("#1c2a48"), skyHi: hex("#c8d4ff"), light: hex("#ffe2a0"),
    rope: hex("#8a2a2a"), brass: hex("#a88a40"), plinth: hex("#24212c"), plinthTop: hex("#3a3646"),
    glass: hex("#2a3a48"), glassHi: hex("#9ab8d0"), ghost: hex("#6a6480"), banner: hex("#5a2228"), bannerHi: hex("#d8b060"),
    cable: hex("#5a5866"), fern: hex("#3b4530"), hills: hex("#2a3a2a"), ground: hex("#3a3024"), seaTop: hex("#1a3a5a"), seaDeep: hex("#081428"),
    spot: 0.3,
  },
};
export const lookOf = (th: Theme): Look => LOOKS[th.style];

// ---------------------------------------------------------------------------
// Géométrie verticale (cellules monde) et échelle commune des squelettes.
// ---------------------------------------------------------------------------
export interface Geo {
  cols: number; rows: number;
  /** Première ligne de mur sous la corniche. */
  ceil: number;
  /** Première ligne du parquet. */
  floor: number;
  /** Ligne d'appui des socles (sur le parquet, un peu devant le mur). */
  base: number;
  /** Échelle des squelettes : la même pour tous, pour comparer les tailles. */
  S: number;
}

/** Hauteur (px) du plus grand squelette (Alamosaurus) : il doit tenir sous le plafond. */
const TALLEST = 432;

export function geometry(cols: number, rows: number): Geo {
  const ceil = Math.ceil(((UI_TOP + 1) * metrics.uiH) / metrics.cellH) + 1;
  const floor = rows - Math.ceil((4.6 * metrics.uiH) / metrics.cellH);
  const hh = floor - ceil;
  const S = Math.max(0.375, Math.min(1.25, Math.floor((((hh - 7) * CELL_H) / TALLEST) * 8) / 8));
  return { cols, rows, ceil, floor, base: floor + 2, S };
}

// ---------------------------------------------------------------------------
// Plan : salles et pièces exposées.
// ---------------------------------------------------------------------------
export type ExKind = "sp" | "sea" | "extra" | "egg" | "life";

export interface Exhibit {
  key: string;
  kind: ExKind;
  room: number;
  sp?: SpeciesId;
  extra?: string;
  owned: boolean;
  /** Boîte de survol (cellules du hall, bornes incluses). */
  x0: number; y0: number; x1: number; y1: number;
  /** Plaque (cellules du hall) : centre x, ligne. */
  px: number; py: number;
  /** Raster cuite et son origine (cellules du hall). */
  r?: Raster; ox: number; oy: number;
  /** Diorama : échelle du modèle vivant et habitat peint. */
  k?: number;
}

export interface Room { title: string; sub: string; x0: number; w: number }

export interface Hall {
  key: string;
  geo: Geo;
  rooms: Room[];
  ex: Exhibit[];
  width: number;
  /** Bande cuite (largeur `width`, hauteur `geo.rows`). */
  strip: Frame;
}

export const ROOMS = {
  entry: 0, hall: 1, sea: 2, fossils: 3, life: 4,
} as const;

const isSea = (sp: Species) => sp.habitat === "sea";

/** Raster cachée par clé (squelettes, modèles, objets). */
const rc = new Map<string, Raster>();
export function cachedRaster(key: string, build: () => Prim[], flip = false): Raster {
  let r = rc.get(key);
  if (!r) {
    let ps: Prim[] = [];
    try { ps = build(); } catch { ps = []; }
    r = rasterize(ps, 0, 0, flip);
    if (rc.size > 500) rc.delete(rc.keys().next().value as string);
    rc.set(key, r);
  }
  return r;
}

export const skelRaster = (spec: Species, S: number) => cachedRaster(`skel|${spec.id}|${S}`, () => scaleAll(skeletonPrims(spec), S));
export const idlePose = (time: number): Pose => ({ walk: 0, moving: 0, time, action: "idle", actionT: 0 });
/** Modèle vivant (diorama), poses quantifiées : 6 images par cycle. */
export const lifeRaster = (spec: Species, k: number, tq: number) => cachedRaster(`life|${spec.id}|${k}|${tq}`, () => scaleAll(spec.model(idlePose(tq / 5)), k));

function objRaster(key: string, ps: () => Prim[], wPx: number, hPx: number, max: number): Raster {
  return cachedRaster(`obj|${key}|${wPx}|${hPx}`, () => {
    const p = ps();
    return scaleAll(p, Math.floor(fitScale(p, wPx, hPx, 0.5, max) * 4) / 4);
  });
}

/** Empreinte de la progression : le décor est recuit quand elle change. */
export function progressSig(p: Progress): string {
  return `${[...p.assembled].sort().join(",")}|${[...p.extras].sort().join(",")}|${Object.keys(p.eggs).sort().join(",")}`;
}

/** Œuf fossile déjà trouvé (la clé reste après incubation, même à 0). */
export const eggFound = (p: Progress, sp: SpeciesId) => p.eggs[sp] !== undefined;

let hallCache: Hall | null = null;

/** Plan et décor du musée pour cette taille d'écran, ce style et cette progression (en cache). */
export function hallFor(th: Theme, cols: number, rows: number, p: Progress): Hall {
  const key = `${cols}x${rows}|${metrics.uiW}x${metrics.uiH}|${th.style}|${progressSig(p)}`;
  if (hallCache && hallCache.key === key) return hallCache;
  const geo = geometry(cols, rows);
  const { rooms, ex, width } = plan(geo, cols, p);
  const strip = makeStrip(width, rows);
  hallCache = { key, geo, rooms, ex, width, strip };
  bake(hallCache, th);
  return hallCache;
}

function plan(g: Geo, cols: number, p: Progress) {
  const rooms: Room[] = [];
  const ex: Exhibit[] = [];
  const hh = g.floor - g.ceil;
  let x = 0;
  const room = (title: string, sub: string, w: number) => {
    // Une salle couvre au moins l'écran : on peut toujours la voir entière, sans voisine.
    const ww = Math.max(w, cols);
    rooms.push({ title, sub, x0: x, w: ww });
    x += ww;
    return rooms[rooms.length - 1];
  };

  // Hall d'accueil : statistiques et plan du musée (panneaux d'interface accrochés au mur).
  room("Hall d'accueil", "Bienvenue dans TON musee d'histoire naturelle !", Math.max(170, Math.round(cols * 0.9)));

  // Grand hall : les squelettes montés, du plus petit au plus grand (le géant ferme la marche).
  const land = SPECIES_LIST.filter((sp) => !isSea(sp)).map((sp) => ({ sp, r: skelRaster(sp, g.S) })).sort((a, b) => a.r.w - b.r.w);
  {
    const r0 = x;
    let cx = x + 26;
    for (const { sp, r } of land) {
      const slot = Math.max(r.w + 12, 34);
      const mid = cx + Math.floor(slot / 2);
      // Les petits montent sur une colonne : ils arrivent à hauteur des yeux.
      const ph = Math.max(3, Math.min(Math.round(hh * 0.17), Math.round(hh * 0.2 - r.h * 0.5)));
      const y1 = primBounds(skeletonPrims(sp))[3];
      const top = g.base - ph;
      const ox = mid - Math.round(r.cx + r.w / 2);
      const oy = top - Math.ceil((Math.max(0, y1) * g.S) / CELL_H);
      const pw = Math.max(12, r.w + 6);
      ex.push({
        key: `sp:${sp.id}`, kind: "sp", room: rooms.length, sp: sp.id, owned: p.assembled.includes(sp.id),
        x0: Math.min(ox + r.cx, mid - (pw >> 1)), y0: Math.min(oy + r.cy, top), x1: Math.max(ox + r.cx + r.w - 1, mid + (pw >> 1)), y1: g.base,
        px: mid, py: g.base - Math.min(2, ph - 2), r, ox, oy, k: ph,
      });
      cx += slot;
    }
    x = r0;
    room("Grand hall", "Les squelettes montes, a la meme echelle : compare-les !", cx - r0 + 26);
  }

  // Salle des mers : les reptiles marins et les poissons nagent, suspendus au plafond.
  {
    const r0 = x;
    let cx = x + 24;
    for (const sp of SPECIES_LIST.filter(isSea)) {
      const r = skelRaster(sp, g.S);
      const slot = Math.max(r.w + 18, 40);
      const mid = cx + Math.floor(slot / 2);
      const cy = g.ceil + Math.round(hh * 0.4);
      const ox = mid - Math.round(r.cx + r.w / 2);
      const oy = cy - Math.round(r.cy + r.h / 2);
      ex.push({
        key: `sp:${sp.id}`, kind: "sea", room: rooms.length, sp: sp.id, owned: p.assembled.includes(sp.id),
        x0: Math.min(ox + r.cx, mid - 10), y0: oy + r.cy, x1: Math.max(ox + r.cx + r.w - 1, mid + 10), y1: g.base,
        px: mid, py: g.base - 1, r, ox, oy, k: 3,
      });
      cx += slot;
    }
    x = r0;
    room("Salle des mers", "La Voie maritime interieure de l'Ouest, il y a 66 millions d'annees", cx - r0 + 24);
  }

  // Galerie des fossiles : vitrines des fossiles bonus, puis des œufs.
  {
    const r0 = x;
    let cx = x + 22;
    const gh = Math.max(10, Math.min(24, Math.round(hh * 0.26)));
    const cab = Math.max(6, Math.round(hh * 0.22));
    const glassBot = g.base - cab;
    for (const d of EXTRAS) {
      const cw = 30;
      const r = objRaster(d.id, d.prims, (cw - 6) * CELL_W, (gh - 3) * CELL_H, 3.5);
      const mid = cx + (cw >> 1);
      const oy = glassBot - 1 - Math.floor((gh - 2) / 2) - Math.round(r.cy + r.h / 2);
      ex.push({
        key: `x:${d.id}`, kind: "extra", room: rooms.length, extra: d.id, owned: p.extras.includes(d.id),
        x0: cx, y0: glassBot - gh, x1: cx + cw - 1, y1: g.base, px: mid, py: glassBot + 2, r, ox: mid - Math.round(r.cx + r.w / 2), oy, k: gh,
      });
      cx += cw + 6;
    }
    cx += 10;
    for (const sp of SPECIES_LIST.filter((q) => eggSize(q.id) > 0)) {
      const cw = 26;
      const r = objRaster(`egg-${sp.id}`, () => eggModel(sp.id, 0), (cw - 8) * CELL_W, (gh - 4) * CELL_H, 2.5);
      const mid = cx + (cw >> 1);
      const oy = glassBot - 2;
      ex.push({
        key: `e:${sp.id}`, kind: "egg", room: rooms.length, sp: sp.id, owned: eggFound(p, sp.id),
        x0: cx, y0: glassBot - gh, x1: cx + cw - 1, y1: g.base, px: mid, py: glassBot + 2, r, ox: mid - Math.round(r.cx + r.w / 2), oy, k: gh,
      });
      cx += cw + 4;
    }
    x = r0;
    room("Galerie des fossiles", "Tresors de la roche : coquilles, ambre, oeufs...", cx - r0 + 22);
  }

  // Salle de la vie : un diorama par espèce, l'animal vivant tel qu'on l'imagine.
  {
    const tiers = hh >= 96 ? 3 : hh >= 52 ? 2 : 1;
    const dh = Math.floor((hh - 3) / tiers) - 4;
    const dw = Math.round((dh * CELL_H * 1.6) / CELL_W);
    const per = Math.ceil(SPECIES_LIST.length / tiers);
    const x0 = x + 24;
    SPECIES_LIST.forEach((sp, i) => {
      const col = i % per, tier = Math.floor(i / per);
      const bx = x0 + col * (dw + 8), by = g.ceil + 2 + tier * (dh + 4);
      let k = 1;
      try {
        k = Math.floor(fitScale(sp.model(IDLE_POSE), (dw - 6) * CELL_W, (dh - 4) * CELL_H * 0.85, 0.125, 2) * 8) / 8;
      } catch { /* modèle absent : échelle par défaut */ }
      ex.push({
        key: `l:${sp.id}`, kind: "life", room: rooms.length, sp: sp.id, owned: p.assembled.includes(sp.id),
        x0: bx, y0: by, x1: bx + dw - 1, y1: by + dh - 1, px: bx + (dw >> 1), py: by + dh, ox: 0, oy: 0, k,
      });
    });
    room("Salle de la vie", "Dioramas : chaque espece assemblee, telle qu'elle vivait", 24 + per * (dw + 8) + 16);
  }
  return { rooms, ex, width: x };
}

function makeStrip(cols: number, rows: number): Frame {
  const n = cols * rows;
  // Seuls ch/fg/bg servent : le reste du Frame est vide pour ne pas gaspiller la mémoire.
  return {
    cols, rows, ch: new Uint8Array(n), fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4),
    obj: new Uint8Array(0), lr: new Float32Array(0), lg: new Float32Array(0), lb: new Float32Array(0), acc: new Float32Array(0),
  };
}

// ---------------------------------------------------------------------------
// Petits outils de dessin sur la bande.
// ---------------------------------------------------------------------------
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

export function put(f: Frame, x: number, y: number, ch: number | string, fg: RGB, bg?: RGB) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = y * f.cols + x, k = i * 4;
  f.ch[i] = typeof ch === "string" ? ch.charCodeAt(0) : ch;
  f.fg[k] = fg[0]; f.fg[k + 1] = fg[1]; f.fg[k + 2] = fg[2]; f.fg[k + 3] = 255;
  if (bg) { f.bg[k] = bg[0]; f.bg[k + 1] = bg[1]; f.bg[k + 2] = bg[2]; f.bg[k + 3] = 255; }
}

/** Éclaircit une cellule vers une couleur de lumière (fond plein, glyphe un peu moins). */
export function lighten(f: Frame, x: number, y: number, col: RGB, a: number) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows || a <= 0) return;
  const k = (y * f.cols + x) * 4;
  for (let c = 0; c < 3; c++) {
    f.bg[k + c] = f.bg[k + c] + (col[c] - f.bg[k + c]) * a;
    f.fg[k + c] = f.fg[k + c] + (col[c] - f.fg[k + c]) * a * 0.6;
  }
}

/** Assombrit une cellule (ombres portées, embrasures). */
function shade(f: Frame, x: number, y: number, k: number) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = (y * f.cols + x) * 4;
  for (let c = 0; c < 3; c++) { f.bg[i + c] *= k; f.fg[i + c] *= k; }
}

/** Cône de lumière d'un projecteur, du plafond jusqu'au sol, et sa flaque sur le parquet. */
function cone(f: Frame, L: Look, cx: number, top: number, bottom: number, w0: number, w1: number, k: number) {
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const hw = w0 + (w1 - w0) * t;
    for (let x = Math.floor(cx - hw - 3); x <= Math.ceil(cx + hw + 3); x++) {
      const d = Math.abs(x - cx) / hw;
      const a = d < 1 ? 1 - d * d * 0.4 : Math.max(0, 1 - (d - 1) * hw / 3) * 0.6;
      lighten(f, x, y, L.light, a * k * (0.45 + 0.55 * t));
    }
  }
}

// ---------------------------------------------------------------------------
// Cuisson du décor.
// ---------------------------------------------------------------------------
const PIL = 56;

function bake(h: Hall, th: Theme) {
  const f = h.strip, g = h.geo, L = lookOf(th);
  h.rooms.forEach((r, i) => drawRoomShell(f, g, L, r, i));
  // Portiques entre les salles.
  for (let i = 1; i < h.rooms.length; i++) drawArch(f, g, L, h.rooms[i].x0);
  drawEntry(f, th, g, L, h.rooms[ROOMS.entry], entryFrames(h));
  for (const e of h.ex) drawExhibit(f, th, g, L, e);
  // Cordons devant les socles du grand hall et de la salle des mers.
  for (const ri of [ROOMS.hall, ROOMS.sea]) drawRopes(f, g, L, h.rooms[ri]);
}

function drawRoomShell(f: Frame, g: Geo, L: Look, r: Room, ri: number) {
  const wall = L.walls[ri] ?? L.walls[1];
  const dark = mul(wall, 0.86);
  const cart = L.spot < 0.25;
  for (let x = r.x0; x < r.x0 + r.w; x++) {
    const lx = x - r.x0;
    for (let y = 0; y < g.rows; y++) {
      if (y < g.ceil - 3) {
        // Plafond à caissons.
        const line = y % 4 === 3 || lx % 16 === 0;
        put(f, x, y, line ? (y % 4 === 3 ? "_" : "|") : 32, L.ceilLine, mul(L.ceiling, 0.92 + 0.08 * (y / g.ceil)));
      } else if (y < g.ceil) {
        // Corniche : moulure claire, denticules, ombre.
        const row = y - (g.ceil - 3);
        const ch = row === 0 ? "=" : row === 1 ? (lx % 3 === 0 ? "|" : "_") : "-";
        put(f, x, y, ch, row === 0 ? L.corniceHi : mul(L.cornice, 0.7), row === 2 ? mul(L.cornice, 0.8) : L.cornice);
      } else if (y < g.floor - 8) {
        // Mur : léger dégradé, plus sombre sous la corniche.
        const v = 0.9 + 0.1 * Math.min(1, (y - g.ceil) / 6);
        const tex = ri === ROOMS.sea ? (Math.sin(lx * 0.21 + y * 0.9) + Math.sin(lx * 0.07 - y * 0.4) > 1.3 ? "~" : 32) : hash2(x, y, 3) < 0.02 ? "." : 32;
        put(f, x, y, tex, mul(wall, cart ? 0.82 : 1.5), mul(wall, v));
      } else if (y < g.floor) {
        // Lambris de bois.
        const row = y - (g.floor - 8);
        const ch = row === 0 ? "=" : row === 7 ? "_" : lx % 14 === 0 ? "|" : row === 2 || row === 6 ? "-" : 32;
        put(f, x, y, ch, L.woodDark, mul(L.wood, row === 0 ? 1.1 : 0.95));
      } else {
        // Parquet : lames décalées, veinure, plus clair vers le spectateur.
        const row = y - g.floor;
        const v = 0.85 + 0.15 * (row / Math.max(1, g.rows - g.floor));
        const joint = (lx + (row >> 1) * 11) % 26 === 0;
        const ch = row === 0 ? "_" : row % 2 === 1 ? "_" : joint ? "|" : hash2(x, y, 5) < 0.06 ? "-" : 32;
        put(f, x, y, ch, L.floorDark, mul(row % 4 < 2 ? L.floor : mix(L.floor, L.floorDark, 0.25), v));
      }
    }
  }
  // Pilastres réguliers et panneaux encadrés entre eux.
  for (let px = r.x0 + 14; px < r.x0 + r.w - 10; px += PIL) {
    if (px + PIL - 8 < r.x0 + r.w - 4) drawPanel(f, g, L, px + 8, px + PIL - 8, ri, dark);
    drawPilaster(f, g, L, px);
  }
}

function drawPanel(f: Frame, g: Geo, L: Look, x0: number, x1: number, ri: number, inner: RGB) {
  const y0 = g.ceil + 3, y1 = g.floor - 11;
  if (y1 - y0 < 6) return;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const edge = y === y0 || y === y1 || x === x0 || x === x1;
      if (edge) put(f, x, y, y === y0 || y === y1 ? (x === x0 || x === x1 ? "+" : "-") : "|", L.frame);
      else if (ri !== ROOMS.sea && x >= 0 && x < f.cols) {
        const k = (y * f.cols + x) * 4;
        f.bg[k] = inner[0]; f.bg[k + 1] = inner[1]; f.bg[k + 2] = inner[2];
      }
    }
  // Grand hall : une haute fenêtre cintrée dans chaque panneau, et son rayon de soleil.
  if (ri === ROOMS.hall) {
    const cx = (x0 + x1) >> 1, ww = Math.min(9, (x1 - x0) >> 2);
    const wy0 = y0 + 2, wy1 = y0 + 2 + Math.max(8, Math.round((y1 - y0) * 0.45));
    for (let y = wy0; y <= wy1; y++)
      for (let x = cx - ww; x <= cx + ww; x++) {
        const dx = (x - cx) / ww, dy = (y - wy0) / Math.max(1, ww * 0.55);
        if (y - wy0 < ww * 0.55 && dx * dx + (1 - dy) * (1 - dy) > 1) continue;
        const t = (y - wy0) / (wy1 - wy0);
        const sky = mix(L.skyHi, L.sky, t);
        const mull = x === cx || (y - wy0) % 6 === 5;
        const cloud = !mull && hash2(x >> 2, y, 17) < 0.12;
        const star = L.spot > 0.25 && hash2(x, y, 23) < 0.05;
        put(f, x, y, mull ? (x === cx ? "|" : "-") : cloud ? "~" : star ? "." : 32, mull ? L.frame : L.skyHi, sky);
      }
    // Rayon oblique jusqu'au parquet.
    for (let y = wy1 + 1; y < g.floor + 4; y++) {
      const sh = Math.round((y - wy1) * 0.55);
      for (let x = cx - ww + sh; x <= cx + ww + sh; x++) lighten(f, x, y, L.light, L.spot * 0.35 * (1 - (y - wy1) / (g.floor + 4 - wy1)));
    }
  }
}

function drawPilaster(f: Frame, g: Geo, L: Look, x: number) {
  for (let y = g.ceil; y < g.floor; y++) {
    const cap = y < g.ceil + 2, foot = y >= g.floor - 3;
    const w = cap || foot ? 3 : 2;
    for (let dx = -w; dx <= w; dx++) {
      const edge = Math.abs(dx) === w;
      const ch = cap ? (y === g.ceil ? "=" : "-") : foot ? (y === g.floor - 3 ? "=" : y === g.floor - 1 ? "_" : 32) : dx === 0 || Math.abs(dx) === 1 ? (y % 2 ? ":" : "|") : 32;
      const bg = edge || dx > 0 ? L.columnShade : L.column;
      put(f, x + dx, y, ch, mul(L.columnShade, 0.8), bg);
    }
    // Ombre portée à droite.
    shade(f, x + w + 1, y, 0.86);
  }
}

/** Portique entre deux salles : deux piliers épais et un arc, embrasure dans l'ombre. */
function drawArch(f: Frame, g: Geo, L: Look, x: number) {
  const half = 14, top = g.ceil + 6;
  for (let y = g.ceil; y < g.floor; y++)
    for (let dx = -half; dx <= half; dx++) {
      const ax = Math.abs(dx);
      const inside = ax < half - 4;
      const archY = top + Math.round(((half - 4) * 0.55) * (1 - Math.sqrt(Math.max(0, 1 - (ax / (half - 4)) ** 2))) * 1.6);
      if (inside && y >= archY + 2) { shade(f, x + dx, y, 0.72); continue; }
      const edge = inside && y >= archY;
      const ch = edge ? (dx < -1 ? "/" : dx > 1 ? "\\" : "_") : ax === half - 4 || ax === half ? "|" : y % 3 === 0 ? "-" : 32;
      put(f, x + dx, y, ch, mul(L.columnShade, 0.75), dx === 0 && y < archY + 1 ? L.corniceHi : ax >= half - 1 ? L.columnShade : L.column);
    }
  // Clé de voûte.
  put(f, x, top - 1, "V", L.brass, L.corniceHi);
  // Fougères en pot de part et d'autre.
  for (const side of [-1, 1]) {
    const px = x + side * (half + 4);
    for (let y = g.floor - 1; y <= g.floor + 1; y++) for (let dx = -2; dx <= 2; dx++) put(f, px + dx, y, y === g.floor - 1 ? "=" : "#", mul(L.wood, 0.7), L.wood);
    const fr = ["\\", "|", "/"];
    for (let k = 0; k < 9; k++) {
      const a = -1 + (k / 8) * 2, len = 3 + ((k * 7) % 3);
      for (let t = 1; t <= len; t++) put(f, px + Math.round(a * t * 0.9), g.floor - 1 - t, fr[a < -0.3 ? 0 : a > 0.3 ? 2 : 1], L.fern);
    }
  }
}

/** Médaillon de l'accueil : centre (cellules du hall) et rayon (lignes). */
export function medal(h: Pick<Hall, "rooms" | "geo">) {
  const r = h.rooms[ROOMS.entry], g = h.geo;
  return { x: r.x0 + (r.w >> 1), cy: g.ceil + Math.round((g.floor - g.ceil) * 0.36), R: Math.max(8, Math.min(18, Math.round((g.floor - g.ceil) * 0.17))) };
}
const h0 = (r: Room, g: Geo) => ({ rooms: [r], geo: g });

/** Cadres dorés de l'accueil (cellules du hall) : statistiques à gauche, plan à droite. */
export function entryFrames(h: Hall): [number, number, number, number][] {
  const r = h.rooms[ROOMS.entry], g = h.geo;
  const mid = r.x0 + (r.w >> 1);
  const gap = medal(h).R * 2 + 6;
  const fw = Math.max(40, Math.min(80, Math.round((r.w - 2 * gap) * 0.4)));
  const y0 = g.ceil + 4;
  const rows = (n: number) => Math.min(g.floor - 11, y0 + Math.ceil((n * metrics.uiH) / metrics.cellH));
  return [
    [mid - fw - gap, y0, mid - gap, rows(22)],
    [mid + gap, y0, mid + fw + gap, rows(13)],
  ];
}

/** Hall d'accueil : bannières suspendues, médaillon à l'ammonite, cadres dorés, tapis rouge. */
function drawEntry(f: Frame, th: Theme, g: Geo, L: Look, r: Room, frames: [number, number, number, number][]) {
  const mid = r.x0 + (r.w >> 1);
  for (const bx of [frames[0][0] - 20, frames[1][2] + 10]) {
    if (bx < r.x0 + 2 || bx + 10 > r.x0 + r.w - 2) continue;
    const h = Math.round((g.floor - g.ceil) * 0.55);
    for (let y = g.ceil; y < g.ceil + h; y++)
      for (let dx = 0; dx < 10; dx++) {
        const tip = y >= g.ceil + h - 3 && Math.abs(dx - 4.5) > (g.ceil + h - y) * 1.6;
        if (tip) continue;
        const gold = dx === 0 || dx === 9 || y === g.ceil;
        put(f, bx + dx, y, gold ? "|" : (y - g.ceil) % 6 === 3 && dx > 2 && dx < 7 ? "@" : 32, gold ? L.bannerHi : mul(L.bannerHi, 0.9), gold ? mul(L.banner, 0.8) : L.banner);
      }
  }
  // Médaillon sculpté : une grande ammonite dans un cercle de laiton.
  const { R, cy } = medal(h0(r, g));
  for (let y = cy - R; y <= cy + R; y++)
    for (let x = mid - 2 * R; x <= mid + 2 * R; x++) {
      const d = Math.hypot((x - mid) / 2, y - cy) / R;
      if (d > 1) continue;
      put(f, x, y, d > 0.9 ? (d > 0.96 ? "o" : "=") : 32, mul(L.brass, 0.7), d > 0.9 ? L.brass : mix(L.column, L.columnShade, d * 0.8));
    }
  const amm = EXTRAS[0];
  const ar = cachedRaster(`medal|${R}`, () => {
    const ps = amm.prims();
    return scaleAll(ps, fitScale(ps, R * 3 * CELL_W, R * 1.5 * CELL_H, 0.5, 6));
  });
  drawRaster(f, th, ar, mid - Math.round(ar.cx + ar.w / 2), cy - Math.round(ar.cy + ar.h / 2), { tint: L.brass, light: 1.1 });
  // Grands cadres dorés (le contenu est écrit par l'interface).
  for (const [x0, y0, x1, y1] of frames) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const e = y === y0 || y === y1 || x === x0 || x === x1;
        if (e) put(f, x, y, (x === x0 || x === x1) && (y === y0 || y === y1) ? "#" : y === y0 || y === y1 ? "=" : "#", mul(L.brass, 0.7), L.brass);
      }
  }
  // Tapis d'entrée sur le parquet.
  for (let y = g.floor + 1; y < g.rows; y++)
    for (let x = mid - 30; x <= mid + 30; x++) {
      const e = x === mid - 30 || x === mid + 30;
      put(f, x, y, e ? "|" : (x + y) % 4 === 0 ? "." : 32, L.bannerHi, mul(L.banner, 0.95));
    }
}

/** Socle de pierre sombre, plateau clair, plaque de laiton (le texte vient de l'interface). */
function drawPlinth(f: Frame, L: Look, mid: number, base: number, w: number, h: number) {
  const x0 = mid - (w >> 1), x1 = x0 + w - 1;
  for (let y = base - h + 1; y <= base; y++)
    for (let x = x0; x <= x1; x++) {
      const top = y === base - h + 1, bot = y === base;
      const side = x === x0 || x === x1;
      const ch = top ? "=" : bot ? "_" : side ? "|" : 32;
      const bg = top ? L.plinthTop : mul(L.plinth, x > mid + w * 0.3 ? 0.85 : 1);
      put(f, x, y, ch, top ? mix(L.plinthTop, L.glassHi, 0.4) : mul(L.plinthTop, 0.9), bg);
    }
  // Ombre au sol, à droite.
  for (let y = base - h + 2; y <= base + 1; y++) for (let x = x1 + 1; x <= x1 + 2; x++) shade(f, x, y, 0.8);
}

function drawRopes(f: Frame, g: Geo, L: Look, r: Room) {
  const y = g.base + 2;
  if (y + 2 >= g.rows) return;
  const step = 22;
  for (let x = r.x0 + 18; x < r.x0 + r.w - 18; x += step) {
    // Poteau de laiton.
    put(f, x, y - 1, "o", L.brass);
    for (let k = 0; k <= 2; k++) put(f, x, y + k, k === 2 ? "^" : "|", L.brass);
    if (x + step >= r.x0 + r.w - 18) break;
    // Cordon de velours qui pend entre deux poteaux.
    for (let dx = 1; dx < step; dx++) {
      const t = dx / step;
      const sag = Math.sin(Math.PI * t) * 1.4;
      put(f, x + dx, y - 1 + Math.round(sag), sag > 0.7 && sag < 1.3 ? "_" : t < 0.5 ? "\\" : "/", L.rope);
    }
  }
}

function drawExhibit(f: Frame, th: Theme, g: Geo, L: Look, e: Exhibit) {
  const ink: RGB = th.outline ? th.pal.ink : th.pal.void;
  if (e.kind === "sp" && e.r) {
    const ph = e.k ?? 3;
    cone(f, L, e.px, g.ceil + 1, g.base, 2, Math.max(8, e.r.w * 0.55), L.spot);
    lamp(f, L, e.px, g.ceil);
    drawPlinth(f, L, e.px, g.base, Math.max(12, e.r.w + 6), ph);
    if (e.owned) {
      // Tiges du montage, du socle jusqu'au bassin.
      const top = g.base - ph;
      for (const fx of [0.38, 0.62]) {
        const x = e.ox + e.r.cx + Math.round(e.r.w * fx);
        for (let y = top; y > top - 30; y--) {
          const j = y - e.oy - e.r.cy, i = x - e.ox - e.r.cx;
          if (j >= 0 && j < e.r.h && e.r.mat[j * e.r.w + i]) break;
          put(f, x, y, "|", L.cable);
        }
      }
      if (th.outline) outlineRaster(f, e.r, e.ox, e.oy, ink);
      drawRaster(f, th, e.r, e.ox, e.oy, { light: 1.08 });
    } else drawRaster(f, th, e.r, e.ox, e.oy, { ghost: true, tint: L.ghost, light: 1.2 });
  } else if (e.kind === "sea" && e.r) {
    cone(f, L, e.px, g.ceil + 1, g.base, 2, Math.max(8, e.r.w * 0.45), L.spot * 0.8);
    drawPlinth(f, L, e.px, g.base, 22, 3);
    // Câbles depuis le plafond jusqu'au dos du squelette.
    for (const fx of [0.25, 0.72]) {
      const i = Math.round(e.r.w * fx);
      let j = 0;
      while (j < e.r.h - 1 && !e.r.mat[j * e.r.w + i]) j++;
      const x = e.ox + e.r.cx + i;
      for (let y = 0; y < e.oy + e.r.cy + j; y++) put(f, x, y, y < g.ceil ? "|" : ":", L.cable);
    }
    if (e.owned) {
      if (th.outline) outlineRaster(f, e.r, e.ox, e.oy, ink);
      drawRaster(f, th, e.r, e.ox, e.oy, { light: 1.08 });
    } else drawRaster(f, th, e.r, e.ox, e.oy, { ghost: true, tint: L.ghost, light: 1.2 });
  } else if ((e.kind === "extra" || e.kind === "egg") && e.r) {
    drawCase(f, th, L, e, ink);
  } else if (e.kind === "life") {
    drawDiorama(f, th, L, e);
  }
}

function lamp(f: Frame, L: Look, x: number, y: number) {
  put(f, x - 1, y, "\\", L.cable); put(f, x, y, "_", L.cable); put(f, x + 1, y, "/", L.cable);
  put(f, x, y + 1, "v", L.light);
}

/** Vitrine : meuble de bois, cage de verre (reflets obliques), objet au centre. */
function drawCase(f: Frame, th: Theme, L: Look, e: Exhibit, ink: RGB) {
  const gh = e.k ?? 12;
  const x0 = e.x0, x1 = e.x1, y0 = e.y0, gb = e.y0 + gh;
  const wall = mul(L.walls[ROOMS.fossils], 1);
  // Meuble : tiroirs et pieds.
  for (let y = gb; y <= e.y1; y++)
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      const top = y === gb, foot = y === e.y1;
      const ch = top ? "=" : foot ? (x === x0 + 2 || x === x1 - 2 ? "|" : 32) : x === x0 + 1 || x === x1 - 1 ? "|" : (y - gb) % 4 === 0 ? "-" : (y - gb) % 4 === 2 && x === (x0 + x1) >> 1 ? "o" : 32;
      put(f, x, y, ch, foot ? L.woodDark : mul(L.woodDark, 0.9), foot ? mul(wall, 0.8) : mul(L.wood, top ? 1.15 : 1));
    }
  // Cage de verre.
  const glass = mix(mul(wall, 0.9), L.glass, 0.45);
  for (let y = y0; y < gb; y++)
    for (let x = x0; x <= x1; x++) {
      const frame = x === x0 || x === x1 || y === y0;
      put(f, x, y, frame ? (y === y0 ? (x === x0 || x === x1 ? "+" : "-") : "|") : 32, L.brass, frame ? mul(L.brass, 0.6) : glass);
    }
  if (e.r) {
    if (e.owned) {
      if (th.outline) outlineRaster(f, e.r, e.ox, e.oy, ink);
      drawRaster(f, th, e.r, e.ox, e.oy, { light: 1.12 });
    } else {
      drawRaster(f, th, e.r, e.ox, e.oy, { ghost: true, tint: L.ghost, light: 1.3 });
      put(f, (x0 + x1) >> 1, y0 + 2, "?", L.ghost);
    }
  }
  // Reflets obliques sur le verre (seulement sur le vide, pour ne pas cacher l'objet).
  for (let y = y0 + 1; y < gb; y++)
    for (const off of [3, 5, 16]) {
      const x = x0 + off + (gb - y) - 2;
      if (x <= x0 || x >= x1) continue;
      if (f.ch[y * f.cols + x] !== 32) continue;
      put(f, x, y, "/", L.glassHi);
    }
  // Petit spot dans la vitrine.
  for (let y = y0 + 1; y < gb; y++) for (let x = x0 + 1; x < x1; x++) lighten(f, x, y, L.light, 0.12 * (1 - (y - y0) / gh));
}

/** Diorama : cadre de bois, décor peint selon l'habitat (l'animal vivant est ajouté à chaque image). */
function drawDiorama(f: Frame, th: Theme, L: Look, e: Exhibit) {
  const spec = SPECIES_LIST.find((q) => q.id === e.sp);
  const hab = spec?.habitat ?? "land";
  const w = e.x1 - e.x0 + 1, h = e.y1 - e.y0 + 1;
  const horizon = e.y0 + Math.round(h * 0.62);
  for (let y = e.y0; y <= e.y1; y++)
    for (let x = e.x0; x <= e.x1; x++) {
      const fr = x === e.x0 || x === e.x1 || y === e.y0 || y === e.y1;
      if (fr) { put(f, x, y, (x === e.x0 || x === e.x1) && (y === e.y0 || y === e.y1) ? "+" : y === e.y0 || y === e.y1 ? "=" : "#", mul(L.woodDark, 0.8), L.wood); continue; }
      if (!e.owned) {
        put(f, x, y, hash2(x, y, 9) < 0.03 ? "." : 32, L.ghost, mul(L.walls[ROOMS.life], 0.45));
        continue;
      }
      const t = (y - e.y0) / h, lx = (x - e.x0) / w;
      let bg: RGB, ch: number | string = 32, fg: RGB = L.skyHi;
      if (hab === "sea") {
        bg = mix(L.seaTop, L.seaDeep, t);
        if (Math.sin(lx * 40 + y * 1.3) > 0.93) { ch = "~"; fg = mix(L.seaTop, L.skyHi, 0.5); }
        if (y > e.y1 - 3) { bg = L.ground; ch = hash2(x, y, 2) < 0.3 ? "." : 32; fg = mul(L.ground, 0.7); }
      } else {
        bg = mix(L.skyHi, L.sky, Math.min(1, t * 1.5));
        const hill = horizon - Math.round(3 + 2.5 * Math.sin(lx * 9 + (spec?.id.length ?? 0)) + 1.5 * Math.sin(lx * 23));
        if (y >= hill) { bg = mix(L.hills, mul(L.hills, 0.8), (y - hill) / 6); ch = hash2(x, y, 4) < 0.1 ? "^" : 32; fg = mul(L.hills, 0.75); }
        if (y >= horizon) { bg = mix(L.ground, mul(L.ground, 0.8), (y - horizon) / Math.max(1, e.y1 - horizon)); ch = hash2(x, y, 6) < 0.12 ? "," : 32; fg = mul(L.hills, 0.8); }
        if (y < hill && hash2(x >> 3, y, 31) < 0.08) { ch = "~"; fg = L.skyHi; }
      }
      put(f, x, y, ch, fg, bg);
    }
  // Vitre : un reflet en haut à gauche.
  for (let k = 0; k < Math.min(w, h) * 0.5; k++) {
    const x = e.x0 + 3 + k, y = e.y0 + Math.round(h * 0.45) - k;
    if (y > e.y0 && x < e.x1) lighten(f, x, y, L.glassHi, 0.25);
  }
}

/** Tout ce qui vit dans la bande : positions des pièces visibles, pour la scène. */
export function visible(h: Hall, camX: number, cols: number): Exhibit[] {
  return h.ex.filter((e) => e.x1 >= camX && e.x0 < camX + cols);
}

