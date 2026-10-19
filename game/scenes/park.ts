import { CELL_H, CELL_W, DEV, WORLD_H, WORLD_W } from "../config";
import { CLOCK_SPEEDS, clockLabel, daylight, litTheme, periodName } from "../daycycle";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { composeMap, composeWorld, type Actor, type Critter, type MapMark } from "../render/compose";
import { metrics, uiCellAt, worldCellAt } from "../render/metrics";
import { placed, RasterCache, type Raster } from "../render/raster";
import { mulberry32 } from "../rng";
import { SPECIES, SPECIES_LIST } from "../species";
import type { Action, FactUnlock, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { actions, bar, emptyState, hitAt, panel, put, region, SP, text, toolbar, wrap, type Hint, type ToolItem } from "../ui/kit";
import { unlockTrigger } from "../unlock";
import { BIOME, type BiomeId } from "../world/biomes";
import { isWater } from "../world/tiles";
import { faunaActors, faunaAt, faunaDef, noteFauna, type Bug } from "./eco-fauna";
import { activity, stepEcosystem, type EcoState } from "./ecosystem";
import { deName } from "./dig-fossils";
import { activeTrees, treeRaster, updateTrees } from "../world/trees";
import { drawDocuLog, drawDocumentary, missedCount, stopDocumentary, updateDocumentary } from "../features/documentary";
import { drawPhoto, updatePhoto } from "../features/photo";
import { drawThunder, drawWeather, drawWeatherRows, updateWeather, weatherClick, weatherTheme } from "../features/weather";
import { INCUBATION, juvenilePrims, lifespan, STAGE_AT } from "../species/life";
import { nestModel } from "../species/eggs";
import { toast } from "../ui/toast";
import { addTestCouple, retireAnimal } from "./eco-nest";
import { displayName, drawAnimalCard, drawNestCard, drawRoster, nestCrack, rosterOver, ROSTER_STEP, theName } from "./park-roster";
import { NAV, navOk, standable } from "./nav";
import { UI_TOP, type Scene } from "./types";

/**
 * Réserve : caméra libre au-dessus d'un écosystème où vivent les dinosaures synthétisés.
 * On ne joue aucun animal : on observe, et cliquer un animal remplit le carnet.
 * Le comportement des bêtes est dans ecosystem.ts (et eco-fauna.ts pour la petite faune).
 */

/** Tâche de l'IA (voir ecosystem.ts). */
export type Task =
  | "wander" | "graze" | "drink" | "rest" | "call"
  | "hunt" | "chase" | "attack" | "feed"
  | "flee" | "defend" | "stunned" | "retreat" | "dead";

export interface Animal {
  id: number;
  sp: SpeciesId;
  /** Pieds, px monde. */
  x: number;
  y: number;
  facing: 1 | -1;
  walk: number;
  /** 0..1, fondu immobile -> en mouvement. */
  moving: number;
  action: Action;
  actionT: number;
  /** Décalage de temps propre : les respirations ne sont pas synchronisées. */
  phase: number;
  inWater: boolean;
  /** Cible de déplacement (px monde). */
  tx: number;
  ty: number;
  /** Minuteur générique de l'IA (s). */
  timer: number;
  /** Besoins 0..1 (1 = urgent). */
  hunger: number;
  thirst: number;
  /** 1 = en forme, 0 = épuisé. */
  energy: number;
  hp: number;
  /** Ce que fait l'animal, en clair, pour l'interface et le carnet (« herd », « hunt », « flee »...). */
  mood: string;
  /** Taille du groupe autour de lui (lui compris). */
  herd: number;
  targetId: number;
  task: Task;
  /** Prochain balayage des alentours (menaces, proies), s. */
  scan: number;
  /** Sonné (s). */
  stun: number;
  /** Délai avant de rechasser ou de refrapper (s). */
  cool: number;
  /** Carcasse : temps restant (s) et viande restante 0..1. */
  decay: number;
  meat: number;
  /** Réponse différée à un appel (s) ; -1 = l'appel en cours est une réponse. */
  answer: number;
  /** Âge relatif : 0 jeune adulte, 1 vieil individu (plus facile à attraper). */
  age: number;
  /** Plante ou point d'eau visé (index), -1 sinon. */
  spot: number;
  /** Côté préféré pour contourner un obstacle. */
  side: 1 | -1;
  /** Temps bloqué contre un obstacle, durée de poursuite (s). */
  blocked: number;
  chase: number;
  /** Alerte (cri avant de fuir), s. */
  alarm: number;
  /**
   * gx, gy : position à la frame précédente ; vx, vy : direction de marche lissée (pour la formation
   * du troupeau) ; vt : suiveur en route (1) ou posé à sa place (0). best, stall : réservés.
   */
  gx: number;
  gy: number;
  best: number;
  stall: number;
  vx: number;
  vy: number;
  vt: number;
  /** Chemin A* en cours (points d'étape x, y en px), index du prochain point, but pour lequel il a été calculé. */
  path: number[] | null;
  pi: number;
  pgx: number;
  pgy: number;
  /** Prochain recalcul du chemin (s), meilleure distance au point d'étape et temps sans progrès vers lui. */
  repath: number;
  prog: number;
  progT: number;
  /** Temps cumulé bloqué : au-delà de quelques secondes, l'animal change d'objectif. */
  stuckT: number;
  /** Âge réel (s) depuis la naissance (ou l'arrivée), voir species/life.ts. */
  life: number;
  /** Taille relative 0.32 (bébé) .. 1 (adulte), recalculée depuis `life`. */
  growth: number;
  /** Parent suivi par un jeune (id), 0 sinon. Nid gardé par un parent (id), 0 sinon. */
  parentId: number;
  nestId: number;
  /** Prochaine nichée possible (s). */
  breedCool: number;
  /** Gestation en cours (espèces vivipares) : avancement 0..1, 0 sinon. */
  gestation?: number;
  /** Mort de vieillesse ou retiré à la main : disparaît sans laisser de carcasse à manger. */
  natural?: boolean;
  /** Altitude (px) des espèces volantes : 0 = posé au sol. Le dessin est décalé vers le haut, l'ombre reste au sol. */
  alt: number;
}

export interface ParkState {
  /** Coin haut-gauche de la caméra, px monde. */
  cam: { x: number; y: number };
  animals: Animal[];
  nextId: number;
  selected?: number;
  hover?: number;
  /** Petite bête sélectionnée / survolée (uid de la faune). */
  bug?: number;
  bugHover?: number;
  /** Caméra qui suit l'animal sélectionné. */
  follow: boolean;
  critters: (Critter & { hx: number; hy: number })[];
  /** Herbe couchée : instant du dernier passage par cellule (voir WorldView.trample). */
  trample: Uint16Array | null;
  started: boolean;
  /** Vitesse de repousse des arbres (accélérée après la météorite). */
  regrow?: number;
  /** Calque de debug de la navigation (dev, touche N). */
  debugNav?: boolean;
  /** Écosystème : plantes, points d'eau, petite faune. */
  eco: EcoState | null;
  /** Molette cumulée (passer d'un animal à l'autre). */
  wheel: number;
  /** Nids de la réserve (voir eco-nest.ts). */
  nests: Nest[];
  nextNest: number;
  /** Nid sélectionné / survolé. */
  nestSel?: number;
  nestHover?: number;
  /** Interface : recensement ouvert (touche C) et son défilement (lignes). */
  roster?: boolean;
  /** Mini-carte masquée (touche M). */
  hideMap?: boolean;
  rosterScroll?: number;
  /** Animal pour lequel on demande confirmation avant de le retirer. */
  confirmRetire?: number;
  /** Niveau de zoom (indice dans ZOOMS ; défaut ZOOM_DEFAULT) et pincement cumulé. */
  zoom?: number;
  zoomAcc?: number;
}

/**
 * Niveaux de zoom de la réserve, du plus proche au plus large. `z` : taille des glyphes ; `m` : cellules
 * monde par cellule écran (au-delà de 1, vue carte). Le dernier montre toute la carte.
 */
const ZOOMS: readonly { z: number; m: number; name: string }[] = [
  { z: 2, m: 1, name: "x2" },
  { z: 1.5, m: 1, name: "x1.5" },
  { z: 1, m: 1, name: "x1" },
  { z: 1, m: 3, name: "carte" },
  { z: 1, m: 6, name: "carte large" },
  { z: 1, m: 12, name: "toute la carte" },
];
const ZOOM_DEFAULT = 2;

/** Zoom effectif : documentaire, appareil photo et cinématiques restent au zoom normal. */
function zoomLevel(s: GameState) {
  if (s.mode !== "park" || s.photo.aiming || s.docu.on) return ZOOMS[ZOOM_DEFAULT];
  return ZOOMS[s.park.zoom ?? ZOOM_DEFAULT];
}

/** Taille des glyphes du monde pour le Renderer (seule la réserve zoome). */
export function worldZoom(s: GameState): number {
  return zoomLevel(s).z;
}

/** Taille de la vue en px monde (fenêtre / zoom des glyphes x cellules par bloc de la carte). */
const viewW = (s: GameState) => (metrics.cols * metrics.cellW * zoomLevel(s).m) / zoomLevel(s).z;
const viewH = (s: GameState) => (metrics.rows * metrics.cellH * zoomLevel(s).m) / zoomLevel(s).z;

/** Change de niveau de zoom en gardant le point (px monde) `ax, ay` sous le même endroit de l'écran. */
function setZoom(s: GameState, level: number, ax?: number, ay?: number) {
  const p = s.park;
  const n = Math.max(0, Math.min(ZOOMS.length - 1, level));
  if (n === (p.zoom ?? ZOOM_DEFAULT)) return;
  const w0 = viewW(s), h0 = viewH(s);
  const fx = ax === undefined ? 0.5 : (ax - p.cam.x) / w0, fy = ay === undefined ? 0.5 : (ay - p.cam.y) / h0;
  const cx = p.cam.x + w0 * fx, cy = p.cam.y + h0 * fy;
  p.zoom = n;
  p.cam.x = cx - viewW(s) * fx;
  p.cam.y = cy - viewH(s) * fy;
}

/** Un nid : quelques œufs qui éclosent au bout de l'incubation ; un parent le garde. */
export interface Nest {
  id: number;
  sp: SpeciesId;
  /** Position au sol (px monde). */
  x: number;
  y: number;
  /** Œufs restants (les prédateurs peuvent en voler). */
  eggs: number;
  /** Incubation écoulée (s) ; éclosion à species/life.ts INCUBATION. */
  t: number;
  /** Parent gardien (id d'animal), 0 si abandonné. */
  guard: number;
  /** Nid issu d'un œuf fossile incubé à l'atelier. */
  fossil?: boolean;
  /** Éclos : coquilles vides, il disparaît après un moment (s restantes). */
  hatched?: number;
}

/** Horloge de l'herbe couchée : dixièmes de seconde modulo 65536, jamais 0 (0 = jamais piétiné). */
const trampleNow = (s: GameState) => (Math.floor(s.time * 10) & 0xffff) || 1;

export function createParkState(): ParkState {
  return { cam: { x: 0, y: 0 }, animals: [], nextId: 1, follow: false, critters: [], trample: null, started: false, eco: null, wheel: 0, nests: [], nextNest: 1 };
}

const cache = new RasterCache(3000);
const TAU = Math.PI * 2;

/** Raster d'un animal à sa pose actuelle, quantifiée pour réutiliser le cache. */
export function animalRaster(a: Animal, time: number): Raster {
  const spec = SPECIES[a.sp]!;
  const moving = a.moving > 0.5 ? 1 : 0;
  const wq = Math.floor(((a.walk % TAU) + TAU) % TAU / (TAU / 12));
  const tq = moving ? 0 : Math.floor(((time + a.phase) % 4.8) * 6);
  const aq = Math.floor(a.actionT * 8) % 8;
  const flip = a.facing < 0;
  // Taille quantifiée (bébés et juvéniles) : quelques paliers suffisent, le cache reste petit.
  const gq = a.growth >= 0.995 ? 1 : Math.round(a.growth * 12) / 12;
  const key = `${a.sp}|${flip ? 1 : 0}|${a.action}|${moving}|${wq}|${tq}|${aq}|${gq}`;
  const r = cache.get(key, () => juvenilePrims(spec.model({ walk: wq * (TAU / 12), moving, time: tq / 6, action: a.action, actionT: aq / 8 }), spec, gq), flip);
  return placed(r, Math.floor(a.x / CELL_W), Math.floor((a.y - a.alt) / CELL_H));
}

/** Raster d'un nid (œufs, fissures quantifiées, coquilles vides), placée à sa position. */
export function nestRaster(n: Nest): Raster {
  const cq = Math.round(nestCrack(n) * 4) / 4;
  const eggs = Math.max(0, Math.min(6, n.eggs));
  const r = cache.get(`nest|${n.sp}|${eggs}|${cq}|${n.hatched !== undefined ? 1 : 0}`, () => nestModel(n.sp, eggs, cq, n.hatched !== undefined), false);
  return placed(r, Math.floor(n.x / CELL_W), Math.floor(n.y / CELL_H));
}

/** Identifiant d'acteur d'un nid (ne croise ni les animaux, ni la faune, ni les arbres). */
const nestActorId = (id: number) => -200000 - id;

/** Un animal peut-il se tenir à (x, y) ? Pas d'eau profonde ni d'obstacle sous le corps. */
export function canStand(s: GameState, sp: SpeciesId, x: number, y: number): boolean {
  // Même emprise que la grille de navigation : collisions et chemins sont toujours d'accord.
  return standable(worldFor(s), sp, x, y);
}

const HOME: readonly BiomeId[] = [BIOME.HellCreek, BIOME.Swamp];

/** Le point est-il dans un biome d'origine de l'espèce ? (nageurs et volants : partout où ils tiennent) */
export function atHome(s: GameState, sp: SpeciesId, x: number, y: number): boolean {
  const spec = SPECIES[sp];
  if (!spec || (spec.habitat ?? "land") !== "land") return true;
  const w = worldFor(s);
  const cx = Math.floor(x / CELL_W), cy = Math.floor(y / CELL_H);
  if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) return false;
  return (spec.biomes ?? HOME).includes(w.biome[cy * w.cols + cx] as BiomeId);
}

function spawn(s: GameState, sp: SpeciesId, near?: { x: number; y: number }) {
  const p = s.park;
  const rng = mulberry32(p.nextId * 7919 + 13);
  for (let k = 0; k < 400; k++) {
    const x = near && k < 300 ? near.x + (rng() - 0.5) * 360 : 200 + rng() * (WORLD_W - 400);
    const y = near && k < 300 ? near.y + (rng() - 0.5) * 160 : 200 + rng() * (WORLD_H - 400);
    if (!canStand(s, sp, x, y) || (!(near && k < 300) && !atHome(s, sp, x, y))) continue;
    const a: Animal = {
      id: p.nextId++, sp, x, y, facing: rng() < 0.5 ? 1 : -1, walk: 0, moving: 0, action: "idle", actionT: 0,
      phase: rng() * 10, inWater: false, tx: x, ty: y, timer: rng() * 3, hunger: rng() * 0.5, thirst: rng() * 0.5,
      energy: 0.6 + rng() * 0.4, hp: 1, mood: "wander", herd: 1, targetId: 0,
      task: "wander", scan: rng() * 0.4, stun: 0, cool: 10 + rng() * 20, decay: 0, meat: 0, answer: 0,
      age: rng() * rng(), spot: -1, side: rng() < 0.5 ? 1 : -1, blocked: 0, chase: 0, alarm: 0,
      gx: x, gy: y, best: Infinity, stall: 0, vx: 0, vy: 0, vt: 0,
      path: null, pi: 0, pgx: x, pgy: y, repath: 0, prog: Infinity, progT: 0, stuckT: 0, alt: 0,
      // Arrivée en jeune adulte (âge tiré au hasard dans la vie adulte).
      life: (SPECIES[sp] ? lifespan(SPECIES[sp]!) : 1800) * (STAGE_AT.adult + 0.05 + rng() * 0.4), growth: 1, parentId: 0, nestId: 0, breedCool: 120 + rng() * 300,
    };
    p.animals.push(a);
    return a;
  }
  return undefined;
}

/** Aligne la réserve sur la progression : chaque individu synthétisé (vivant) y vit. */
export function syncPopulation(s: GameState) {
  const p = s.park;
  for (const spec of SPECIES_LIST) {
    const want = s.progress.population[spec.id] ?? 0;
    const have = p.animals.filter((a) => a.sp === spec.id && a.task !== "dead");
    let anchor = have[0] ? { x: have[0].x, y: have[0].y } : undefined;
    for (let n = have.length; n < want; n++) {
      const a = spawn(s, spec.id, spec.behavior.herd[1] > 1 ? anchor : undefined);
      if (a && !anchor) anchor = { x: a.x, y: a.y };
    }
  }
}

function start(s: GameState) {
  const p = s.park;
  const w = worldFor(s);
  p.started = true;
  p.trample = new Uint16Array(w.cols * w.rows);
  const rng = mulberry32(99);
  for (let i = 0; i < 28; i++) {
    const a = rng() * TAU, r = 0.8 + rng() * 0.5;
    const hx = Math.min(WORLD_W - 20, Math.max(20, w.pond.x + Math.cos(a) * w.pond.rx * r));
    const hy = Math.min(WORLD_H - 20, Math.max(20, w.pond.y + Math.sin(a) * w.pond.ry * r));
    p.critters.push({ hx, hy, x: hx, y: hy, seed: rng() * 100 });
  }
  p.cam.x = w.pond.x - w.pond.rx - 500;
  p.cam.y = w.pond.y - 300;
}

/** Cerveau de remplacement facultatif (tests) : sinon, l'écosystème complet (ecosystem.ts). */
export type Brain = (s: GameState, a: Animal, dt: number) => void;
export let parkBrain: Brain | null = null;
export function setParkBrain(fn: Brain | null) {
  parkBrain = fn;
}

/** Cliquer un animal : on l'observe, et ce qu'il fait débloque des faits. */
export function observe(s: GameState, a: Animal) {
  s.park.selected = a.id;
  s.park.bug = undefined;
  unlockTrigger(s, a.sp, "discover");
  const byAction: Partial<Record<Action, FactUnlock>> = { eat: "eat", drink: "drink", rest: "rest", attack: "attack", defend: "defend", call: "call" };
  const t = byAction[a.action];
  if (t) unlockTrigger(s, a.sp, t);
  if (["herd", "hunt", "flee", "scavenge"].includes(a.mood)) unlockTrigger(s, a.sp, a.mood as FactUnlock);
  // Cycle de vie : un parent qui couve, un petit qui grandit.
  if (a.task !== "dead" && a.nestId) unlockTrigger(s, a.sp, "nest");
  if (a.task !== "dead" && a.growth < 1) unlockTrigger(s, a.sp, "baby");
}

/** Cliquer un nid : sa fiche, et le fait « nid » du carnet. */
export function observeNest(s: GameState, n: Nest) {
  s.park.nestSel = n.id;
  s.park.selected = undefined;
  s.park.bug = undefined;
  unlockTrigger(s, n.sp, "nest");
}

/** Nid sous un point écran (px CSS). */
function nestAt(s: GameState, px: number, py: number): Nest | undefined {
  const camX = Math.floor(s.park.cam.x / CELL_W), camY = Math.floor(s.park.cam.y / CELL_H);
  const c = worldCellAt(px, py);
  const wx = c.x + camX, wy = c.y + camY;
  let best: Nest | undefined;
  for (const n of s.park.nests) {
    const r = nestRaster(n);
    const i = wx - r.cx, j = wy - r.cy;
    // Les nids sont plats : on vise large.
    if (i < -2 || j < -2 || i > r.w + 1 || j > r.h + 1) continue;
    if (!best || n.y > best.y) best = n;
  }
  return best;
}

/** Animal sous un point écran (px CSS), le plus proche du spectateur. */
function animalAt(s: GameState, px: number, py: number): Animal | undefined {
  const camX = Math.floor(s.park.cam.x / CELL_W), camY = Math.floor(s.park.cam.y / CELL_H);
  const c = worldCellAt(px, py);
  const wx = c.x + camX, wy = c.y + camY;
  let best: Animal | undefined;
  for (const a of s.park.animals) {
    const r = animalRaster(a, s.time);
    const i = wx - r.cx, j = wy - r.cy;
    if (i < -2 || j < -1 || i > r.w + 1 || j > r.h) continue;
    // Un peu de tolérance autour de la silhouette pour viser facilement.
    let hit = false;
    for (let oy = -1; oy <= 1 && !hit; oy++) for (let ox = -2; ox <= 2 && !hit; ox++) {
      const ii = i + ox, jj = j + oy;
      if (ii >= 0 && jj >= 0 && ii < r.w && jj < r.h && r.mat[jj * r.w + ii]) hit = true;
    }
    if (hit && (!best || a.y > best.y)) best = a;
  }
  return best;
}

/** Passe à l'animal suivant/précédent (molette) et le suit. */
function cycle(s: GameState, dir: number) {
  const list = s.park.animals.filter((a) => a.task !== "dead");
  if (!list.length) return;
  list.sort((a, b) => a.id - b.id);
  const k = list.findIndex((a) => a.id === s.park.selected);
  const next = list[(k + dir + list.length) % list.length] ?? list[0];
  s.park.selected = next.id;
  s.park.bug = undefined;
  s.park.nestSel = undefined;
  s.park.follow = true;
}

export const MINI_W = 28, MINI_H = 10;
/** Lettre de chaque espèce sur la mini-carte. */
const MINI_GLYPH: Partial<Record<SpeciesId, string>> = { ankylo: "A", raptor: "R", trike: "T", edmonto: "E", pachy: "P", trex: "X" };

export function centerOn(s: GameState, x: number, y: number) {
  s.park.cam.x = x - viewW(s) / 2;
  s.park.cam.y = y - viewH(s) / 2;
  s.park.follow = false;
}

export const parkScene: Scene = {
  enter(s) {
    if (!s.park.started) start(s);
    syncPopulation(s);
  },

  update(s, input: Input, dt) {
    const p = s.park;
    if (!p.started) { start(s); syncPopulation(s); }
    const w = worldFor(s);
    // Fonctions de la réserve : météo, documentaire (peut piloter la caméra), appareil photo.
    updateWeather(s, dt * s.clockSpeed);
    const docuCam = updateDocumentary(s, input, dt);
    const photoCaptures = updatePhoto(s, input, dt);
    void docuCam; void photoCaptures;
    // Zoom : touches à droite du 0, pavé numérique, pincement / Ctrl + molette (centré sur la souris).
    const zl = p.zoom ?? ZOOM_DEFAULT;
    if (input.pressed.includes("Equal") || input.pressed.includes("NumpadAdd")) setZoom(s, zl - 1);
    if (input.pressed.includes("Minus") || input.pressed.includes("NumpadSubtract")) setZoom(s, zl + 1);
    p.zoomAcc = (p.zoomAcc ?? 0) + (input.mouse.zoom ?? 0);
    if (Math.abs(p.zoomAcc) >= 60) {
      const L = zoomLevel(s), k = L.m / L.z;
      setZoom(s, (p.zoom ?? ZOOM_DEFAULT) + Math.sign(p.zoomAcc), p.cam.x + input.mouse.x * k, p.cam.y + input.mouse.y * k);
      p.zoomAcc = 0;
    }
    // Caméra : clavier + glisser (plus vite quand on voit plus large).
    const zk = zoomLevel(s).m / zoomLevel(s).z;
    const speed = 700 * dt * zk;
    if (input.dx || input.dy) p.follow = false;
    p.cam.x += input.dx * speed;
    p.cam.y += input.dy * speed;
    if (input.mouse.down && (input.mouse.dragX || input.mouse.dragY)) {
      p.follow = false;
      p.cam.x -= input.mouse.dragX * zk;
      p.cam.y -= input.mouse.dragY * zk;
    }
    // Molette : défile le recensement s'il est sous la souris, sinon animal suivant / précédent.
    if (p.roster && input.mouse.wheel && rosterOver(input.mouse.x, input.mouse.y)) {
      p.rosterScroll = Math.max(0, (p.rosterScroll ?? 0) + Math.sign(input.mouse.wheel) * ROSTER_STEP);
      p.wheel = 0;
    } else {
      p.wheel += input.mouse.wheel;
      if (Math.abs(p.wheel) >= 80) { cycle(s, p.wheel > 0 ? 1 : -1); p.wheel = 0; }
    }

    // Le temps de la réserve suit la vitesse de l'horloge (x1, x4, x16) : déplacements, faim,
    // incubation, gestation, croissance, vieillissement, repousse des arbres... tout accélère.
    // Par petits pas (au plus 4 par image) pour que les déplacements restent fluides.
    const clock = s.clockSpeed;
    const steps = Math.min(4, Math.max(1, Math.round(clock)));
    const sdt = (dt * clock) / steps;
    for (let k = 0; k < steps; k++) {
      stepEcosystem(s, sdt);
      updateTrees(w, sdt, p.regrow ?? 1);
    }

    const sel = p.animals.find((a) => a.id === p.selected);
    if (!sel) p.selected = undefined;
    if (p.confirmRetire !== undefined && p.confirmRetire !== p.selected) p.confirmRetire = undefined;
    const nest = p.nestSel !== undefined ? p.nests.find((n) => n.id === p.nestSel) : undefined;
    if (!nest) p.nestSel = undefined;
    const bug = p.bug !== undefined ? p.eco?.fauna.find((b) => b.uid === p.bug) : undefined;
    // Pour un animal en vol, on centre sur son corps (au-dessus de son ombre), pas sur le sol.
    const box = sel ? animalRaster(sel, s.time) : null;
    const tgt = sel && box ? { x: (box.cx + box.w / 2) * CELL_W, y: (box.cy + box.h / 2) * CELL_H } : bug ? { x: bug.x, y: bug.y } : nest ? { x: nest.x, y: nest.y } : undefined;
    // Documentaire : il tient la caméra (il s'arrête de lui-même dès que le joueur la reprend).
    if (p.follow && tgt && !docuCam) {
      p.cam.x += (tgt.x - viewW(s) / 2 - p.cam.x) * Math.min(1, dt * 4);
      p.cam.y += (tgt.y - viewH(s) / 2 - p.cam.y) * Math.min(1, dt * 4);
    }
    // Bords de la carte (en vue « toute la carte », elle est centrée si elle tient dans l'écran).
    const vw = viewW(s), vh = viewH(s);
    p.cam.x = vw >= w.cols * CELL_W ? (w.cols * CELL_W - vw) / 2 : Math.max(0, Math.min(w.cols * CELL_W - vw, p.cam.x));
    p.cam.y = vh >= w.rows * CELL_H ? (w.rows * CELL_H - vh) / 2 : Math.max(0, Math.min(w.rows * CELL_H - vh, p.cam.y));

    // Herbe couchée sous les pas : on note l'instant du passage (rien à faire décroître sur toute la carte).
    if (p.trample) {
      const tr = p.trample, now = trampleNow(s);
      for (const a of p.animals) {
        if (a.moving < 0.3) continue;
        const spec = SPECIES[a.sp];
        if (!spec) continue;
        for (const fx of spec.feet) {
          const i = Math.floor(a.y / CELL_H) * w.cols + Math.floor((a.x + fx * a.facing) / CELL_W);
          if (i > 0 && i < tr.length - 1) { tr[i] = now; tr[i + 1] = now; tr[i - 1] = now; }
        }
      }
    }
    for (const c of p.critters) {
      const t = s.time * 0.25 + c.seed;
      c.x = c.hx + Math.sin(t * 1.3) * 40 + Math.sin(t * 0.7 + 2) * 25;
      c.y = c.hy + Math.cos(t * 1.1) * 18 + Math.sin(t * 2.3) * 6;
    }

    const overUi = rosterOver(input.mouse.x, input.mouse.y) && p.roster;
    // Vue carte : un clic y plonge (zoom normal, centré sur le point cliqué) ; rien à survoler.
    if (zoomLevel(s).m > 1) {
      p.hover = p.bugHover = p.nestHover = undefined;
      const c = input.worldClicks[0];
      if (c) { const k = zoomLevel(s).m; p.zoom = ZOOM_DEFAULT; centerOn(s, p.cam.x + c.x * k, p.cam.y + c.y * k); }
      input.worldClicks.length = 0;
    } else if (input.mouse.inside && !overUi) {
      p.hover = animalAt(s, input.mouse.x, input.mouse.y)?.id;
      p.bugHover = p.hover === undefined ? faunaAt(s, input.mouse.x, input.mouse.y)?.uid : undefined;
      p.nestHover = p.hover === undefined && p.bugHover === undefined ? nestAt(s, input.mouse.x, input.mouse.y)?.id : undefined;
    } else p.hover = p.bugHover = p.nestHover = undefined;
    for (const c of input.worldClicks) {
      const a = animalAt(s, c.x, c.y);
      if (a) { observe(s, a); p.nestSel = undefined; continue; }
      const b = faunaAt(s, c.x, c.y);
      if (b) { p.bug = b.uid; p.selected = undefined; p.nestSel = undefined; noteFauna(s, b); continue; }
      const n = nestAt(s, c.x, c.y);
      if (n) { observeNest(s, n); continue; }
      p.selected = undefined;
      p.bug = undefined;
      p.nestSel = undefined;
    }
    if (DEV && input.pressed.includes("KeyN")) p.debugNav = !p.debugNav;
    if (input.pressed.includes("KeyC")) p.roster = !p.roster;
    if (input.pressed.includes("KeyM")) p.hideMap = !p.hideMap;
    if (input.pressed.includes("KeyT")) nextSpeed(s);
    for (const id of input.ui) {
      if (id === "park:follow") p.follow = !p.follow;
      if (id === "park:clock" || id === "park:speed") nextSpeed(s);
      if (id === "park:map") p.hideMap = !p.hideMap;
      if (id === "park:zoomin") setZoom(s, (p.zoom ?? ZOOM_DEFAULT) - 1);
      if (id === "park:zoomout") setZoom(s, (p.zoom ?? ZOOM_DEFAULT) + 1);
      if (id === "park:gotodig") s.mode = "dig";
      if (id === "park:close") { p.selected = undefined; p.bug = undefined; p.nestSel = undefined; p.follow = false; p.confirmRetire = undefined; }
      if (weatherClick(s, id)) continue;
      if (id === "park:roster") p.roster = !p.roster;
      if (id === "park:couple") {
        // Test : un couple prêt à nicher, au centre de l'écran, de l'espèce sélectionnée si possible.
        const cx = p.cam.x + viewW(s) / 2, cy = p.cam.y + viewH(s) / 2;
        const cur = p.animals.find((a) => a.id === p.selected);
        const m = addTestCouple(s, cx, cy, cur?.sp);
        if (m) {
          const name = SPECIES[m.sp]?.name ?? m.sp;
          toast(s, "Couple ajoute (test)", `Deux ${name}s prets a nicher : regarde-les construire un nid !`);
          p.selected = m.id; p.follow = true; p.nestSel = undefined;
        } else toast(s, "Pas de place", "Toutes les especes assemblees sont deja au complet dans la reserve.");
      }
      if (id.startsWith("park:pick:")) {
        // Ligne du recensement : on sélectionne l'animal et la caméra le rejoint.
        const a = p.animals.find((b) => b.id === Number(id.slice(10)));
        if (a) { observe(s, a); p.nestSel = undefined; centerOn(s, a.x, a.y - a.alt); p.follow = true; }
      }
      if (id.startsWith("park:nest:")) {
        const n = p.nests.find((m) => m.id === Number(id.slice(10)));
        if (n) { observeNest(s, n); centerOn(s, n.x, n.y); }
      }
      if (id === "park:retire" && sel && sel.task !== "dead") p.confirmRetire = sel.id;
      if (id === "park:retire:no") p.confirmRetire = undefined;
      if (id === "park:retire:yes" && sel && p.confirmRetire === sel.id) {
        const name = SPECIES[sel.sp]?.name ?? "dinosaure";
        retireAnimal(s, sel);
        toast(s, `${theName(name)} a quitté la réserve.`);
        p.selected = undefined; p.confirmRetire = undefined; p.follow = false;
      }
      if (id === "park:journal" && sel) { s.journal.species = sel.sp; s.journal.extras = false; s.mode = "journal"; }
      if (id === "park:extras") { s.journal.species = undefined; s.journal.extras = true; s.mode = "journal"; }
      if (id === "park:mini") {
        // Case de la carte sous le clic.
        const c = input.mouse.clicks.find((k) => hitAt(k.x, k.y) === "park:mini");
        if (c) {
          const m = uiCellAt(c.x, c.y);
          centerOn(s, ((m.x - miniRect.x + 0.5) / (MINI_W - 2)) * WORLD_W, ((m.y - miniRect.y + 0.5) / (MINI_H - 2)) * WORLD_H);
        }
      }
    }
  },

  compose(s, th, world, ui) {
    const p = s.park;
    const w = worldFor(s);
    const camX = Math.floor(p.cam.x / CELL_W), camY = Math.floor(p.cam.y / CELL_H);
    const zv = zoomLevel(s);
    if (zv.m > 1) {
      // Vue carte : les animaux en lettres (rouge : carnivores, bleu : nageurs), les nids en « o ».
      const u = th.ui, marks: MapMark[] = [];
      for (const n of p.nests) marks.push({ x: n.x, y: n.y, glyph: 111, color: u.dim });
      for (const a of p.animals) {
        const spec = SPECIES[a.sp];
        if (!spec || a.task === "dead") continue;
        const color = a.id === p.selected ? u.hi : spec.habitat === "sea" ? th.pal.waterShore : spec.behavior.diet === "carnivore" ? u.bad : u.ok;
        marks.push({ x: a.x, y: a.y - a.alt, glyph: (MINI_GLYPH[a.sp] ?? spec.name[0].toUpperCase()).charCodeAt(0), color });
      }
      composeMap(th, world, { world: w, time: s.time, camX, camY, k: zv.m, light: daylight(s.clock), veg: p.eco?.veg, plankton: p.eco?.plankton, marks });
      drawHud(s, th, world, ui);
      return;
    }
    const actors: Actor[] = [];
    const margin = 400;
    const vx0 = p.cam.x - margin, vx1 = p.cam.x + world.cols * CELL_W + margin;
    const vy0 = p.cam.y - margin, vy1 = p.cam.y + world.rows * CELL_H + margin;
    for (const a of p.animals) {
      if (a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      const spec = SPECIES[a.sp];
      if (!spec) continue;
      const sea = spec.habitat === "sea";
      actors.push({
        id: a.id, r: animalRaster(a, s.time), x: a.x, y: a.y, inWater: a.inWater && !sea && a.alt < 2, submerged: sea && a.task !== "dead" && a.action !== "land" && a.action !== "takeoff", // tortue sur la plage : dessinée hors de l'eau
        sortY: a.alt > 4 ? 1e7 + a.alt : undefined,
        // Ombre au sol pour les volants (plus petite quand ils sont haut), aucune pour les nageurs.
        shadowRx: sea ? 0 : spec.halfLen * spec.shadow * (a.task === "dead" ? 1.1 : 1) * (a.alt > 0 ? Math.max(0.35, 1 - a.alt / 400) : 1),
        eyeX: a.x + spec.eye.x * a.facing, eyeY: a.y - a.alt + spec.eye.y,
      });
    }
    // Nids : posés au sol, triés avec le reste (le parent qui couve passe devant ou derrière).
    for (const n of p.nests) {
      if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
      actors.push({ id: nestActorId(n.id), r: nestRaster(n), x: n.x, y: n.y - 1, inWater: false, shadowRx: 0, eyeX: n.x, eyeY: -1e6 });
    }
    faunaActors(s, actors, vx0, vy0, vx1, vy1);
    // Arbres renversés, souches et jeunes pousses : dessinés comme des objets animés.
    for (const t of activeTrees()) {
      if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1 || !w.trees.includes(t)) continue;
      const r = treeRaster(t);
      if (r) actors.push({ id: -100000 - t.id, r: placed(r, Math.floor(t.x / CELL_W), Math.floor(t.y / CELL_H)), x: t.x, y: t.y, inWater: false, shadowRx: t.state === "down" ? 60 : 18, eyeX: t.x, eyeY: -1e6 });
    }
    // La réserve suit le cycle jour / nuit ; l'interface garde ses couleurs.
    composeWorld(weatherTheme(s, litTheme(th, s.clock)), world, {
      world: w, time: s.time, camX, camY,
      glowX: p.cam.x + world.cols * CELL_W / 2, glowY: p.cam.y + world.rows * CELL_H / 2,
      actors, critters: p.critters, trample: p.trample ?? undefined, trampleNow: trampleNow(s), veg: p.eco?.veg, plankton: p.eco?.plankton, selected: p.selected ?? (p.bug !== undefined ? 1_000_000 + p.bug : p.nestSel !== undefined ? nestActorId(p.nestSel) : undefined),
    });

    drawWeather(s, th, world, camX, camY);
    if (DEV && p.debugNav) drawNavDebug(s, th, world, camX, camY);
    const u = th.ui;
    const toUi = (cx: number, cy: number) => ({ x: ((cx - camX) * metrics.cellW) / metrics.uiW, y: ((cy - camY) * metrics.cellH) / metrics.uiH });
    // Étiquette accrochée au monde : seulement si elle tient entière dans la zone de jeu.
    const tag = (x: number, y: number, str: string, fg: RGB, bg: RGB, a: number) => {
      const t = str.length;
      if (x < 0 || x + t > ui.cols || y < UI_TOP || y >= ui.rows - 1) return;
      text(ui, x, y, str, fg, bg, a);
    };
    if (!s.photo.aiming && !s.docu.on) {
      // Étiquettes au-dessus de l'animal survolé ou sélectionné : nom + ce qu'il fait.
      for (const id of new Set([p.hover, p.selected])) {
        const a = p.animals.find((b) => b.id === id);
        if (!a) continue;
        const spec = SPECIES[a.sp];
        if (!spec) continue;
        const r = animalRaster(a, s.time);
        const at = toUi(r.cx + r.w / 2, r.cy);
        const isSel = id === p.selected;
        const label = ` ${isSel ? "> " : ""}${displayName(spec, a)} `;
        const lx = Math.round(at.x - label.length / 2), ly = Math.round(at.y - 1.2);
        tag(lx, ly, label, isSel ? u.panel : u.text, isSel ? u.hi : u.panel, 0.9);
        const sub = ` ${activity(a)} `;
        if (id === p.hover) tag(Math.round(at.x - sub.length / 2), ly + 1, sub, u.dim, u.panel, 0.8);
      }
      for (const uid of new Set([p.bugHover, p.bug])) {
        const b = p.eco?.fauna.find((f) => f.uid === uid);
        const def = b && faunaDef(b);
        if (!b || !def) continue;
        const at = toUi(b.x / CELL_W, (b.y - b.alt) / CELL_H - 4);
        const label = ` ${def.name} `;
        tag(Math.round(at.x - label.length / 2), Math.round(at.y - 1), label, uid === p.bug ? u.panel : u.text, uid === p.bug ? u.hi : u.panel, 0.9);
      }

      // Barre d'incubation au-dessus de chaque nid visible (et de chaque gestation, voir `progressBars`).
      for (const pb of progressBars(s)) {
        const at = toUi(pb.cx, pb.cy);
        const x = Math.round(at.x - 6), y = Math.round(at.y) - (pb.selected ? 2 : 1);
        if (x < 0 || y < UI_TOP || x + 12 > ui.cols || y >= ui.rows - 1) continue;
        bar(ui, th, x, y, 12, pb.v, pb.v > 0.85 ? u.ok : u.hi);
      }

      for (const id of new Set([p.nestHover, p.nestSel])) {
        const n = p.nests.find((m) => m.id === id);
        if (!n) continue;
        const r = nestRaster(n);
        const at = toUi(r.cx + r.w / 2, r.cy);
        const label = ` Nid ${deName(SPECIES[n.sp]?.name ?? "dinosaure")} `;
        const isSel = id === p.nestSel;
        tag(Math.round(at.x - label.length / 2), Math.round(at.y - 1.2), label, isSel ? u.panel : u.text, isSel ? u.hi : u.panel, 0.9);
      }
    }
    drawHud(s, th, world, ui);
  },

  hints(s) {
    if (s.photo.aiming) return [["Clic", "declencher"], ["Molette", "cadrage"], ["Glisser", "deplacer"], ["P", "ranger l'appareil"]];
    if (s.docu.on) return [["V", "arreter"], ["Fleches", "reprendre la camera"]];
    const h: Hint[] = zoomLevel(s).m > 1
      ? [["Fleches", "camera"], ["Glisser", "camera"], ["Clic", "y plonger"], ["= )", "zoom"]]
      : [["Fleches", "camera"], ["Glisser", "camera"], ["Clic", "observer"], ["Molette", "animal suivant"], ["= )", "zoom"]];
    if (s.park.selected !== undefined || s.park.nestSel !== undefined || s.park.bug !== undefined) h.push(["Echap", "fermer la fiche"]);
    return h;
  },

  help() {
    const h: Hint[] = [
      ["Fleches", "deplacer la camera (ou ZQSD / WASD, ou glisser)"],
      ["Clic", "observer un animal, un nid, une petite bete : remplit le carnet"],
      ["Molette", "animal suivant / precedent (ou defiler le recensement)"],
      ["= )", "zoomer / dezoomer (touches a droite du 0, + et - du pave numerique, pincement) ; la vue carte montre toute la reserve"],
      ["V", "documentaire : la camera filme les moments forts"],
      ["P", "appareil photo (clic ou Espace : declencher, molette : cadrage)"],
      ["C", "recensement : la liste de tous les animaux"],
      ["M", "afficher / masquer la carte (clic sur la carte : y aller)"],
      ["T", "accelerer le temps (x1, x4, x16)"],
      ["Echap", "fermer la fiche, le viseur, le documentaire..."],
    ];
    if (DEV) h.push(["N", "(dev) debug de la navigation"]);
    return h;
  },

  back(s) {
    const p = s.park;
    if (s.photo.aiming) { s.photo.aiming = false; return true; }
    if (s.docu.listOpen) { s.docu.listOpen = false; return true; }
    if (s.docu.on) { stopDocumentary(s); return true; }
    if (p.confirmRetire !== undefined) { p.confirmRetire = undefined; return true; }
    if (p.selected !== undefined || p.bug !== undefined || p.nestSel !== undefined) {
      p.selected = undefined; p.bug = undefined; p.nestSel = undefined; p.follow = false;
      return true;
    }
    if (p.roster) { p.roster = false; return true; }
    return false;
  },
};

/** Vitesse du temps suivante (x1, x4, x16). */
function nextSpeed(s: GameState) {
  s.clockSpeed = CLOCK_SPEEDS[(CLOCK_SPEEDS.indexOf(s.clockSpeed as 1) + 1) % CLOCK_SPEEDS.length];
}

/**
 * Interface de la réserve (règles de placement, sans chevauchement) :
 * - en haut à gauche, « Temps et météo » (complet, compact, ou masqué si la fiche a besoin de la place) ;
 * - à sa droite, la barre d'outils (Documentaire V, Moments, Photo P, Recensement C, Carte M, Temps T) ;
 * - en bas à gauche, la fiche de l'élément sélectionné ; en bas à droite, la carte ;
 * - à droite, entre la barre d'outils et la carte, le recensement ; notifications en haut à droite (au-dessus).
 * Pendant le documentaire ou la visée photo, tout s'efface sauf leurs propres commandes.
 */
function drawHud(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const p = s.park, d = s.docu;
  if (s.photo.aiming) { drawPhoto(s, th, world, ui); return; }
  if (d.on) { drawDocumentary(s, th, ui); drawPhoto(s, th, world, ui); drawThunder(s, th, ui); return; }

  // --- Fiche (bas gauche) ---
  const sel = p.animals.find((a) => a.id === p.selected);
  const nest = p.nests.find((n) => n.id === p.nestSel);
  const bug = p.bug !== undefined ? p.eco?.fauna.find((f) => f.uid === p.bug) : undefined;
  let cardTop = ui.rows - 1;
  if (sel) cardTop = drawAnimalCard(s, th, ui, sel);
  else if (bug) cardTop = drawBugCard(s, th, ui, bug);
  else if (nest) cardTop = drawNestCard(s, th, ui, nest);

  // --- Temps et météo (haut gauche) : complet, compact ou masqué selon la place laissée par la fiche ---
  const room = cardTop - 1 - UI_TOP;
  const full = 6 + (DEV ? 3 : 2) + 1;
  const timeH = room >= full ? full : room >= 4 ? 4 : 0;
  if (timeH) drawTime(s, th, ui, SP.margin, UI_TOP, TIME_W, timeH);

  // --- Barre d'outils ---
  const missed = missedCount(s);
  const tools: ToolItem[] = [
    { id: "docu:toggle", label: "Documentaire", short: "Docu", icon: "o", key: "V", tip: "Documentaire : la camera filme les moments forts" },
  ];
  if (d.log.length) tools.push({ id: "docu:list", label: missed ? `${missed} moment${missed > 1 ? "s" : ""} manque${missed > 1 ? "s" : ""}` : "Moments passes", short: missed ? `${missed} manque${missed > 1 ? "s" : ""}` : "Moments", icon: `!${missed}`, toggle: true, active: d.listOpen, tip: "Moments forts manques : clic pour y aller" });
  tools.push(
    { id: "photo:toggle", label: "Appareil photo", short: "Photo", icon: "@", key: "P", tip: "Appareil photo : cadrer, puis declencher" },
    { id: "park:roster", label: "Recensement", short: "Liste", icon: "#", key: "C", toggle: true, active: !!p.roster, tip: "Recensement : tous les animaux de la reserve" },
    { id: "park:map", label: "Carte", icon: "%", key: "M", toggle: true, active: !p.hideMap, tip: "Afficher / masquer la carte" },
    { id: "park:zoomout", label: "Zoom -", short: "-", icon: "-", tip: "Dezoomer (touche a droite du 0, pincement) : jusqu'a toute la carte" },
    { id: "park:zoomin", label: "Zoom +", short: "+", icon: "+", tip: "Zoomer (touche =, pincement)" },
    { id: "park:speed", label: `Temps x${s.clockSpeed}`, short: `x${s.clockSpeed}`, icon: `x${s.clockSpeed}`, key: "T", active: s.clockSpeed > 1, tip: "Accelerer le temps (x1, x4, x16)" },
  );
  if (DEV) tools.push({ id: "park:couple", label: "Couple (test)", short: "Couple", icon: "+", variant: "ghost", tip: "Test : ajouter un couple pret a nicher" });
  const tx = timeH ? SP.margin + TIME_W + SP.gap + 1 : SP.margin;
  toolbar(ui, th, tx, UI_TOP, ui.cols - tx - SP.margin, tools);

  // --- Carte (bas droite) et recensement (droite) ---
  const mapShown = !p.hideMap && ui.cols >= 90 && ui.rows >= 30;
  const mapTop = ui.rows - MINI_H - 2;
  if (mapShown) drawMini(s, th, ui, ui.cols - MINI_W - SP.margin, mapTop);
  if (p.roster) drawRoster(s, th, ui, UI_TOP + 2, mapShown ? mapTop - 1 : ui.rows - 2, timeH ? SP.margin + TIME_W + SP.gap : 0);

  if (!p.animals.some((a) => a.task !== "dead")) {
    emptyState(ui, th, "Reserve vide", "Aucun dinosaure ici pour l'instant. Fouille des os, assemble un squelette a l'atelier, puis synthetise-le : il viendra vivre ici.",
      { id: "park:gotodig", label: "Aller a la fouille", key: "2" });
  }
  // Menu déroulant des moments manqués : par-dessus le reste.
  if (d.listOpen) drawDocuLog(s, th, ui, tx, UI_TOP + 1);
  drawPhoto(s, th, world, ui);
  drawThunder(s, th, ui);
}

/** Fiche d'une petite bête (note bonus du carnet). Renvoie sa ligne du haut. */
function drawBugCard(s: GameState, th: Theme, ui: Frame, b: Bug): number {
  const def = faunaDef(b);
  if (!def) return ui.rows - 1;
  const u = th.ui;
  const W = Math.min(46, ui.cols - 2 * SP.margin - 2);
  const body = wrap(def.text, W - 4).slice(0, 6);
  const H = 7 + body.length, x = SP.margin + 1, y = Math.max(UI_TOP, ui.rows - H - 2);
  panel(ui, th, x, y, W, H, def.name, { close: "park:close" });
  text(ui, x + 2, y + 1, def.latin, u.dim, u.panel, u.alpha);
  body.forEach((l, i) => text(ui, x + 2, y + 3 + i, l, u.text, u.panel, u.alpha));
  text(ui, x + 2, y + H - 3, "Note ajoutée au carnet (Extras).", u.ok, u.panel, u.alpha);
  actions(ui, th, x + 2, y + H - 2, W - 4, [
    { id: "park:extras", label: "Voir au carnet" },
    { id: "park:follow", label: "Suivre", toggle: true, active: s.park.follow, variant: "primary" },
  ]);
  return y;
}

/** Mini-carte : eau, nids (o), animaux (initiale de l'espèce, minuscule pour les petits), carcasses, cadre de la caméra. Cliquer y déplace la caméra. */
function drawMini(s: GameState, th: Theme, ui: Frame, x0: number, y0: number) {
  const p = s.park, w = worldFor(s), u = th.ui;
  const iw = MINI_W - 2, ih = MINI_H - 2;
  panel(ui, th, x0, y0, MINI_W, MINI_H, "Carte", { key: "M", close: "park:map" });
  const cw = WORLD_W / iw, ch = WORLD_H / ih;
  const vx0 = p.cam.x / cw, vy0 = p.cam.y / ch;
  const vx1 = (p.cam.x + metrics.cols * CELL_W) / cw, vy1 = (p.cam.y + metrics.rows * CELL_H) / ch;
  const water: RGB = th.pal.waterShore;
  for (let j = 0; j < ih; j++) {
    for (let i = 0; i < iw; i++) {
      const wi = Math.floor(((j + 0.5) * ch) / CELL_H) * w.cols + Math.floor(((i + 0.5) * cw) / CELL_W);
      const inView = i + 1 > vx0 && i < vx1 && j + 1 > vy0 && j < vy1;
      const bg = inView ? u.panelAlt : u.panel;
      const wet = isWater(w.terrain[wi]);
      put(ui, x0 + 1 + i, y0 + 1 + j, wet ? 126 : 46, wet ? water : u.dim, bg, u.alpha);
    }
  }
  // Une seule zone : la case visée se calcule au clic (voir update, « park:mini »).
  region("park:mini", x0 + 1, y0 + 1, iw, ih, { tip: "Clic : y emmener la camera. Lettres : animaux (rouge : carnivores), o : nids" });
  miniRect = { x: x0 + 1, y: y0 + 1 };
  // Nids (o), puis les animaux par-dessus ; les petits en minuscule.
  for (const n of p.nests) {
    const i = Math.floor(n.x / cw), j = Math.floor(n.y / ch);
    if (i < 0 || j < 0 || i >= iw || j >= ih) continue;
    text(ui, x0 + 1 + i, y0 + 1 + j, "o", n.id === p.nestSel ? u.hi : u.ok, null);
  }
  for (const a of p.animals) {
    const i = Math.floor(a.x / cw), j = Math.floor(a.y / ch);
    if (i < 0 || j < 0 || i >= iw || j >= ih) continue;
    const dead = a.task === "dead";
    const glyph = MINI_GLYPH[a.sp] ?? SPECIES[a.sp]?.name[0] ?? "?";
    const g = a.id === p.selected ? "@" : dead ? "%" : a.growth < 1 ? glyph.toLowerCase() : glyph;
    const col = a.id === p.selected ? u.hi : dead ? u.dim : SPECIES[a.sp]?.behavior.diet === "carnivore" ? u.bad : u.text;
    text(ui, x0 + 1 + i, y0 + 1 + j, g, col, null);
  }
}

/** Coin haut gauche de la mini-carte à la dernière image (cellules d'interface), pour convertir un clic. */
let miniRect = { x: 0, y: 0 };

/** Largeur du panneau « Temps et météo ». */
const TIME_W = 34;

/**
 * Temps et météo (haut gauche) : heure, moment de la journée, vitesse ; frise des 24 h avec le soleil
 * ou la lune ; puis la météo (saison, frise de l'année, ciel, température). Compact (h = 4) : deux lignes.
 * Cliquer l'horloge accélère le temps (comme T).
 */
function drawTime(s: GameState, th: Theme, ui: Frame, x: number, y: number, W: number, H: number) {
  const u = th.ui;
  const hour = s.clock;
  const day = daylight(hour) > 0.5;
  panel(ui, th, x, y, W, H, "Temps et meteo");
  region("park:clock", x, y, W, 4, { tip: "Clic : accelerer le temps (T)" });
  const iw = W - 4, ix = x + 2;
  // Astre (forme + couleur) + heure + moment + vitesse.
  const sun: RGB = [200, 130, 0], moon: RGB = [60, 90, 170];
  text(ui, ix, y + 1, day ? "(O)" : "(C", day ? sun : moon, u.panel, u.alpha);
  text(ui, ix + 4, y + 1, clockLabel(hour), u.text, u.panel, u.alpha);
  const sp = `x${s.clockSpeed}`;
  text(ui, ix + 10, y + 1, periodName(hour).slice(0, iw - 11 - sp.length), u.hi, u.panel, u.alpha);
  text(ui, ix + iw - sp.length, y + 1, sp, s.clockSpeed > 1 ? u.hi : u.dim, u.panel, u.alpha);
  if (H <= 4) {
    drawWeatherRows(s, th, ui, ix, y + 2, iw, true);
    return;
  }
  // Frise des 24 heures : jour en =, aube et crépuscule en -, nuit en points, l'astre à l'heure courante.
  const track = iw - 2, tx = ix + 1, ty = y + 2;
  text(ui, tx - 1, ty, "[", u.border, u.panel, u.alpha);
  text(ui, tx + track, ty, "]", u.border, u.panel, u.alpha);
  for (let i = 0; i < track; i++) {
    const h = (i / track) * 24;
    const lit = daylight(h);
    put(ui, tx + i, ty, lit > 0.5 ? 61 : lit > 0 ? 45 : 46, lit > 0.5 ? u.hi : u.dim, u.panel, u.alpha);
  }
  const cur = Math.min(track - 1, Math.floor((hour / 24) * track));
  put(ui, tx + cur, ty, day ? 79 : 67, day ? sun : moon, u.panel, u.alpha); // O ou C
  text(ui, tx, ty + 1, "0h", u.dim, u.panel, u.alpha);
  text(ui, tx + Math.floor(track / 2) - 1, ty + 1, "12h", u.dim, u.panel, u.alpha);
  text(ui, tx + track - 3, ty + 1, "24h", u.dim, u.panel, u.alpha);
  drawWeatherRows(s, th, ui, ix, y + 5, iw);
}

/**
 * Debug navigation (dev, touche N) : cases infranchissables pour l'animal sélectionné (x),
 * chemins en cours (points d'accent) et animaux qui piétinent (!).
 */
function drawNavDebug(s: GameState, th: Theme, world: Frame, camX: number, camY: number) {
  const P = th.pal, w = worldFor(s);
  const mark = (px: number, py: number, ch: number, c: RGB) => {
    const x = Math.floor(px / CELL_W) - camX, y = Math.floor(py / CELL_H) - camY;
    if (x < 0 || y < 0 || x >= world.cols || y >= world.rows) return;
    const i = y * world.cols + x;
    world.ch[i] = ch;
    world.fg[i * 4] = c[0]; world.fg[i * 4 + 1] = c[1]; world.fg[i * 4 + 2] = c[2];
  };
  const sel = s.park.animals.find((a) => a.id === s.park.selected);
  if (sel) {
    const i0 = Math.floor((camX * CELL_W) / NAV), j0 = Math.floor((camY * CELL_H) / NAV);
    const i1 = i0 + Math.ceil((world.cols * CELL_W) / NAV), j1 = j0 + Math.ceil((world.rows * CELL_H) / NAV);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!navOk(w, sel.sp, i, j)) mark((i + 0.5) * NAV, (j + 0.5) * NAV, 120, [200, 60, 60]);
  }
  for (const a of s.park.animals) {
    if (a.path) {
      let x = a.x, y = a.y;
      for (let k = a.pi; k * 2 < a.path.length; k++) {
        const tx = a.path[k * 2], ty = a.path[k * 2 + 1];
        const n = Math.ceil(Math.hypot(tx - x, ty - y) / 8);
        for (let m = 1; m <= n; m++) mark(x + ((tx - x) * m) / n, y + ((ty - y) * m) / n, 46, P.accent);
        mark(tx, ty, 111, P.accent);
        x = tx; y = ty;
      }
    }
    if (a.stuckT > 1.5) mark(a.x, a.y - 40, 33, [255, 80, 80]);
  }
}

/**
 * Barres d'avancement à afficher au-dessus du monde : incubation des nids et gestation des
 * espèces vivipares (`Animal.gestation`, 0..1, si la simulation la renseigne). En cellules monde.
 */
function progressBars(s: GameState): { cx: number; cy: number; v: number; selected: boolean }[] {
  const p = s.park, out: { cx: number; cy: number; v: number; selected: boolean }[] = [];
  const x0 = p.cam.x - 200, x1 = p.cam.x + metrics.cols * CELL_W + 200;
  const y0 = p.cam.y - 200, y1 = p.cam.y + metrics.rows * CELL_H + 200;
  for (const n of p.nests) {
    if (n.hatched !== undefined || n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
    const r = nestRaster(n);
    out.push({ cx: r.cx + r.w / 2, cy: r.cy, v: Math.min(1, n.t / INCUBATION), selected: n.id === p.nestSel || n.id === p.nestHover });
  }
  for (const a of p.animals) {
    const g = a.gestation;
    if (!g || a.task === "dead" || a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
    const r = animalRaster(a, s.time);
    out.push({ cx: r.cx + r.w / 2, cy: r.cy, v: Math.min(1, g), selected: a.id === p.selected || a.id === p.hover });
  }
  return out;
}
