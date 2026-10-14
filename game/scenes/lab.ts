import { CELL_H, CELL_W, DEV, PX_PER_M, WORLD_H, WORLD_W } from "../config";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import { saveProgress } from "../progress";
import { setBg, setFg, type Frame } from "../render/frame";
import { metrics, uiCellAt } from "../render/metrics";
import { rasterize, type Prim, type Raster } from "../render/raster";
import { drawRaster } from "../render/sprite";
import { hash2 } from "../rng";
import { discovered, shownName, SPECIES } from "../species";
import { eggModel } from "../species/eggs";
import { liveBirth, MAX_PER_SPECIES } from "../species/life";
import type { Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { calm } from "../settings";
import { actions, button, buttonW, hitAt, overlay, panel, put as uiPut, SP, text, wrap, type Hint } from "../ui/kit";
import { toast } from "../ui/toast";
import { unlockTrigger } from "../unlock";
import { bonePrims, clipCols, deName, IDLE_POSE, outlineRaster, primBounds, rasterMid, scaleAll, skeletonPrims } from "./dig-fossils";
import { canStand, centerOn, observeNest, parkScene, syncPopulation } from "./park";
import { SM } from "./scenes.mat";
import { UI_TOP, type Scene } from "./types";

/**
 * Atelier : on remonte le squelette os par os (glisser depuis le plateau, ou clic puis clic),
 * puis la synthèse transforme le squelette en animal vivant, envoyé dans la réserve.
 */

export interface LabState {
  species: SpeciesId | null;
  /** Os posés sur le squelette, par espèce (le temps de la partie). */
  placed: Partial<Record<SpeciesId, string[]>>;
  /** Os choisi d'un clic dans le plateau (on clique ensuite sa place). */
  held: string | null;
  drag: { bone: string } | null;
  flash: { bone: string; t: number } | null;
  shake: { bone: string; t: number } | null;
  synth: { sp: SpeciesId; t0: number } | null;
  /** Dernière synthèse terminée : le modèle reste affiché, avec un message. */
  /** Fin de synthèse ; `first` = première fois : l'espèce mystère est révélée. */
  done: { sp: SpeciesId; added: number; t: number; first: boolean } | null;
  hint: { text: string; t: number } | null;
  /** Dernier nid installé depuis l'atelier (bouton « Voir le nid »). */
  nest?: { sp: SpeciesId; id: number; t: number } | null;
  /** Défilement de la liste des espèces (lignes). */
  scroll?: number;
}

export function createLabState(): LabState {
  return { species: null, placed: {}, held: null, drag: null, flash: null, shake: null, synth: null, done: null, hint: null, nest: null };
}

const LEFT_W = 28, RIGHT_W = 34;
const SYNTH_T = 2.5;
const MAX_POP = 10;
const HUMAN_M = 1.75;

// ---------------------------------------------------------------------------
// Rasters en cache : squelette os par os, modèle, vignettes, silhouette humaine.
// ---------------------------------------------------------------------------
const cache = new Map<string, Raster>();
function cached(key: string, build: () => Prim[]): Raster {
  let r = cache.get(key);
  if (!r) {
    let ps: Prim[] = [];
    try { ps = build(); } catch { ps = []; }
    r = rasterize(ps, 0, 0);
    if (cache.size > 600) cache.delete(cache.keys().next().value as string);
    cache.set(key, r);
  }
  return r;
}

const bigBone = (spec: Species, id: string, s: number) => cached(`${spec.id}|b|${id}|${s}`, () => scaleAll(bonePrims(spec, id), s));
const modelRaster = (spec: Species, s: number) => cached(`${spec.id}|m|${s}`, () => scaleAll(spec.model(IDLE_POSE), s));

/** Silhouette humaine (1,75 m) à gauche de l'animal, à la même échelle. */
function humanRaster(hx: number, s: number) {
  return cached(`human|${hx}|${s}`, () => {
    const H = HUMAN_M * PX_PER_M, m = SM.Human;
    const ps: Prim[] = [
      { k: "e", x: hx, y: -H + 4.5, rx: 4, ry: 4.5, m, z: 6, h: 4 },
      { k: "c", ax: hx, ay: -H + 12, bx: hx, by: -H * 0.47, ra: 4.2, rb: 3.6, m, z: 4, h: 4 },
      { k: "c", ax: hx - 1.6, ay: -H * 0.47, bx: hx - 2.6, by: -1.5, ra: 2, rb: 1.5, m, z: 3, h: 2 },
      { k: "c", ax: hx + 1.6, ay: -H * 0.47, bx: hx + 2.6, by: -1.5, ra: 2, rb: 1.5, m, z: 3, h: 2 },
      { k: "c", ax: hx - 3.5, ay: -H + 13, bx: hx - 6, by: -H * 0.5, ra: 1.5, rb: 1.2, m, z: 5, h: 2 },
      { k: "c", ax: hx + 3.5, ay: -H + 13, bx: hx + 6, by: -H * 0.5, ra: 1.5, rb: 1.2, m, z: 5, h: 2 },
    ];
    return scaleAll(ps, s);
  });
}

/** Os de l'espèce déjà trouvés (ids valides seulement). */
const foundOf = (s: GameState, spec: Species) => {
  const got = s.progress.bones[spec.id] ?? [];
  return spec.bones.filter((b) => got.includes(b.id)).map((b) => b.id);
};
const isAssembled = (s: GameState, sp: SpeciesId) => s.progress.assembled.includes(sp);
const placedOf = (s: GameState, spec: Species) => (isAssembled(s, spec.id) ? spec.bones.map((b) => b.id) : (s.lab.placed[spec.id] ?? []));
const complete = (s: GameState, spec: Species) => placedOf(s, spec).length >= spec.bones.length;

// ---------------------------------------------------------------------------
// Mise en page (cellules du calque monde).
// ---------------------------------------------------------------------------
const boundsCache = new Map<SpeciesId, [number, number, number, number]>();
/** Boîte (px) du squelette et du modèle réunis : x0, y0 (haut), x1. */
function specBounds(spec: Species): [number, number, number, number] {
  let b = boundsCache.get(spec.id);
  if (!b) {
    let [x0, y0, x1, y1] = primBounds(skeletonPrims(spec));
    try {
      const [a, c, d, e] = primBounds(spec.model(IDLE_POSE));
      x0 = Math.min(x0, a); y0 = Math.min(y0, c); x1 = Math.max(x1, d); y1 = Math.max(y1, e);
    } catch { /* modèle absent : on se contente du squelette */ }
    b = [x0, y0, x1, y1];
    boundsCache.set(spec.id, b);
  }
  return b;
}

interface Layout {
  left: number; right: number; top: number;
  trayY: number; trayH: number; ground: number;
  /** Échelle du squelette et cellule de son origine (pieds). */
  s: number; ox: number; oy: number;
  /** Boîte du modèle en cellules monde. */
  bx0: number; bx1: number; by0: number;
  hx: number;
}

function layout(spec: Species | undefined): Layout {
  const { rows, uiW, uiH, cellW, cellH, ucols } = metrics;
  const left = Math.ceil(((LEFT_W + 2) * uiW) / cellW) + 1;
  const right = Math.max(left + 40, Math.floor(((ucols - RIGHT_W - 2) * uiW) / cellW) - 1);
  const top = Math.ceil((uiH * UI_TOP) / cellH) + 2;
  const bottom = Math.ceil((uiH * 1.3) / cellH);
  const trayH = 15;
  const trayY = rows - bottom - trayH;
  const ground = trayY - 5;
  if (!spec) return { left, right, top, trayY, trayH, ground, s: 1, ox: 0, oy: ground, bx0: 0, bx1: 0, by0: 0, hx: 0 };
  const [x0, y0, x1, y1] = specBounds(spec);
  // Modèles qui descendent sous leur origine (le mosasaure nage sous sa ligne d'eau) : on les remonte
  // sur l'estrade pour que tout le squelette soit visible.
  const lift = Math.max(0, y1);
  const hPx = Math.max(lift - y0, HUMAN_M * PX_PER_M + 2);
  // Silhouette humaine à gauche, toujours séparée de l'animal par au moins GAP cellules à l'écran.
  const GAP = 6;
  const fit = (sc: number) => {
    const hx = x0 - 6 - (GAP * CELL_W) / sc;
    return { hx, w: x1 - (hx - 6) };
  };
  let sc = 1;
  for (let k = 0; k < 3; k++) {
    const { w } = fit(sc);
    sc = Math.min(((right - left) * CELL_W * 0.92) / w, ((ground - top - 3) * CELL_H * 0.9) / hPx);
  }
  const s = Math.max(0.2, Math.min(8, Math.floor(sc * 8) / 8));
  const { hx } = fit(s);
  const ox = Math.round((left + right) / 2 - (((hx - 6 + x1) / 2) * s) / CELL_W);
  const oy = ground - Math.ceil((lift * s) / CELL_H);
  return { left, right, top, trayY, trayH, ground, s, ox, oy, bx0: ox + Math.floor((x0 * s) / CELL_W), bx1: ox + Math.ceil((x1 * s) / CELL_W), by0: oy + Math.floor((y0 * s) / CELL_H), hx };
}

interface Box { bone: string; x: number; y: number; w: number; h: number }

/** Os trouvés mais pas encore posés, rangés dans le plateau. */
function trayBoxes(s: GameState, spec: Species, L: Layout): Box[] {
  const placed = placedOf(s, spec);
  const list = foundOf(s, spec).filter((id) => !placed.includes(id));
  if (!list.length) return [];
  const span = L.right - L.left - 4;
  const w = Math.max(10, Math.min(38, Math.floor(span / list.length) - 2));
  const x0 = L.left + 2 + Math.floor((span - list.length * (w + 2)) / 2);
  return list.map((bone, k) => ({ bone, x: x0 + k * (w + 2), y: L.trayY + 2, w, h: L.trayH - 4 }));
}

function thumb(spec: Species, id: string, b: Box, max: number): Raster {
  const ps = bonePrims(spec, id);
  const [x0, y0, x1, y1] = primBounds(ps);
  const raw = Math.min(((b.w - 3) * CELL_W) / Math.max(1, x1 - x0), ((b.h - 4) * CELL_H) / Math.max(1, y1 - y0), max);
  const sc = Math.max(0.25, Math.floor(raw * 4) / 4);
  return cached(`${spec.id}|t|${id}|${sc}`, () => scaleAll(ps, sc));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function hint(s: GameState, t: string) {
  s.lab.hint = { text: t, t: s.time };
}

function boneName(spec: Species, id: string) {
  return spec.bones.find((b) => b.id === id)?.name ?? id;
}

function placeBone(s: GameState, spec: Species, id: string) {
  const list = (s.lab.placed[spec.id] ??= []);
  if (!list.includes(id)) list.push(id);
  s.lab.flash = { bone: id, t: s.time };
  s.lab.held = null;
  if (complete(s, spec)) hint(s, "Squelette complet ! Clique sur SYNTHETISER pour decouvrir de qui il s'agit.");
  else hint(s, `${boneName(spec, id)} : en place !`);
}

/** Tente de poser `id` à la cellule monde (x, y). `centered` : l'os est tenu par son centre (glisser). */
function tryDrop(s: GameState, spec: Species, L: Layout, id: string, x: number, y: number, centered: boolean) {
  const fits = (bone: string) => {
    const r = bigBone(spec, bone, L.s);
    const m = rasterMid(r);
    const cx = L.ox + m.x, cy = L.oy + m.y;
    if (centered && Math.abs(x - cx) <= Math.max(7, r.w * 0.3) && Math.abs(y - cy) <= Math.max(5, r.h * 0.35)) return true;
    return x >= L.ox + r.cx - 2 && x <= L.ox + r.cx + r.w + 2 && y >= L.oy + r.cy - 2 && y <= L.oy + r.cy + r.h + 2 && !centered;
  };
  if (fits(id)) return placeBone(s, spec, id);
  const other = spec.bones.find((b) => b.id !== id && fits(b.id));
  if (other || (y < L.trayY && x >= L.bx0 - 4 && x <= L.bx1 + 4 && y >= L.by0 - 3)) {
    s.lab.shake = { bone: id, t: s.time };
    s.lab.held = null;
    hint(s, other ? `Pas tout a fait : cette place est celle de l'os << ${boneName(spec, other.id)} >>. Compare les formes !`
      : "Hmm, ce n'est pas sa place. Regarde bien les pointilles.");
  }
}

function autoPlace(s: GameState, spec: Species) {
  const placed = placedOf(s, spec);
  const next = foundOf(s, spec).find((id) => !placed.includes(id));
  if (next) placeBone(s, spec, next);
  else if (complete(s, spec)) startSynth(s, spec);
  else hint(s, "Il manque des os : retourne a la fouille (touche 2) pour les trouver !");
}

function startSynth(s: GameState, spec: Species) {
  if (s.lab.synth || !complete(s, spec)) return;
  if ((s.progress.population[spec.id] ?? 0) >= MAX_POP) return hint(s, `La reserve compte deja ${MAX_POP} ${shownName(s.progress, spec.id)} : c'est le maximum.`);
  s.lab.synth = { sp: spec.id, t0: s.time };
  s.lab.done = null;
}

function finishSynth(s: GameState, spec: Species) {
  const p = s.progress;
  const first = !p.assembled.includes(spec.id);
  if (first) p.assembled.push(spec.id);
  const [a, b] = spec.behavior.herd;
  const n = b > 1 ? Math.max(1, a + Math.floor(Math.random() * (b - a + 1))) : 1;
  const cur = p.population[spec.id] ?? 0;
  const added = Math.max(0, Math.min(n, MAX_POP - cur));
  p.population[spec.id] = cur + added;
  delete s.lab.placed[spec.id];
  saveProgress(p);
  syncPopulation(s);
  s.lab.synth = null;
  s.lab.done = { sp: spec.id, added, t: s.time, first };
  // Pas de notification ici : la modale de fin de synthèse dit déjà la même chose.
  if (first) unlockTrigger(s, spec.id, "assemble");
}

/** Œufs fossiles prêts à incuber pour cette espèce (jamais pour les vivipares comme le mosasaure). */
const eggsOf = (s: GameState, sp: SpeciesId) => (liveBirth(SPECIES[sp]) || !isAssembled(s, sp) ? 0 : (s.progress.eggs[sp] ?? 0));

/** Individus vivants + œufs en couveuse de l'espèce dans la réserve (plafond MAX_PER_SPECIES). */
function parkCount(s: GameState, sp: SpeciesId): number {
  const p = s.park;
  return p.animals.filter((a) => a.sp === sp && a.task !== "dead").length + p.nests.filter((n) => n.sp === sp && n.hatched === undefined).reduce((k, n) => k + n.eggs, 0);
}

/**
 * Incube un œuf fossile : un nid apparaît dans la réserve, près des congénères s'il y en a
 * (sinon n'importe où sur la terre ferme), loin des autres nids.
 */
function incubate(s: GameState, spec: Species) {
  const p = s.progress;
  if (eggsOf(s, spec.id) <= 0) return;
  // La réserve doit exister (monde, population) pour y poser le nid.
  parkScene.enter?.(s);
  if (parkCount(s, spec.id) >= MAX_PER_SPECIES) return hint(s, `La reserve compte deja ${MAX_PER_SPECIES} ${spec.name}s : garde l'oeuf pour plus tard.`);
  const park = s.park;
  const kin = park.animals.filter((a) => a.sp === spec.id && a.task !== "dead");
  const free = (x: number, y: number) => canStand(s, spec.id, x, y) && !park.nests.some((n) => Math.hypot(n.x - x, n.y - y) < 70);
  let pos: { x: number; y: number } | null = null;
  for (let k = 0; k < 400 && !pos; k++) {
    const a = kin.length && k < 250 ? kin[k % kin.length] : undefined;
    const x = a ? a.x + (Math.random() - 0.5) * 320 : 200 + Math.random() * (WORLD_W - 400);
    const y = a ? a.y + (Math.random() - 0.5) * 150 : 200 + Math.random() * (WORLD_H - 400);
    if (free(x, y)) pos = { x, y };
  }
  if (!pos) return hint(s, "Pas de place pour un nid dans la reserve, reessaie plus tard.");
  p.eggs[spec.id] = (p.eggs[spec.id] ?? 1) - 1;
  saveProgress(p);
  const id = park.nextNest++;
  park.nests.push({ id, sp: spec.id, x: pos.x, y: pos.y, eggs: 1, t: 0, guard: 0, fossil: true });
  s.lab.nest = { sp: spec.id, id, t: s.time };
  toast(s, "Oeuf mis a incuber !", `Un nid ${deName(spec.name)} t'attend dans la reserve. Va le voir eclore !`);
}

/** Espèce ouverte par défaut : une espèce commencée mais pas encore assemblée, sinon la première découverte. */
function pickDefault(s: GameState): SpeciesId | null {
  const list = discovered(s.progress);
  return (list.find((sp) => !isAssembled(s, sp.id)) ?? list[0])?.id ?? null;
}

export const labScene: Scene = {
  enter(s) {
    const l = s.lab;
    if (!l.species || !discovered(s.progress).some((sp) => sp.id === l.species)) l.species = pickDefault(s);
  },

  update(s, input: Input) {
    const l = s.lab;
    if (!l.species || !discovered(s.progress).some((sp) => sp.id === l.species)) l.species = pickDefault(s);
    const spec = l.species ? SPECIES[l.species] : undefined;
    if (!spec) return;
    const L = layout(spec);
    const select = (sp: SpeciesId) => {
      if (l.synth || sp === l.species) return;
      l.species = sp; l.held = null; l.drag = null; l.done = null; l.hint = null;
    };

    for (const k of input.pressed) {
      const list = discovered(s.progress);
      const i = list.findIndex((x) => x.id === l.species);
      if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ") select(list[(i + list.length - 1) % list.length].id);
      if (k === "ArrowDown" || k === "KeyS") select(list[(i + 1) % list.length].id);
      if ((k === "Enter" || k === "Space") && !l.synth) autoPlace(s, spec);
    }
    // Molette sur la liste des espèces : défilement.
    const mc = uiCellAt(input.mouse.x, input.mouse.y);
    if (input.mouse.wheel && mc.x >= listRect.x && mc.x < listRect.x + listRect.w && mc.y >= listRect.y && mc.y < listRect.y + listRect.h) {
      l.scroll = Math.max(0, (l.scroll ?? 0) + Math.sign(input.mouse.wheel) * 2);
      input.mouse.wheel = 0;
    }
    for (const id of input.ui) {
      if (id === "lab:dismiss") l.done = null;
      if (id.startsWith("lab:sp:")) select(id.slice(7) as SpeciesId);
      if (id === "lab:auto") autoPlace(s, spec);
      if (id === "lab:all") for (let n = 0; n < spec.bones.length; n++) autoPlace(s, spec);
      if (id === "lab:synth") startSynth(s, spec);
      if (id === "lab:incubate") incubate(s, spec);
      if (id === "lab:seenest" && l.nest) {
        s.mode = "park";
        parkScene.enter?.(s);
        const n = s.park.nests.find((m) => m.id === l.nest?.id);
        if (n) { observeNest(s, n); centerOn(s, n.x, n.y); }
        l.nest = null;
        return;
      }
      if (id === "lab:park") {
        s.mode = "park";
        parkScene.enter?.(s);
        // La caméra rejoint et suit le dinosaure qu'on vient de synthétiser.
        const born = s.park.animals.filter((a) => a.sp === spec.id).pop();
        if (born) { s.park.selected = born.id; s.park.follow = true; s.park.cam.x = born.x - 600; s.park.cam.y = born.y - 350; }
        return;
      }
    }
    if (l.synth) {
      if (s.time - l.synth.t0 >= SYNTH_T) finishSynth(s, spec);
      return;
    }

    // Glisser-déposer depuis le plateau, ou clic puis clic.
    const cell = (px: number, py: number) => ({ x: px / metrics.cellW, y: py / metrics.cellH });
    const boxes = trayBoxes(s, spec, L);
    const boxAt = (c: { x: number; y: number }) => boxes.find((b) => c.x >= b.x && c.x < b.x + b.w && c.y >= b.y && c.y < b.y + b.h);
    for (const p of input.mouse.presses) {
      if (p.button !== 0 || hitAt(p.x, p.y)) continue;
      const b = boxAt(cell(p.x, p.y));
      if (b) l.drag = { bone: b.bone };
    }
    for (const r of input.mouse.releases) {
      if (!l.drag) continue;
      const c = cell(r.x, r.y);
      const b = boxAt(c);
      if (b && b.bone === l.drag.bone) l.held = l.held === b.bone ? null : b.bone; // simple clic : on saisit l'os
      else if (!b) tryDrop(s, spec, L, l.drag.bone, c.x, c.y, true);
      l.drag = null;
    }
    if (!input.mouse.down && !input.mouse.releases.length) l.drag = null;
    for (const c of input.worldClicks) {
      const q = cell(c.x, c.y);
      if (q.y >= L.trayY) continue;
      if (l.held) { tryDrop(s, spec, L, l.held, q.x, q.y, false); continue; }
      // Clic sur une place vide : on dit quel os y va.
      const placed = placedOf(s, spec);
      const slot = spec.bones.find((b) => {
        if (placed.includes(b.id)) return false;
        const r = bigBone(spec, b.id, L.s);
        const i = Math.floor(q.x) - L.ox - r.cx, j = Math.floor(q.y) - L.oy - r.cy;
        return i >= 0 && j >= 0 && i < r.w && j < r.h && r.mat[j * r.w + i] !== 0;
      });
      if (slot) hint(s, foundOf(s, spec).includes(slot.id) ? `Ici va : ${slot.name}. Il t'attend dans le plateau !` : `Ici va : ${slot.name}. Pas encore trouve : retourne fouiller !`);
    }
  },

  compose(s, th, world, ui) {
    const l = s.lab;
    const spec = l.species ? SPECIES[l.species] : undefined;
    const L = layout(spec);
    drawBackdrop(th, world, L);
    if (spec) drawStage(s, th, world, spec, L);
    drawUi(s, th, ui, spec, L);
  },

  hints(s) {
    const h: Hint[] = [["Glisser", "poser un os"], ["Entree", "placer un os"], ["Haut/Bas", "espece"]];
    if (s.lab.held) h.unshift(["Clic", "poser l'os saisi"]);
    return h;
  },

  help() {
    return [
      ["Glisser", "deposer un os du plateau sur sa place dans le squelette"],
      ["Clic", "saisir un os du plateau, puis clic sur sa place"],
      ["Entree", "placer automatiquement un os (ou Espace)"],
      ["Haut/Bas", "espece precedente / suivante (molette sur la liste : defiler)"],
      ["Echap", "lacher l'os saisi, fermer le message de synthese"],
    ];
  },

  back(s) {
    const l = s.lab;
    if (l.done) { l.done = null; return true; }
    if (l.held) { l.held = null; return true; }
    return false;
  },
};

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
let backdrop: { key: string; ch: Uint8Array; fg: Uint8ClampedArray; bg: Uint8ClampedArray } | null = null;

/** Mur de l'atelier (papier quadrillé) et établi en bois ; en cache, recopié à chaque image. */
function drawBackdrop(th: Theme, f: Frame, L: Layout) {
  const key = `${f.cols}x${f.rows}|${th.style}|${L.trayY}`;
  if (!backdrop || backdrop.key !== key) {
    const cart = th.style === "cartoon";
    const wall = th.mats[SM.Wall].color, grid = th.mats[SM.Grid].color, bench = th.mats[SM.Bench].color, edge = th.mats[SM.BenchEdge].color;
    const top = L.trayY - 1;
    for (let y = 0; y < f.rows; y++)
      for (let x = 0; x < f.cols; x++) {
        const i = y * f.cols + x;
        if (y < top) {
          // Lumière de studio : plus claire au centre, plus sombre vers les bords.
          const nx = x / f.cols - 0.5, ny = y / f.rows - 0.4;
          const v = 1 - Math.min(0.55, (nx * nx * 1.2 + ny * ny * 1.6) * (cart ? 0.6 : 1.6));
          // Papier millimétré : grands traits tous les 24x12, petits points entre.
          const gx = x % 24 === 0, gy = y % 12 === 0;
          f.ch[i] = gx && gy ? 43 : gx ? (y % 2 ? 124 : 32) : gy ? (x % 2 ? 45 : 32) : x % 6 === 0 && y % 3 === 0 ? 46 : 32;
          const g = gx || gy ? grid : wall;
          setFg(f, i, g[0] * v * (cart ? 1 : 1.4), g[1] * v * (cart ? 1 : 1.4), g[2] * v * (cart ? 1 : 1.4));
          setBg(f, i, wall[0] * v, wall[1] * v, wall[2] * v);
        } else {
          // Établi : planches, veinure, chant épais.
          const row = y - top;
          const plank = row === 0 || row % 5 === 0;
          const h = hash2(x >> 1, y, 7);
          const tone = 0.85 + 0.15 * Math.sin(x * 0.07 + row * 1.3) + (hash2(Math.floor(x / 30), row >> 2, 9) - 0.5) * 0.15;
          const c = plank ? edge : bench;
          f.ch[i] = row === 0 ? 61 : plank ? 95 : h < 0.3 ? code(th.mats[SM.Bench].ramp, h * 3.3) : 32;
          setFg(f, i, c[0] * tone * (cart ? 0.7 : 1.3), c[1] * tone * (cart ? 0.7 : 1.3), c[2] * tone * (cart ? 0.7 : 1.3));
          setBg(f, i, bench[0] * tone * (cart ? 1 : 0.55), bench[1] * tone * (cart ? 1 : 0.55), bench[2] * tone * (cart ? 1 : 0.55));
        }
      }
    backdrop = { key, ch: new Uint8Array(f.ch), fg: new Uint8ClampedArray(f.fg), bg: new Uint8ClampedArray(f.bg) };
    return;
  }
  f.ch.set(backdrop.ch);
  f.fg.set(backdrop.fg);
  f.bg.set(backdrop.bg);
}

const code = (s: string, h: number) => s.charCodeAt(Math.min(s.length - 1, Math.max(0, Math.floor(h * s.length))));

function put(f: Frame, x: number, y: number, ch: number, fg: readonly number[], bg?: readonly number[]) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = y * f.cols + x;
  f.ch[i] = ch;
  setFg(f, i, fg[0], fg[1], fg[2]);
  if (bg) setBg(f, i, bg[0], bg[1], bg[2]);
}

function drawStage(s: GameState, th: Theme, f: Frame, spec: Species, L: Layout) {
  const l = s.lab;
  const ink: RGB = th.outline ? th.pal.ink : th.pal.void;
  const hi = th.ui.hi;
  const stake = th.mats[SM.Stake].color, edge = th.mats[SM.BenchEdge].color;

  // Socle et tiges du montage de musée.
  for (let x = L.bx0 - 3; x <= L.bx1 + 3; x++) {
    put(f, x, L.ground + 1, x === L.bx0 - 3 || x === L.bx1 + 3 ? 43 : 61, edge.map((v) => v * 1.3), edge.map((v) => v * 0.6));
    put(f, x, L.ground + 2, 95, edge.map((v) => v * 0.8), edge.map((v) => v * 0.4));
  }
  const cy = L.ground + Math.round((spec.center.y * L.s) / CELL_H);
  for (const fx of [-0.45, 0.4]) {
    const x = L.ox + Math.round((spec.center.x + spec.halfLen * fx) * L.s / CELL_W);
    for (let y = cy; y <= L.ground; y++) put(f, x, y, 124, stake);
  }

  // Silhouette humaine pour l'échelle.
  const hr = humanRaster(L.hx, L.s);
  drawRaster(f, th, hr, L.ox, L.ground, { light: 0.95 });

  const synth = l.synth && l.synth.sp === spec.id ? l.synth : null;
  const showModel = !synth && l.done && l.done.sp === spec.id;
  const placed = placedOf(s, spec);

  if (synth || showModel) {
    // Synthèse : la ligne de balayage change le squelette en chair.
    const t = synth ? Math.min(1, (s.time - synth.t0) / SYNTH_T) : 1;
    const e = t * t * (3 - 2 * t);
    const scan = Math.round(L.bx0 - 2 + (L.bx1 - L.bx0 + 4) * e) - L.ox;
    const model = modelRaster(spec, L.s);
    const mClip = clipCols(model, -9999, scan);
    const bones = spec.bones.map((b) => clipCols(bigBone(spec, b.id, L.s), scan, 9999));
    if (th.outline) { outlineRaster(f, mClip, L.ox, L.oy, ink); for (const r of bones) outlineRaster(f, r, L.ox, L.oy, ink); }
    for (const r of bones) drawRaster(f, th, r, L.ox, L.oy);
    const breath = showModel ? 1 + 0.06 * Math.sin(s.time * 2.4) : 1.1;
    drawRaster(f, th, mClip, L.ox, L.oy, { light: breath });
    if (synth) {
      const sc = th.mats[SM.Scan].color, sp = th.mats[SM.Spark].color;
      const x = L.ox + scan;
      for (let y = L.by0 - 3; y <= L.ground; y++) {
        put(f, x, y, 124, sc, sc.map((v) => v * 0.35));
        put(f, x - 1, y, 58, sc.map((v) => v * 0.6));
      }
      for (let k = 0; k < 26; k++) {
        const h1 = hash2(k, Math.floor(s.time * 20), 1), h2 = hash2(k, Math.floor(s.time * 20), 2);
        put(f, x + Math.round((h1 - 0.6) * 10), L.by0 - 2 + Math.floor(h2 * (L.ground - L.by0 + 2)), h1 < 0.3 ? 42 : h1 < 0.6 ? 43 : 46, sp);
      }
    }
    return;
  }

  // Places vides en pointillés, os posés en relief (contour d'encre d'abord, puis les os).
  const flash = l.flash && s.time - l.flash.t < 0.6 ? l.flash : null;
  const mouse = { x: s.mouse.x / metrics.cellW, y: s.mouse.y / metrics.cellH };
  for (const b of spec.bones) {
    if (placed.includes(b.id)) continue;
    const r = bigBone(spec, b.id, L.s);
    const i = Math.floor(mouse.x) - L.ox - r.cx, j = Math.floor(mouse.y) - L.oy - r.cy;
    const over = i >= 0 && j >= 0 && i < r.w && j < r.h && r.mat[j * r.w + i] !== 0;
    const want = (l.held ?? l.drag?.bone) === b.id && Math.sin(s.time * 6) > 0;
    drawRaster(f, th, r, L.ox, L.oy, { ghost: true, tint: over || want ? hi : undefined, light: over || want ? 1.6 : 1 });
  }
  const placedR = placed.map((id) => ({ id, r: bigBone(spec, id, L.s) }));
  if (th.outline) for (const p of placedR) outlineRaster(f, p.r, L.ox, L.oy, ink);
  for (const p of placedR) {
    const k = flash && flash.bone === p.id ? 1 - (s.time - flash.t) / 0.6 : 0;
    drawRaster(f, th, p.r, L.ox, L.oy, { light: 1 + k * 0.9 });
    if (k > 0) {
      const m = rasterMid(p.r);
      for (let n = 0; n < 10; n++) {
        const a = n * 0.63 + s.time * 3, rr = (1 - k) * 14 + 3;
        put(f, L.ox + Math.round(m.x + Math.cos(a) * rr), L.oy + Math.round(m.y + Math.sin(a) * rr * 0.5), 42, th.mats[SM.Spark].color);
      }
    }
  }

  // Œufs fossiles posés sur l'établi, avec une douce lueur : ils attendent la couveuse.
  const eggs = eggsOf(s, spec.id);
  if (eggs > 0 && !trayBoxes(s, spec, L).length) {
    const er = cached(`${spec.id}|egg`, () => scaleAll(eggModel(spec.id, 0), 3));
    const glow = 0.35 + 0.2 * Math.sin(s.time * 2.2);
    const bench = th.mats[SM.Bench].color;
    const halo = bench.map((v, i) => v + (hi[i] - v) * glow) as unknown as RGB;
    for (let k = 0; k < Math.min(3, eggs); k++) {
      const x0 = eggX(L) + k * (er.w + 3), y0 = L.trayY + L.trayH - 3;
      outlineRaster(f, er, x0, y0, halo);
      if (th.outline) outlineRaster(f, er, x0, y0, ink);
      drawRaster(f, th, er, x0, y0, { light: 1.05 + glow * 0.5 });
    }
  }

  // Plateau : un casier par os trouvé.
  for (const b of trayBoxes(s, spec, L)) {
    const sel = l.held === b.bone, dragging = l.drag?.bone === b.bone;
    const shake = l.shake && l.shake.bone === b.bone && s.time - l.shake.t < 0.45 ? Math.round(Math.sin((s.time - l.shake.t) * 50) * 2) : 0;
    const col = sel ? hi : edge.map((v) => v * 1.4);
    const felt = th.style === "cartoon" ? th.mats[SM.Bench].color.map((v) => v * 0.8) : th.mats[SM.Bench].color.map((v) => v * 0.35);
    for (let j = 0; j < b.h; j++)
      for (let i = 0; i < b.w; i++) {
        const border = i === 0 || j === 0 || i === b.w - 1 || j === b.h - 1;
        const corner = (i === 0 || i === b.w - 1) && (j === 0 || j === b.h - 1);
        put(f, b.x + i + shake, b.y + j, corner ? 43 : border ? (j === 0 || j === b.h - 1 ? 45 : 124) : 32, col, felt);
      }
    if (dragging) continue;
    const r = thumb(spec, b.bone, b, L.s);
    const m = rasterMid(r);
    const x0 = b.x + Math.floor(b.w / 2 - m.x) + shake, y0 = b.y + Math.floor((b.h - 2) / 2 - m.y);
    if (th.outline) outlineRaster(f, r, x0, y0, ink);
    drawRaster(f, th, r, x0, y0, { light: sel ? 1.25 + 0.2 * Math.sin(s.time * 6) : 1 });
  }

  // Os tenu à la main, centré sur la souris.
  if (l.drag) {
    const r = bigBone(spec, l.drag.bone, L.s);
    const m = rasterMid(r);
    const x0 = Math.round(mouse.x - m.x), y0 = Math.round(mouse.y - m.y);
    outlineRaster(f, r, x0, y0, th.outline ? ink : hi.map((v) => v * 0.4) as unknown as RGB);
    drawRaster(f, th, r, x0, y0, { light: 1.2 });
  }
}

/** Colonne monde du premier œuf posé sur l'établi. */
const eggX = (L: Layout) => L.left + 10;

function drawUi(s: GameState, th: Theme, ui: Frame, spec: Species | undefined, L: Layout) {
  const l = s.lab, u = th.ui, p = s.progress;
  const T = (x: number, y: number, str: string, col: RGB = u.text) => text(ui, x, y, str, col, u.panel, u.alpha);

  // --- Espèces (gauche) ---
  // Seules les espèces dont on a trouvé des os apparaissent ; leur nom reste caché jusqu'à l'assemblage.
  // Une ligne par espèce (nom, os trouvés), défilante à la molette si la liste dépasse.
  const lx = SP.margin, ly = UI_TOP, inner = LEFT_W - 4;
  const list = discovered(p);
  const anyAsm = list.some((sp) => isAssembled(s, sp.id));
  const maxH = ui.rows - 2 - ly;
  const want = 2 + Math.max(1, list.length) + (list.length ? 0 : 3) + (anyAsm ? 2 : 0);
  const lh = Math.max(6, Math.min(maxH, want));
  const view = Math.max(1, lh - 2 - (anyAsm ? 2 : 0) - (list.length ? 0 : 3));
  panel(ui, th, lx, ly, LEFT_W, lh, "Especes");
  listRect = { x: lx, y: ly, w: LEFT_W, h: lh, view };
  let y = ly + 1;
  if (!list.length) wrap("Aucun os pour l'instant. Va fouiller (touche 2) : chaque espece trouvee apparaitra ici.", inner).slice(0, lh - 2).forEach((t, i) => T(lx + 2, y + i, t, u.dim));
  const maxScroll = Math.max(0, list.length - view);
  // Nouvelle espèce choisie : elle revient dans la partie visible.
  const si = list.findIndex((sp) => sp.id === l.species);
  let off = Math.max(0, Math.min(maxScroll, l.scroll ?? 0));
  if (l.species !== listSel) {
    listSel = l.species;
    if (si >= 0 && si < off) off = si;
    if (si >= off + view) off = si - view + 1;
  }
  l.scroll = off;
  for (let i = off; i < Math.min(list.length, off + view); i++) {
    const sp = list[i];
    const found = foundOf(s, sp).length, need = sp.bones.length;
    // Nom dans le bouton ; os trouvés et « * » (assemblé) dans la colonne de droite.
    const cnt = `${found}/${need}${isAssembled(s, sp.id) ? " *" : ""}`;
    const bw = LEFT_W - 9;
    button(ui, th, `lab:sp:${sp.id}`, lx + 2, y, shownName(p, sp.id), { w: bw, active: l.species === sp.id, tip: `${shownName(p, sp.id)} : ${found} os sur ${need}` });
    T(lx + 3 + bw, y, cnt, found >= need ? u.ok : u.dim);
    y++;
  }
  if (maxScroll > 0) {
    // Ascenseur.
    const pos = Math.round((off / maxScroll) * (view - 1));
    for (let i = 0; i < view; i++) uiPut(ui, lx + LEFT_W - 1, ly + 1 + i, i === pos ? 35 : 58, i === pos ? u.hi : u.dim, u.panel, u.alpha);
  }
  if (anyAsm) T(lx + 2, ly + lh - 2, "* = deja assemble", u.dim);

  if (!spec) return;
  const found = foundOf(s, spec), placed = placedOf(s, spec);
  const known = found.length > 0 || isAssembled(s, spec.id);
  const named = isAssembled(s, spec.id);

  // --- Fiche (droite) ---
  const rw = RIGHT_W, rx = ui.cols - rw - 1, ry = UI_TOP, rin = rw - 4;
  const lines: [string, RGB][] = [];
  if (known && !named) {
    // Espèce mystère : on ne sait que ce que disent les os.
    wrap("Qui est-ce ? Assemble son squelette pour le decouvrir !", rin).forEach((t) => lines.push([t, u.hi]));
    lines.push(["", u.text]);
    lines.push(["Taille, poids, regime : ???", u.dim]);
    lines.push(["", u.text]);
    lines.push([`Os places : ${placed.length} / ${spec.bones.length}`, u.hi]);
    for (const b of spec.bones) {
      const st = placed.includes(b.id) ? "[x]" : found.includes(b.id) ? "[ ]" : "[?]";
      const name = found.includes(b.id) || placed.includes(b.id) ? b.name : "???";
      lines.push([`${st} ${name}`.slice(0, rin), placed.includes(b.id) ? u.ok : found.includes(b.id) ? u.text : u.dim]);
    }
  } else if (known) {
    lines.push([spec.latin, u.dim]);
    wrap(spec.period, rin).forEach((t) => lines.push([t, u.text]));
    const ratio = spec.lengthM / HUMAN_M;
    lines.push([`Longueur : ${String(spec.lengthM).replace(".", ",")} m`, u.text]);
    lines.push([ratio >= 1.5 ? `  = ${Math.round(ratio)} adultes allonges !` : "  = a peu pres ta taille", u.dim]);
    lines.push([`Poids : ${spec.massKg >= 1000 ? `${String(Math.round(spec.massKg / 100) / 10).replace(".", ",")} tonnes` : `${spec.massKg} kg`}`, u.text]);
    lines.push([`Regime : ${spec.behavior.diet === "carnivore" ? "carnivore" : spec.behavior.diet === "herbivore" ? "herbivore" : "omnivore"}`, u.text]);
    lines.push(["", u.text]);
    lines.push([`Os places : ${placed.length} / ${spec.bones.length}`, u.hi]);
    for (const b of spec.bones) {
      const st = placed.includes(b.id) ? "[x]" : found.includes(b.id) ? "[ ]" : "[?]";
      const name = found.includes(b.id) || placed.includes(b.id) ? b.name : "???";
      lines.push([`${st} ${name}`.slice(0, rin), placed.includes(b.id) ? u.ok : found.includes(b.id) ? u.text : u.dim]);
    }
    lines.push(["", u.text]);
    lines.push([`Dans la reserve : ${p.population[spec.id] ?? 0} / ${MAX_POP}`, u.dim]);
    const eggs = eggsOf(s, spec.id);
    if (eggs > 0) {
      lines.push(["", u.text]);
      lines.push([`Oeufs fossiles : ${eggs}`, u.hi]);
      wrap("Incube-le : il eclora dans un nid de la reserve.", rin).forEach((t) => lines.push([t, u.dim]));
    }
  } else {
    wrap("Espece encore inconnue. Fouille les sites (touche 2) pour trouver ses os : sa silhouette apparaitra ici.", rin).forEach((t) => lines.push([t, u.dim]));
  }
  const rh = lines.length + 3;
  panel(ui, th, rx, ry, rw, rh, known ? shownName(p, spec.id) : "???");
  lines.forEach(([t, c], i) => T(rx + 2, ry + 1 + i, t, c));
  let by = ry + rh - 2 + 2;
  const unplaced = found.some((id) => !placed.includes(id));
  if (eggsOf(s, spec.id) > 0 && !l.synth) {
    const full = parkCount(s, spec.id) >= MAX_PER_SPECIES;
    button(ui, th, "lab:incubate", rx, by, full ? "Reserve pleine" : "Incuber un oeuf", { w: rw, disabled: full, variant: "primary", tip: "L'oeuf eclora dans un nid de la reserve" });
    by += 2;
  }
  if (l.nest && l.nest.sp === spec.id && !l.synth) {
    button(ui, th, "lab:seenest", rx, by, "Voir le nid", { w: rw, tip: "Aller voir le nid dans la reserve" });
    by += 2;
  }
  if (known && unplaced && !l.synth) {
    button(ui, th, "lab:auto", rx, by, "Placer un os", { w: rw, key: "Entree", tip: "Place automatiquement un os trouve" });
    by += 2;
    // Raccourci de test (dev uniquement).
    if (DEV) { button(ui, th, "lab:all", rx, by, "Tout placer (test)", { w: rw, variant: "ghost", tip: "Test : placer tous les os trouves" }); by += 2; }
  }

  // --- Grand bouton de synthèse, sous le squelette ---
  const midUi = Math.floor(((L.left + L.right) / 2) * metrics.cellW / metrics.uiW);
  const btnY = Math.floor(((L.ground + 3) * metrics.cellH) / metrics.uiH);
  if (l.done && l.done.sp === spec.id && !l.synth) {
    // Modale dimensionnée sur son contenu : titre, phrase, puis les deux choix côte à côte.
    const ok = l.done.added > 0;
    const msg = !ok ? "La reserve est pleine pour cette espece." : l.done.first ? `C'est un ${spec.name} ! Envoye dans la reserve.` : "Envoye dans la reserve !";
    const sub = !ok ? `Maximum : ${MAX_POP} individus par espece.`
      : l.done.added > 1 ? `${l.done.added} ${spec.name}s vivent maintenant dans la reserve.` : `Ton ${spec.name} vit maintenant dans la reserve.`;
    const b1 = "Voir dans la reserve", b2 = "Encore un";
    const bw = buttonW(b1) + SP.gap + buttonW(b2);
    const w = Math.min(ui.cols - 2, Math.max(msg.length, sub.length, bw) + 8), h = 7;
    // Sous l'estrade, pour ne pas cacher l'animal fraîchement synthétisé.
    const x = Math.max(1, Math.min(ui.cols - w - 1, midUi - Math.floor(w / 2))), y = Math.min(btnY, ui.rows - h - 2);
    overlay(() => {
      panel(ui, th, x, y, w, h, ok ? "Synthese reussie" : "Reserve pleine", { close: "lab:dismiss", overlay: true });
      T(x + Math.max(2, Math.floor((w - msg.length) / 2)), y + 2, msg.slice(0, w - 4), ok ? u.ok : u.bad);
      T(x + Math.max(2, Math.floor((w - sub.length) / 2)), y + 3, sub.slice(0, w - 4), u.text);
      actions(ui, th, x + 2, y + 5, w - 4, [
        { id: "lab:synth", label: b2, disabled: (p.population[spec.id] ?? 0) >= MAX_POP, tip: "Synthetiser un autre individu" },
        { id: "lab:park", label: b1, variant: "primary" },
      ]);
    });
  } else if (complete(s, spec) && !l.synth) {
    const full = (p.population[spec.id] ?? 0) >= MAX_POP;
    const label = full ? `Reserve pleine (${MAX_POP})` : "SYNTHETISER";
    const w = label.length + 12, x = midUi - Math.floor(w / 2);
    panel(ui, th, x, btnY - 1, w, 3);
    // Clignotement d'appel coupé si les animations sont réduites.
    button(ui, th, "lab:synth", x + 2, btnY, label, { w: w - 4, variant: !full && (calm() || Math.sin(s.time * 4) > -0.3) ? "primary" : "secondary", disabled: full, tip: "Ramener l'espece a la vie dans la reserve" });
  } else if (l.synth) {
    const msg = "Synthese en cours...";
    T(midUi - Math.floor(msg.length / 2), btnY, msg, u.hi);
  }

  // Étiquette sous la silhouette humaine.
  const hm = rasterMid(humanRaster(L.hx, L.s));
  const hxUi = Math.floor(((L.ox + hm.x) * metrics.cellW) / metrics.uiW);
  const hyUi = Math.ceil(((L.ground + 1) * metrics.cellH) / metrics.uiH);
  text(ui, hxUi - 3, hyUi, "1,75 m", u.dim, u.panel, 0.6);

  // Étiquette sous les œufs de l'établi.
  const eggs = eggsOf(s, spec.id);
  if (eggs > 0 && !trayBoxes(s, spec, L).length) {
    const t = ` Oeuf${eggs > 1 ? "s" : ""} fossile${eggs > 1 ? "s" : ""} x${eggs} `;
    text(ui, Math.floor((eggX(L) * metrics.cellW) / metrics.uiW) - 2, Math.ceil(((L.trayY + L.trayH - 2) * metrics.cellH) / metrics.uiH), t, u.hi, u.panel, 0.85);
  }

  // Noms des os dans le plateau.
  for (const b of trayBoxes(s, spec, L)) {
    const name = boneName(spec, b.bone);
    const wUi = Math.floor((b.w * metrics.cellW) / metrics.uiW) - 1;
    const xUi = Math.ceil((b.x * metrics.cellW) / metrics.uiW) + 1;
    const yUi = Math.floor(((b.y + b.h - 2) * metrics.cellH) / metrics.uiH);
    const t = name.length > wUi ? `${name.slice(0, Math.max(1, wUi - 1))}.` : name;
    text(ui, xUi + Math.max(0, Math.floor((wUi - t.length) / 2)), yUi, t, l.held === b.bone ? u.panel : u.text, l.held === b.bone ? u.hi : u.panel, 0.85);
  }
  if (!trayBoxes(s, spec, L).length && known && !complete(s, spec)) {
    const msg = "Plateau vide : trouve d'autres os a la fouille (touche 2) !";
    T(midUi - Math.floor(msg.length / 2), Math.floor(((L.trayY + L.trayH / 2) * metrics.cellH) / metrics.uiH), msg, u.dim);
  }

  // Bulle au survol d'une place vide.
  const mc = uiCellAt(s.mouse.x, s.mouse.y);
  const mx = s.mouse.x / metrics.cellW, my = s.mouse.y / metrics.cellH;
  if (!l.synth && !l.drag && my < L.trayY) {
    const slot = spec.bones.find((b) => {
      if (placed.includes(b.id)) return false;
      const r = bigBone(spec, b.id, L.s);
      const i = Math.floor(mx) - L.ox - r.cx, j = Math.floor(my) - L.oy - r.cy;
      return i >= 0 && j >= 0 && i < r.w && j < r.h && r.mat[j * r.w + i] !== 0;
    });
    if (slot) {
      const t = ` ${found.includes(slot.id) ? slot.name : "???"} `;
      text(ui, Math.min(ui.cols - t.length - 1, mc.x + 2), mc.y - 1, t, u.text, u.panel, 0.95);
    }
  }

  if (l.hint && s.time - l.hint.t < 3.5) {
    const lines = wrap(l.hint.text, 56);
    const w = Math.max(...lines.map((t) => t.length)) + 4, x = midUi - Math.floor(w / 2), y0 = Math.max(UI_TOP, Math.floor((L.top * metrics.cellH) / metrics.uiH));
    panel(ui, th, x, y0, w, lines.length + 2);
    lines.forEach((t, i) => T(x + 2, y0 + 1 + i, t));
  }

}

/** Rectangle de la liste des espèces à la dernière image (molette). */
let listRect = { x: 0, y: 0, w: 0, h: 0, view: 1 };
/** Espèce choisie à la dernière image (pour ramener la liste sur un nouveau choix). */
let listSel: SpeciesId | null = null;
