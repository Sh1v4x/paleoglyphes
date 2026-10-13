import { CELL_H, CELL_W, DEV, WORLD_H, WORLD_W } from "../config";
import { CLOCK_SPEEDS, clockLabel, daylight, litTheme, periodName } from "../daycycle";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { composeWorld, type Actor, type Critter } from "../render/compose";
import { metrics, worldCellAt } from "../render/metrics";
import { placed, RasterCache, type Raster } from "../render/raster";
import { mulberry32 } from "../rng";
import { SPECIES, SPECIES_LIST } from "../species";
import type { Action, FactUnlock, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { bar, button, panel, put, region, text, wrap } from "../ui/kit";
import { unlockTrigger } from "../unlock";
import { isWater } from "../world/tiles";
import { faunaActors, faunaAt, faunaDef, noteFauna, type Bug } from "./eco-fauna";
import { activity, stepEcosystem, type EcoState } from "./ecosystem";
import { UNLOCK_HINT } from "./journal";
import { activeTrees, treeRaster, updateTrees } from "../world/trees";
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
  trample: Float32Array | null;
  started: boolean;
  /** Vitesse de repousse des arbres (accélérée après la météorite). */
  regrow?: number;
  /** Calque de debug de la navigation (dev, touche N). */
  debugNav?: boolean;
  /** Écosystème : plantes, points d'eau, petite faune. */
  eco: EcoState | null;
  /** Molette cumulée (passer d'un animal à l'autre). */
  wheel: number;
}

export function createParkState(): ParkState {
  return { cam: { x: 0, y: 0 }, animals: [], nextId: 1, follow: false, critters: [], trample: null, started: false, eco: null, wheel: 0 };
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
  const key = `${a.sp}|${flip ? 1 : 0}|${a.action}|${moving}|${wq}|${tq}|${aq}`;
  const r = cache.get(key, () => spec.model({ walk: wq * (TAU / 12), moving, time: tq / 6, action: a.action, actionT: aq / 8 }), flip);
  return placed(r, Math.floor(a.x / CELL_W), Math.floor(a.y / CELL_H));
}

/** Un animal peut-il se tenir à (x, y) ? Pas d'eau profonde ni d'obstacle sous le corps. */
export function canStand(s: GameState, sp: SpeciesId, x: number, y: number): boolean {
  // Même emprise que la grille de navigation : collisions et chemins sont toujours d'accord.
  return standable(worldFor(s), sp, x, y);
}

function spawn(s: GameState, sp: SpeciesId, near?: { x: number; y: number }) {
  const p = s.park;
  const rng = mulberry32(p.nextId * 7919 + 13);
  for (let k = 0; k < 400; k++) {
    const x = near && k < 300 ? near.x + (rng() - 0.5) * 360 : 200 + rng() * (WORLD_W - 400);
    const y = near && k < 300 ? near.y + (rng() - 0.5) * 160 : 200 + rng() * (WORLD_H - 400);
    if (!canStand(s, sp, x, y)) continue;
    const a: Animal = {
      id: p.nextId++, sp, x, y, facing: rng() < 0.5 ? 1 : -1, walk: 0, moving: 0, action: "idle", actionT: 0,
      phase: rng() * 10, inWater: false, tx: x, ty: y, timer: rng() * 3, hunger: rng() * 0.5, thirst: rng() * 0.5,
      energy: 0.6 + rng() * 0.4, hp: 1, mood: "wander", herd: 1, targetId: 0,
      task: "wander", scan: rng() * 0.4, stun: 0, cool: 10 + rng() * 20, decay: 0, meat: 0, answer: 0,
      age: rng() * rng(), spot: -1, side: rng() < 0.5 ? 1 : -1, blocked: 0, chase: 0, alarm: 0,
      gx: x, gy: y, best: Infinity, stall: 0, vx: 0, vy: 0, vt: 0,
      path: null, pi: 0, pgx: x, pgy: y, repath: 0, prog: Infinity, progT: 0, stuckT: 0,
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
  p.trample = new Float32Array(w.cols * w.rows);
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
  s.park.follow = true;
}

const MINI_W = 28, MINI_H = 10;
/** Lettre de chaque espèce sur la mini-carte. */
const MINI_GLYPH: Partial<Record<SpeciesId, string>> = { ankylo: "A", raptor: "R", trike: "T", edmonto: "E", pachy: "P", trex: "X" };

function centerOn(s: GameState, x: number, y: number) {
  s.park.cam.x = x - (metrics.cols * CELL_W) / 2;
  s.park.cam.y = y - (metrics.rows * CELL_H) / 2;
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
    // Caméra : clavier + glisser.
    const speed = 700 * dt;
    if (input.dx || input.dy) p.follow = false;
    p.cam.x += input.dx * speed;
    p.cam.y += input.dy * speed;
    if (input.mouse.down && (input.mouse.dragX || input.mouse.dragY)) {
      p.follow = false;
      p.cam.x -= input.mouse.dragX;
      p.cam.y -= input.mouse.dragY;
    }
    // Molette : animal suivant / précédent.
    p.wheel += input.mouse.wheel;
    if (Math.abs(p.wheel) >= 80) { cycle(s, p.wheel > 0 ? 1 : -1); p.wheel = 0; }

    stepEcosystem(s, dt);
    updateTrees(w, dt, p.regrow ?? 1);

    const sel = p.animals.find((a) => a.id === p.selected);
    if (!sel) p.selected = undefined;
    const bug = p.bug !== undefined ? p.eco?.fauna.find((b) => b.uid === p.bug) : undefined;
    const tgt = sel ?? (bug ? { x: bug.x, y: bug.y } : undefined);
    if (p.follow && tgt) {
      p.cam.x += (tgt.x - metrics.cols * CELL_W / 2 - p.cam.x) * Math.min(1, dt * 4);
      p.cam.y += (tgt.y - metrics.rows * CELL_H / 2 - p.cam.y) * Math.min(1, dt * 4);
    }
    p.cam.x = Math.max(0, Math.min(w.cols * CELL_W - metrics.cols * CELL_W, p.cam.x));
    p.cam.y = Math.max(0, Math.min(w.rows * CELL_H - metrics.rows * CELL_H, p.cam.y));

    // Herbe couchée sous les pas.
    if (p.trample) {
      const decay = Math.exp(-dt / 1.4);
      const tr = p.trample;
      for (let i = 0; i < tr.length; i++) if (tr[i] > 0.01) tr[i] *= decay; else tr[i] = 0;
      for (const a of p.animals) {
        if (a.moving < 0.3) continue;
        const spec = SPECIES[a.sp];
        if (!spec) continue;
        for (const fx of spec.feet) {
          const i = Math.floor(a.y / CELL_H) * w.cols + Math.floor((a.x + fx * a.facing) / CELL_W);
          if (i > 0 && i < tr.length - 1) { tr[i] = 1; tr[i + 1] = 1; tr[i - 1] = 1; }
        }
      }
    }
    for (const c of p.critters) {
      const t = s.time * 0.25 + c.seed;
      c.x = c.hx + Math.sin(t * 1.3) * 40 + Math.sin(t * 0.7 + 2) * 25;
      c.y = c.hy + Math.cos(t * 1.1) * 18 + Math.sin(t * 2.3) * 6;
    }

    if (input.mouse.inside) {
      p.hover = animalAt(s, input.mouse.x, input.mouse.y)?.id;
      p.bugHover = p.hover === undefined ? faunaAt(s, input.mouse.x, input.mouse.y)?.uid : undefined;
    } else p.hover = p.bugHover = undefined;
    for (const c of input.worldClicks) {
      const a = animalAt(s, c.x, c.y);
      if (a) { observe(s, a); continue; }
      const b = faunaAt(s, c.x, c.y);
      if (b) { p.bug = b.uid; p.selected = undefined; noteFauna(s, b); continue; }
      p.selected = undefined;
      p.bug = undefined;
    }
    if (DEV && input.pressed.includes("KeyN")) p.debugNav = !p.debugNav;
    for (const id of input.ui) {
      if (id === "park:follow") p.follow = !p.follow;
      if (id === "park:clock") s.clockSpeed = CLOCK_SPEEDS[(CLOCK_SPEEDS.indexOf(s.clockSpeed as 1) + 1) % CLOCK_SPEEDS.length];
      if (id === "park:close") { p.selected = undefined; p.bug = undefined; p.follow = false; }
      if (id === "park:journal" && sel) { s.journal.species = sel.sp; s.journal.extras = false; s.mode = "journal"; }
      if (id === "park:extras") { s.journal.species = undefined; s.journal.extras = true; s.mode = "journal"; }
      if (id.startsWith("park:mini:")) {
        const [, , i, j] = id.split(":");
        centerOn(s, ((Number(i) + 0.5) / (MINI_W - 2)) * WORLD_W, ((Number(j) + 0.5) / (MINI_H - 2)) * WORLD_H);
      }
    }
  },

  compose(s, th, world, ui) {
    const p = s.park;
    const w = worldFor(s);
    const camX = Math.floor(p.cam.x / CELL_W), camY = Math.floor(p.cam.y / CELL_H);
    const actors: Actor[] = [];
    const margin = 400;
    const vx0 = p.cam.x - margin, vx1 = p.cam.x + world.cols * CELL_W + margin;
    const vy0 = p.cam.y - margin, vy1 = p.cam.y + world.rows * CELL_H + margin;
    for (const a of p.animals) {
      if (a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      const spec = SPECIES[a.sp];
      if (!spec) continue;
      actors.push({
        id: a.id, r: animalRaster(a, s.time), x: a.x, y: a.y, inWater: a.inWater,
        shadowRx: spec.halfLen * spec.shadow * (a.task === "dead" ? 1.1 : 1), eyeX: a.x + spec.eye.x * a.facing, eyeY: a.y + spec.eye.y,
      });
    }
    faunaActors(s, actors, vx0, vy0, vx1, vy1);
    // Arbres renversés, souches et jeunes pousses : dessinés comme des objets animés.
    for (const t of activeTrees()) {
      if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1 || !w.trees.includes(t)) continue;
      const r = treeRaster(t);
      if (r) actors.push({ id: -100000 - t.id, r: placed(r, Math.floor(t.x / CELL_W), Math.floor(t.y / CELL_H)), x: t.x, y: t.y, inWater: false, shadowRx: t.state === "down" ? 60 : 18, eyeX: t.x, eyeY: -1e6 });
    }
    // La réserve suit le cycle jour / nuit ; l'interface garde ses couleurs.
    composeWorld(litTheme(th, s.clock), world, {
      world: w, time: s.time, camX, camY,
      glowX: p.cam.x + world.cols * CELL_W / 2, glowY: p.cam.y + world.rows * CELL_H / 2,
      actors, critters: p.critters, trample: p.trample ?? undefined, selected: p.selected ?? (p.bug !== undefined ? 1_000_000 + p.bug : undefined),
    });

    if (DEV && p.debugNav) drawNavDebug(s, th, world, camX, camY);
    const u = th.ui;
    const toUi = (cx: number, cy: number) => ({ x: ((cx - camX) * metrics.cellW) / metrics.uiW, y: ((cy - camY) * metrics.cellH) / metrics.uiH });
    // Étiquettes au-dessus de l'animal survolé ou sélectionné : nom + ce qu'il fait.
    for (const id of new Set([p.hover, p.selected])) {
      const a = p.animals.find((b) => b.id === id);
      if (!a) continue;
      const spec = SPECIES[a.sp];
      if (!spec) continue;
      const r = animalRaster(a, s.time);
      const at = toUi(r.cx + r.w / 2, r.cy);
      const isSel = id === p.selected;
      const label = ` ${spec.name} `;
      const lx = Math.round(at.x - label.length / 2), ly = Math.round(at.y - 1.2);
      text(ui, lx, ly, label, isSel ? u.panel : u.text, isSel ? u.hi : u.panel, 0.9);
      const sub = ` ${activity(a)} `;
      if (id === p.hover) text(ui, Math.round(at.x - sub.length / 2), ly + 1, sub, u.dim, u.panel, 0.8);
    }
    for (const uid of new Set([p.bugHover, p.bug])) {
      const b = p.eco?.fauna.find((f) => f.uid === uid);
      const def = b && faunaDef(b);
      if (!b || !def) continue;
      const at = toUi(b.x / CELL_W, (b.y - b.alt) / CELL_H - 4);
      const label = ` ${def.name} `;
      text(ui, Math.round(at.x - label.length / 2), Math.round(at.y - 1), label, uid === p.bug ? u.panel : u.text, uid === p.bug ? u.hi : u.panel, 0.9);
    }

    const sel = p.animals.find((a) => a.id === p.selected);
    if (sel) drawCard(s, th, ui, sel);
    else if (p.bug !== undefined) {
      const b = p.eco?.fauna.find((f) => f.uid === p.bug);
      if (b) drawBugCard(s, th, ui, b);
    }
    drawMini(s, th, ui);
    drawClock(s, th, ui);

    if (!p.animals.some((a) => a.task !== "dead")) {
      const W = 56, x = Math.floor((ui.cols - W) / 2), y = Math.floor(ui.rows / 2) - 4;
      panel(ui, th, x, y, W, 7, "Réserve vide");
      wrap("Aucun dinosaure ici pour l'instant. Fouille des os, assemble un squelette à l'atelier, puis synthétise-le : il viendra vivre ici.", W - 4)
        .forEach((l, i) => text(ui, x + 2, y + 2 + i, l, u.text, u.panel, u.alpha));
    }
    text(ui, 1, ui.rows - 1, "Flèches/ZQSD ou glisser : caméra   Clic : observer   Molette : animal suivant", u.dim, u.panel, 0.7);
  },
};

/** Fiche de l'animal sélectionné : activité, besoins, troupeau, ce qu'il reste à découvrir. */
function drawCard(s: GameState, th: Theme, ui: Frame, a: Animal) {
  const spec = SPECIES[a.sp];
  if (!spec) return;
  const u = th.ui;
  const W = 46, H = 16, x = 2, y = ui.rows - H - 2;
  panel(ui, th, x, y, W, H, spec.name);
  text(ui, x + 2, y + 1, spec.latin, u.dim, u.panel, u.alpha);
  const lines = wrap(`En ce moment : il ${activity(a)}.`, W - 4);
  lines.slice(0, 2).forEach((l, i) => text(ui, x + 2, y + 2 + i, l, u.text, u.panel, u.alpha));
  let r = y + 5;
  if (a.task === "dead") {
    wrap(`Carcasse : elle disparaîtra dans ${Math.ceil(a.decay / 60)} min. Les charognards en profitent.`, W - 4)
      .forEach((l, i) => text(ui, x + 2, r + i, l, u.dim, u.panel, u.alpha));
    r += 4;
  } else {
    const need = (label: string, v: number, bad: boolean) => {
      text(ui, x + 2, r, label, u.text, u.panel, u.alpha);
      bar(ui, th, x + 11, r, 20, v, bad ? u.bad : u.ok);
      text(ui, x + 32, r, bad ? "!" : "", u.bad, u.panel, u.alpha);
      r++;
    };
    need("Faim", a.hunger, a.hunger > 0.7);
    need("Soif", a.thirst, a.thirst > 0.7);
    need("Énergie", a.energy, a.energy < 0.25);
    const [h0, h1] = spec.behavior.herd;
    const herdTxt = h1 <= 1 ? "Solitaire : il vit seul." : a.herd > 1 ? `Troupeau : ${a.herd} individus ensemble.` : `Seul, loin de son groupe (${h0}-${h1} d'habitude).`;
    text(ui, x + 2, r++, herdTxt, u.dim, u.panel, u.alpha);
  }
  // Ce qui reste à découvrir : on pointe le prochain fait verrouillé.
  const facts = spec.facts;
  const got = facts.filter((f) => s.progress.facts.includes(`${a.sp}:${f.id}`)).length;
  text(ui, x + 2, r + 1, `Carnet : ${got}/${facts.length} faits`, u.text, u.panel, u.alpha);
  const locked = facts.filter((f) => !s.progress.facts.includes(`${a.sp}:${f.id}`) && f.unlock !== "assemble");
  const now = locked.find((f) => f.unlock === a.action || f.unlock === a.mood);
  let teaser: string, hot = false;
  if (now) { teaser = "Clique-le maintenant pour en apprendre plus !"; hot = true; }
  else if (locked[0]) teaser = `Indice : ${UNLOCK_HINT[locked[0].unlock]}`;
  else teaser = got === facts.length ? "Carnet complet pour cette espèce. Bravo !" : "Assemble son squelette à l'atelier pour le dernier fait.";
  wrap(teaser, W - 4).slice(0, 2).forEach((l, i) => text(ui, x + 2, r + 2 + i, l, hot ? u.hi : u.dim, u.panel, u.alpha));
  let bx = x + 2;
  bx += button(ui, th, "park:follow", bx, y + H - 2, s.park.follow ? "Ne plus suivre" : "Suivre", { active: s.park.follow }) + 1;
  bx += button(ui, th, "park:journal", bx, y + H - 2, "Carnet") + 1;
  button(ui, th, "park:close", bx, y + H - 2, "x");
}

/** Fiche d'une petite bête (note bonus du carnet). */
function drawBugCard(s: GameState, th: Theme, ui: Frame, b: Bug) {
  const def = faunaDef(b);
  if (!def) return;
  const u = th.ui;
  const W = 46;
  const body = wrap(def.text, W - 4).slice(0, 6);
  const H = 7 + body.length, x = 2, y = ui.rows - H - 2;
  panel(ui, th, x, y, W, H, def.name);
  text(ui, x + 2, y + 1, def.latin, u.dim, u.panel, u.alpha);
  body.forEach((l, i) => text(ui, x + 2, y + 3 + i, l, u.text, u.panel, u.alpha));
  text(ui, x + 2, y + H - 3, "Note ajoutée au carnet (Extras).", u.hi, u.panel, u.alpha);
  let bx = x + 2;
  bx += button(ui, th, "park:follow", bx, y + H - 2, s.park.follow ? "Ne plus suivre" : "Suivre", { active: s.park.follow }) + 1;
  bx += button(ui, th, "park:extras", bx, y + H - 2, "Extras") + 1;
  button(ui, th, "park:close", bx, y + H - 2, "x");
}

/** Mini-carte : eau, animaux (initiale de l'espèce), carcasses, cadre de la caméra. Cliquer y déplace la caméra. */
function drawMini(s: GameState, th: Theme, ui: Frame) {
  const p = s.park, w = worldFor(s), u = th.ui;
  if (ui.cols < 90 || ui.rows < 30) return;
  const x0 = ui.cols - MINI_W - 1, y0 = ui.rows - MINI_H - 2;
  const iw = MINI_W - 2, ih = MINI_H - 2;
  panel(ui, th, x0, y0, MINI_W, MINI_H, "Carte");
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
      region(`park:mini:${i}:${j}`, x0 + 1 + i, y0 + 1 + j, 1, 1);
    }
  }
  for (const a of p.animals) {
    const i = Math.floor(a.x / cw), j = Math.floor(a.y / ch);
    if (i < 0 || j < 0 || i >= iw || j >= ih) continue;
    const dead = a.task === "dead";
    const g = dead ? "%" : MINI_GLYPH[a.sp] ?? SPECIES[a.sp]?.name[0] ?? "?";
    const col = a.id === p.selected ? u.hi : dead ? u.dim : SPECIES[a.sp]?.behavior.diet === "carnivore" ? u.bad : u.text;
    text(ui, x0 + 1 + i, y0 + 1 + j, g, col, null);
  }
}

/**
 * Horloge de la réserve (en haut à gauche) : heure, moment de la journée, frise des 24 h avec
 * le soleil ou la lune, et vitesse du temps (clic pour accélérer : x1, x4, x16).
 */
function drawClock(s: GameState, th: Theme, ui: Frame) {
  const u = th.ui;
  const W = 32, H = 7, x = 1, y = UI_TOP;
  const hour = s.clock;
  const day = daylight(hour) > 0.5;
  panel(ui, th, x, y, W, H, "Horloge");
  region("park:clock", x, y, W, H);
  // Astre + heure + moment.
  const sun: RGB = [255, 196, 64], moon: RGB = [150, 180, 255];
  text(ui, x + 2, y + 1, day ? "(O)" : "(C", day ? sun : moon, u.panel, u.alpha);
  text(ui, x + 7, y + 1, clockLabel(hour), u.text, u.panel, u.alpha);
  text(ui, x + 14, y + 1, periodName(hour), u.hi, u.panel, u.alpha);
  // Frise des 24 heures : jour en tirets, nuit en points, l'astre à l'heure courante.
  const track = W - 6, tx = x + 3, ty = y + 3;
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
  text(ui, x + 2, y + 5, "Clic : accelerer le temps", u.dim, u.panel, u.alpha);
  const sp = `x${s.clockSpeed}`;
  text(ui, x + W - 2 - sp.length, y + 1, sp, s.clockSpeed > 1 ? u.hi : u.dim, u.panel, u.alpha);
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
