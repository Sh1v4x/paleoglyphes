import { CELL_H, CELL_W } from "../config";
import { mass, meanAround } from "../features/lenia";
import { saveProgress } from "../progress";
import { mulberry32 } from "../rng";
import { SPECIES } from "../species";
import { BREED_COOLDOWN, CLUTCH, growthOf, INCUBATION, lifespan, liveBirth, MAX_PER_SPECIES, STAGE_AT, stageOf } from "../species/life";
import type { Species, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { toast } from "../ui/toast";
import { BIOME } from "../world/biomes";
import { isWater, T } from "../world/tiles";
import { beachNester, beachSite, isFish, onLand, specialStats } from "./eco-special";
import type { WildKit } from "./eco-wild";
import { coastAt, deepSea, nearestFree, standable } from "./nav";
import { migrationArrived, type Animal, type Nest } from "./park";

/**
 * Cycle de vie de la réserve : vieillissement et mort de vieillesse, parades, nids gardés par un
 * parent, pillage d'œufs, éclosion, petits qui suivent leur parent puis grandissent.
 * Le Mosasaure met bas en pleine mer (pas de nid). Les états propres au cycle (construction de nid,
 * parade, pillage, gestation) vivent dans des WeakMap : rien de périmé quand un animal disparaît.
 * Coût : O(n) par pas ; O(n²) seulement au balayage périodique (toutes les secondes).
 */

/** Briques de l'écosystème prêtées au cycle de vie (ecosystem.ts). */
export interface NestKit extends WildKit {
  decide(s: GameState, a: Animal, spec: Species): void;
}

/** Gestation (s) des espèces vivipares. */
const PREGNANCY = INCUBATION;
/** Durée du chantier du nid (s) : on creuse (eat), puis on s'installe (rest). */
const BUILD = 5;
/** Un pilleur prend un œuf toutes les ... s. */
const STEAL_EVERY = 3.5;

/** Compteurs pour la simulation (scripts/sim-park.ts) et le debug. */
export const lifeStats = { births: 0, liveBirths: 0, nests: 0, hatched: 0, stolen: 0, oldAge: 0, predation: 0, retired: 0 };

interface Plan { x: number; y: number; t: number; ttl: number }
interface Raid { nest: Nest; t: number; got: number }
const plans = new WeakMap<Animal, Plan>();
const raids = new WeakMap<Animal, Raid>();
const courting = new WeakMap<Animal, { mate: Animal; ttl: number }>();
const pregnant = new WeakMap<Animal, number>();
/** Tortue (ou petit) hors de l'eau : temps passé à terre depuis le début du retour vers le large (s). */
const ashore = new WeakMap<Animal, number>();
/** Espèces dont on a déjà annoncé le premier nid (pendant la session). */
const toldNest = new Set<SpeciesId>();
let scanT = 0;

const grounded = (a: Animal) => a.alt === 0 && a.mood !== "fly" && a.action !== "takeoff" && a.action !== "land";
const calm = (a: Animal) => a.task === "wander" || a.task === "graze" || a.task === "drink" || a.task === "rest" || a.task === "call";
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, (a.y - b.y) * 1.3);
/** Petit (bébé ou juvénile) : il suit un parent. */
export const isYoung = (a: Animal) => a.growth < 0.999;
export const isBaby = (spec: Species, a: Animal) => a.life < lifespan(spec) * STAGE_AT.juvenile;

/** Nid gardé ou visé par un animal (id de nid). */
export function nestOf(s: GameState, id: number): Nest | undefined {
  if (!id) return undefined;
  for (const n of s.park.nests) if (n.id === id) return n;
  return undefined;
}

// ---------------------------------------------------------------------------
// Naissances et morts
// ---------------------------------------------------------------------------

/** Un nouvel animal (mêmes champs que spawn() dans park.ts : garder les deux en accord). */
export function makeAnimal(s: GameState, sp: SpeciesId, x: number, y: number, life: number): Animal {
  const p = s.park;
  const rng = mulberry32(p.nextId * 7919 + 17);
  const spec = SPECIES[sp];
  const a: Animal = {
    id: p.nextId++, sp, x, y, facing: rng() < 0.5 ? 1 : -1, walk: 0, moving: 0, action: "idle", actionT: 0,
    phase: rng() * 10, inWater: false, tx: x, ty: y, timer: rng() * 2, hunger: 0.15, thirst: 0.15,
    energy: 1, hp: 1, mood: "wander", herd: 1, targetId: 0,
    task: "wander", scan: rng() * 0.4, stun: 0, cool: 30, decay: 0, meat: 0, answer: 0,
    age: 0, spot: -1, side: rng() < 0.5 ? 1 : -1, blocked: 0, chase: 0, alarm: 0,
    gx: x, gy: y, best: Infinity, stall: 0, vx: 0, vy: 0, vt: 0,
    path: null, pi: 0, pgx: x, pgy: y, repath: 0, prog: Infinity, progT: 0, stuckT: 0, alt: 0,
    life, growth: spec ? growthOf(spec, life) : 1, parentId: 0, nestId: 0, breedCool: BREED_COOLDOWN,
  };
  p.animals.push(a);
  return a;
}

/** Libère tout ce que l'animal tenait : nid gardé, chantier, parade, pillage, gestation. */
function release(s: GameState, a: Animal) {
  const n = nestOf(s, a.nestId);
  if (n && n.guard === a.id) n.guard = 0;
  a.nestId = 0;
  plans.delete(a); raids.delete(a); courting.delete(a); pregnant.delete(a); a.gestation = 0;
}

/** Mort sans prédateur (vieillesse, retrait) : carcasse maigre qui disparaît vite. */
function die(s: GameState, a: Animal, decay: number, meat: number) {
  release(s, a);
  a.task = "dead"; a.mood = "dead"; a.timer = 0;
  a.action = "dead"; a.actionT = 0;
  a.hp = 0; a.decay = decay; a.meat = meat; a.moving = 0; a.natural = true; a.path = null;
  const pop = s.progress.population;
  pop[a.sp] = Math.max(0, (pop[a.sp] ?? 1) - 1);
  saveProgress(s.progress);
}

/** Bouton « Retirer » de l'interface : l'animal quitte la réserve tout de suite (sans toast). */
export function retireAnimal(s: GameState, a: Animal): void {
  if (a.task === "dead") return;
  die(s, a, 20, 0);
  lifeStats.retired++;
}

const vowel = (w: string) => /^[aeiouyhàâéèêîïôû]/i.test(w);
const plural = (w: string) => (/[sx]$/.test(w) ? w : `${w}s`);

function dieOld(s: GameState, a: Animal, spec: Species) {
  die(s, a, 60, 0.25);
  lifeStats.oldAge++;
  const others = s.park.animals.some((o) => o.sp === a.sp && o.task !== "dead");
  toast(s, "Fin de vie", `Un ${vowel(spec.name) ? "vieil" : "vieux"} ${spec.name} s'est éteint paisiblement. `
    + (others ? "Une nouvelle génération prend la relève." : "Tu peux en synthétiser un autre à l'atelier."));
}

/** Case libre pour un petit autour de (x, y). */
function spotNear(s: GameState, sp: SpeciesId, x: number, y: number, k: number): { x: number; y: number } | null {
  const w = worldFor(s);
  const ang = k * 2.1, r = 18 + k * 9;
  const tx = x + Math.cos(ang) * r, ty = y + Math.sin(ang) * r * 0.5;
  return nearestFree(w, sp, tx, ty, 10);
}

/** Adulte vivant de l'espèce le plus proche (null si aucun). */
function nearestAdult(s: GameState, sp: SpeciesId, x: number, y: number, range = Infinity, not?: Animal): Animal | undefined {
  let best: Animal | undefined, bd = range;
  for (const o of s.park.animals) {
    if (o.sp !== sp || o.task === "dead" || o === not || isYoung(o)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Plafond de l'espèce : MAX_PER_SPECIES, moins pour les solitaires et les petits groupes (grands prédateurs). */
export const capOf = (spec: Species) => Math.min(MAX_PER_SPECIES, spec.behavior.herd[1] <= 1 ? 4 : spec.behavior.herd[1] * 2 + 2);

function living(s: GameState, sp: SpeciesId): number {
  let n = 0;
  for (const o of s.park.animals) if (o.sp === sp && o.task !== "dead") n++;
  return n;
}

/** Éclosion : les œufs restants deviennent des bébés (dans la limite du plafond de l'espèce). */
function hatch(s: GameState, nest: Nest) {
  const spec = SPECIES[nest.sp];
  if (!spec) { nest.hatched = 60; return; }
  const guard = nest.guard ? s.park.animals.find((o) => o.id === nest.guard && o.task !== "dead") : undefined;
  if (guard) guard.nestId = 0;
  nest.guard = 0;
  // Les tortues de mer ne s'occupent pas de leurs petits : ils filent seuls vers la mer.
  const parent = nest.sp === "archelon" ? undefined : guard ?? nearestAdult(s, nest.sp, nest.x, nest.y, 1500);
  const room = Math.max(0, capOf(spec) - living(s, nest.sp));
  let n = 0;
  for (let k = 0; k < nest.eggs && n < room; k++) {
    const q = spotNear(s, nest.sp, nest.x, nest.y, k);
    if (!q) continue;
    const b = makeAnimal(s, nest.sp, q.x, q.y, 0);
    b.parentId = parent?.id ?? 0;
    b.facing = q.x < nest.x ? -1 : 1;
    n++;
  }
  nest.eggs = n;
  nest.hatched = 60;
  if (!n) return;
  const pop = s.progress.population;
  pop[nest.sp] = (pop[nest.sp] ?? 0) + n;
  saveProgress(s.progress);
  lifeStats.births += n; lifeStats.hatched++;
  toast(s, "Éclosion !", (n > 1 ? `${n} petits ${plural(spec.name)} sont nés.` : `Un petit ${spec.name} est né.`)
    + (nest.sp === "archelon" ? " Ils courent seuls vers la mer !" : ""));
}

/** Mise bas en pleine mer (vivipares). */
function giveBirth(s: GameState, mother: Animal, spec: Species) {
  if (living(s, mother.sp) >= capOf(spec)) return;
  for (let k = 0; k < 6; k++) {
    const q = spotNear(s, mother.sp, mother.x - mother.facing * spec.halfLen * 0.6, mother.y, k);
    if (!q) continue;
    const b = makeAnimal(s, mother.sp, q.x, q.y, 0);
    b.parentId = mother.id;
    b.facing = mother.facing;
    const pop = s.progress.population;
    pop[mother.sp] = (pop[mother.sp] ?? 0) + 1;
    saveProgress(s.progress);
    lifeStats.births++; lifeStats.liveBirths++;
    toast(s, "Naissance !", isFish(spec)
      ? `Un jeune ${spec.name} est né du frai, en pleine mer : ce poisson fraie au large.`
      : `Un petit ${spec.name} est né${spec.habitat === "sea" ? " en pleine mer" : ""} : son espèce ne pondait pas d'œufs, elle mettait bas.`);
    return;
  }
}

// ---------------------------------------------------------------------------
// Nids
// ---------------------------------------------------------------------------

/**
 * Emplacement de nid près de l'animal : sol sec, loin de l'eau et des arbres (espèces terrestres),
 * plutôt sur un sol nu près du rivage (ptérosaure). Pas trop près d'un autre nid.
 */
function nestSite(s: GameState, a: Animal, air: boolean): { x: number; y: number } | null {
  const w = worldFor(s);
  const cell = (x: number, y: number) => {
    const i = Math.floor(y / CELL_H), j = Math.floor(x / CELL_W);
    return i < 0 || j < 0 || i >= w.rows || j >= w.cols ? -1 : i * w.cols + j;
  };
  for (let n = 0; n < 50; n++) {
    const ang = Math.random() * Math.PI * 2, r = 100 + Math.random() * (air ? 600 : 300);
    const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r * 0.6;
    if (!s.park.nests.every((o) => Math.hypot(o.x - x, o.y - y) > 160)) continue;
    const c = cell(x, y);
    if (c < 0 || isWater(w.terrain[c]) || w.solid[c] || !standable(w, a.sp, x, y)) continue;
    let ok = true, wet = false;
    for (let dy = -21; dy <= 21 && ok; dy += 7) for (let dx = -80; dx <= 80 && ok; dx += 16) {
      const i = cell(x + dx, y + dy);
      if (i < 0) { ok = false; break; }
      if (isWater(w.terrain[i])) wet = true;
      if (w.solid[i] && Math.abs(dx) < 40) ok = false;
    }
    if (!ok) continue;
    // Terrestres : au sec. Ptérosaure : sol nu, au bord de l'eau si possible (les premiers essais).
    if (!air && wet) continue;
    if (air && n < 35 && w.terrain[c] !== T.Dirt) continue;
    return { x, y };
  }
  return null;
}

function makeNest(s: GameState, a: Animal, spec: Species, x: number, y: number, guard = true) {
  const p = s.park;
  const nest: Nest = { id: p.nextNest++, sp: a.sp, x, y, eggs: CLUTCH[0] + Math.floor(Math.random() * (CLUTCH[1] - CLUTCH[0] + 1)), t: 0, guard: guard ? a.id : 0 };
  p.nests.push(nest);
  if (guard) a.nestId = nest.id;
  lifeStats.nests++;
  if (!toldNest.has(a.sp)) {
    toldNest.add(a.sp);
    toast(s, "Un nid !", guard
      ? `Un nid ${vowel(spec.name) ? "d'" : "de "}${spec.name} ! Les œufs vont bientôt éclore.`
      : `Une ${spec.name} a pondu sur la plage, puis elle est retournée à la mer : les tortues ne gardent pas leurs œufs.`);
  }
}

// ---------------------------------------------------------------------------
// Cerveau du cycle de vie (appelé par ecosystem.ts avant l'IA ordinaire)
// ---------------------------------------------------------------------------

/**
 * Comportements du cycle de vie : petits qui suivent un parent, construction et garde du nid,
 * parade, pillage d'œufs. Renvoie true si l'animal a été pris en charge pour ce pas (l'IA
 * ordinaire ne joue pas), false sinon. Pour la mer et les airs, appelé avant liveSea / liveAir.
 */
export function lifeBrain(k: NestKit, s: GameState, a: Animal, spec: Species, dt: number): boolean {
  const hab = spec.habitat ?? "land";
  const raid = raids.get(a);
  if (raid) return raidStep(k, s, a, spec, raid, dt);
  if (a.sp === "archelon") return turtleStep(k, s, a, spec, dt);
  if (isYoung(a)) return youngStep(k, s, a, spec, hab, dt);
  if (hab === "air") {
    // En vol : le bâtisseur et le gardien redescendent vers le nid au lieu de se poser au hasard.
    if (!grounded(a)) {
      const pl = plans.get(a), n = nestOf(s, a.nestId);
      const t = pl ?? n;
      if (t && a.task === "wander" && a.timer <= 0 && a.action === "fly") {
        k.setTask(a, "rest", "fly");
        a.tx = t.x + a.side * spec.halfLen * 0.5; a.ty = t.y + 6;
      }
      return false;
    }
    if (k.threat(a, spec.behavior.sight * 0.45)) return false; // il s'envole (liveAir)
  }
  const pl = plans.get(a);
  if (pl) return buildStep(k, s, a, spec, pl, dt);
  const nest = a.nestId ? nestOf(s, a.nestId) : undefined;
  if (nest) return guardStep(k, s, a, spec, nest, hab, dt);
  const c = courting.get(a);
  if (c && a.task === "wander") {
    if (c.mate.task === "dead" || (c.ttl -= dt) <= 0) { courting.delete(a); return false; }
    const d = Math.hypot(c.mate.x - a.x, c.mate.y - a.y);
    a.mood = "court";
    if (d > 180) { if (k.go(s, a, spec, c.mate.x, c.mate.y, spec.walkSpeed, dt) < 0) courting.delete(a); }
    else { k.act(a, "idle"); k.face(a, c.mate.x); }
    return true;
  }
  return false;
}

/** Chantier du nid : on rejoint l'emplacement, on creuse, on s'installe, puis le nid apparaît. */
function buildStep(k: NestKit, s: GameState, a: Animal, spec: Species, pl: Plan, dt: number): boolean {
  if (a.task !== "wander" && a.task !== "graze" && a.task !== "call") return false;
  if (a.task !== "wander") k.setTask(a, "wander", "nest");
  a.mood = "nest";
  const d = Math.hypot(pl.x - a.x, pl.y - a.y);
  if (d > 14 && pl.t === 0) {
    const r = k.go(s, a, spec, pl.x, pl.y, spec.walkSpeed, dt, true);
    // Bloqué : on construit là où l'on est.
    if (r < 0) { pl.x = a.x; pl.y = a.y; }
    return true;
  }
  pl.t += dt;
  k.act(a, pl.t < BUILD * 0.6 ? "eat" : "rest");
  if (pl.t >= BUILD) {
    plans.delete(a);
    // Le nid se pose juste devant le bâtisseur, qui reste à côté.
    const nx = a.x + a.facing * spec.halfLen * 0.55;
    makeNest(s, a, spec, nx, a.y + 2);
  }
  return true;
}

/**
 * Garde du nid : il reste près des œufs (debout ou couché dessus), file manger ou boire quand
 * c'est urgent puis revient. Les menaces sont gérées par l'IA ordinaire et par le balayage (pillards).
 */
function guardStep(k: NestKit, s: GameState, a: Animal, spec: Species, nest: Nest, hab: string, dt: number): boolean {
  if (a.task !== "wander") return false;
  a.mood = "nest";
  const urgent = a.hunger > 0.7 || a.thirst > 0.7 || a.energy < 0.12;
  if (urgent) {
    if (hab === "air") return false;
    k.decide(s, a, spec);
    return true;
  }
  const sx = nest.x - a.side * (spec.halfLen * 0.55 + 12), sy = nest.y + 3;
  const far = Math.hypot(sx - a.x, sy - a.y);
  if (far > 40) a.vt = 1;
  else if (far < 14) a.vt = 0;
  if (a.vt) {
    if (k.go(s, a, spec, sx, sy, spec.walkSpeed * (far > 300 ? 1.3 : 1), dt, true) < 0) a.vt = 0;
    return true;
  }
  // Sur place : il couve (rest) ou monte la garde (idle), en alternance.
  k.face(a, nest.x);
  a.timer -= dt;
  if (a.timer <= 0) {
    a.timer = 5 + Math.random() * 10;
    k.act(a, Math.random() < 0.55 ? "rest" : "idle");
  }
  if (a.action === "rest") a.energy = Math.min(1, a.energy + dt / 30);
  else if (a.action !== "idle") k.act(a, "idle");
  return true;
}

/** Pillage : rejoindre le nid, gober un œuf toutes les quelques secondes, puis repartir. */
function raidStep(k: NestKit, s: GameState, a: Animal, spec: Species, r: Raid, dt: number): boolean {
  const n = r.nest;
  if (a.task !== "feed") { raids.delete(a); return false; }
  const end = () => { raids.delete(a); k.setTask(a, "wander"); a.cool = 90; a.timer = 1; };
  if (!s.park.nests.includes(n) || n.eggs <= 0 || n.hatched !== undefined) { end(); return true; }
  a.mood = "scavenge";
  if (a.action !== "eat") {
    if (a.spot !== -2) { a.spot = -2; if (!k.approach(s, a, spec, n.x, n.y, a.x < n.x ? 1 : -1)) { end(); return true; } }
    if (!k.reach(s, a, spec, spec.walkSpeed * 1.1, dt)) { if (a.timer > a.chase) end(); return true; }
    k.face(a, n.x);
    k.act(a, "eat");
    r.t = 0;
  }
  r.t += dt;
  if (r.t >= STEAL_EVERY) {
    r.t = 0;
    n.eggs--; r.got++;
    a.hunger = Math.max(0, a.hunger - 0.3);
    lifeStats.stolen++;
    if (r.got === 1) {
      const ns = SPECIES[n.sp];
      toast(s, "Pilleur de nid", `Un ${spec.name} gobe un œuf dans un nid ${ns && vowel(ns.name) ? "d'" : "de "}${ns?.name ?? n.sp} !`);
    }
    if (r.got >= 2 || a.hunger < 0.25 || n.eggs <= 0) end();
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tortue de mer : ponte sur la plage
// ---------------------------------------------------------------------------

/**
 * Archelon : la femelle qui doit pondre nage jusqu'à la côte, rampe sur la plage (« land »), creuse
 * et pond (« takeoff »), puis regagne le large sans jamais garder son nid. Les petits qui éclosent
 * courent seuls vers la mer. Au large, c'est le cerveau de la mer (liveSea) qui joue.
 */
function turtleStep(k: NestKit, s: GameState, a: Animal, spec: Species, dt: number): boolean {
  const w = worldFor(s);
  const pl = plans.get(a);
  if (pl && !isYoung(a)) return turtleLay(k, s, a, spec, pl, dt);
  if (deepSea(w, a.sp, a.x, a.y)) {
    if (ashore.has(a)) { ashore.delete(a); if (isYoung(a)) specialStats.hatchlingsHome++; else specialStats.turtleHome++; }
    if (isYoung(a)) a.parentId = 0; // pas de parent à suivre : il vit seul au large
    return false;
  }
  if (a.task !== "wander") { if (a.task === "dead") return false; k.setTask(a, "wander", isYoung(a) ? "hatch" : "return"); }
  a.mood = isYoung(a) ? "hatch" : "return";
  toSea(k, s, a, spec, dt, isYoung(a) ? 1.6 : 1);
  return true;
}

/** Rampe (ou nage) vers l'eau profonde la plus proche, droit vers le large. Téléporté au large si coincé. */
function toSea(k: NestKit, s: GameState, a: Animal, spec: Species, dt: number, pace: number) {
  const w = worldFor(s);
  const t = (ashore.get(a) ?? 0) + dt;
  ashore.set(a, t);
  if (a.spot !== -4 || !deepSea(w, a.sp, a.tx, a.ty)) {
    a.spot = -4;
    const c = coastAt(w, a.y);
    for (let dx = 100; dx < 900; dx += 30) if (deepSea(w, a.sp, c + dx, a.y)) { a.tx = c + dx; a.ty = a.y; break; }
  }
  const r = crawl(k, s, a, spec, a.tx, a.ty, spec.walkSpeed * pace, dt);
  // Arrivé (à quelques px près) : le voilà au large.
  if (r >= 0 && r < 8) { a.x = a.tx; a.y = a.ty; a.path = null; return; }
  // Coincé (rocher, voisins) plus de 20 s au-delà du temps de trajet normal : on le remet à l'eau.
  if (r < 0 || t > 20 + Math.abs(a.tx - a.x) / spec.walkSpeed * 2) {
    if (t > 20) {
      ashore.set(a, 0);
      a.x = a.tx; a.y = a.ty; a.path = null;
      specialStats.teleports++;
    }
  }
}

/** Se déplace vers (tx, ty) ; sur le sable, l'action « land » (ramper) remplace la nage. Renvoie comme `go`. */
function crawl(k: NestKit, s: GameState, a: Animal, spec: Species, tx: number, ty: number, speed: number, dt: number): number {
  const w = worldFor(s);
  const was = a.action === "land", t0 = a.actionT;
  const land = onLand(w, a.x, a.y);
  const r = k.go(s, a, spec, tx, ty, land ? speed * 0.6 : speed, dt, true);
  if (onLand(w, a.x, a.y)) {
    // Sur le sable, toujours la pose « land » (le modèle y a son repère au sol, pas à la flottaison).
    // Ramper boucle : on garde l'avancement de l'action d'une frame à l'autre (figé à l'arrêt).
    a.action = "land";
    a.actionT = !was ? 0 : !k.moved() ? t0 : t0 < 0.999 ? t0 : 0;
  }
  return r;
}

/** Femelle en route pour pondre : rejoindre le site, creuser, pondre, puis le retour (turtleStep). */
function turtleLay(k: NestKit, s: GameState, a: Animal, spec: Species, pl: Plan, dt: number): boolean {
  if (a.task === "attack" || a.task === "feed" || a.task === "dead") return false;
  if (a.task !== "wander") k.setTask(a, "wander", "nest");
  a.mood = "nest";
  const w = worldFor(s);
  const d = Math.hypot(pl.x - a.x, pl.y - a.y);
  if (d > 14 && pl.t === 0) {
    const r = crawl(k, s, a, spec, pl.x, pl.y, spec.walkSpeed, dt);
    // Bloqué sur le sable : elle pond là où elle est ; encore dans l'eau : elle cherche un autre coin de plage.
    if (r < 0) {
      if (onLand(w, a.x, a.y)) { pl.x = a.x; pl.y = a.y; }
      else { const q = beachSite(s, a.sp, a.y, s.park.nests); if (q) { pl.x = q.x; pl.y = q.y; } }
    }
    return true;
  }
  // Creuse le sable avec ses nageoires et pond (action « takeoff », en boucle).
  pl.t += dt;
  if (a.action !== "takeoff" || a.actionT >= 0.999) { a.action = "takeoff"; a.actionT = 0; }
  if (pl.t >= BUILD * 1.6) {
    plans.delete(a);
    const nx = a.x - a.facing * spec.halfLen * 0.5;
    makeNest(s, a, spec, onLand(w, nx, a.y + 2) ? nx : a.x, a.y + 2, false);
    specialStats.turtleNests++;
    a.spot = -1;
    ashore.set(a, 0);
    k.setTask(a, "wander", "return");
  }
  return true;
}

/**
 * Petits : ils suivent leur parent de près (place derrière lui), copient ce qu'il fait (manger,
 * boire, dormir). Bébé ptérosaure : il reste au sol ; juvénile ptérosaure : il vole seul.
 * Petit mosasaure : il nage contre sa mère.
 */
function youngStep(k: NestKit, s: GameState, a: Animal, spec: Species, hab: string, dt: number): boolean {
  if (hab === "air" && !isBaby(spec, a)) return false;
  if (hab === "land" && a.task !== "wander") return false;
  const par = a.parentId ? k.get(a.parentId) : undefined;
  if (!par || par.task === "dead") {
    if (hab !== "air") return false;
    // Bébé ptérosaure orphelin : il attend au sol, sans s'envoler.
    a.alt = 0; a.mood = "wander"; k.act(a, "idle");
    return true;
  }
  a.mood = "young";
  if (hab === "air") { a.alt = 0; if (a.task !== "wander") k.setTask(a, "wander", "young"); }
  // Parent en vol : le bébé l'attend sur place.
  if (par.alt > 0 || par.mood === "fly") { k.act(a, a.energy < 0.5 ? "rest" : "idle"); a.energy = Math.min(1, a.energy + dt / 40); return true; }
  const ps = SPECIES[par.sp] ?? spec;
  const d = Math.hypot(par.x - a.x, par.y - a.y);
  // Le parent mange, boit ou dort tout près : le petit fait pareil.
  if (d < ps.halfLen * 1.6 + 40 && (par.action === "eat" || par.action === "drink" || par.action === "rest") && par.moving < 0.3) {
    k.act(a, par.action);
    if (par.action === "eat") a.hunger = Math.max(0, a.hunger - dt / 9);
    else if (par.action === "drink") a.thirst = Math.max(0, a.thirst - dt / 6);
    else a.energy = Math.min(1, a.energy + dt / 22);
    return true;
  }
  // Place dans la file derrière le parent (un rang en haut, un rang en bas).
  const rank = a.id % 4;
  const hn = Math.hypot(par.vx, par.vy);
  const bx = hn > 0.2 ? -par.vx / hn : -par.facing, by = hn > 0.2 ? -par.vy / hn : 0;
  const back = ps.halfLen * 0.55 * Math.max(par.growth, 0.5) + 12 + rank * 9;
  const up = rank % 2 ? 1 : -1;
  let tx = par.x + bx * back - by * up * 12, ty = par.y + by * back * 0.5 + bx * up * (12 + rank * 4);
  if (!k.canStand(s, a.sp, tx, ty)) {
    // Place dans l'eau ou un bosquet : la case libre la plus proche, mais pas sur l'autre rive
    // (trop loin du parent) ; sinon de l'autre côté du parent, sinon contre lui.
    const f = nearestFree(worldFor(s), a.sp, tx, ty, 6);
    const mx = 2 * par.x - tx, my = 2 * par.y - ty;
    if (f && Math.hypot(f.x - par.x, f.y - par.y) < back + 60) { tx = f.x; ty = f.y; }
    else if (k.canStand(s, a.sp, mx, my)) { tx = mx; ty = my; }
    else { tx = par.x; ty = par.y; }
  }
  const far = Math.hypot(tx - a.x, ty - a.y);
  // Après un blocage (go() < 0 met a.blocked à 2), le petit attend un peu avant de réessayer.
  if (far > 36 && a.blocked < 1) a.vt = 1;
  else if (far < 12) a.vt = 0;
  if (a.vt) {
    const v = spec.walkSpeed * (far > 250 ? 1.8 : far > 90 ? 1.25 : 0.95);
    if (k.go(s, a, spec, tx, ty, Math.min(v, spec.runSpeed), dt) < 0) a.vt = 0;
  } else {
    k.act(a, "idle");
    a.blocked = Math.max(0, a.blocked - dt * 0.4);
    if (par.moving < 0.2) k.face(a, a.x + par.facing);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pas du cycle de vie
// ---------------------------------------------------------------------------

/** Reproducteurs candidats (réutilisé : pas d'allocation à chaque balayage). */
const elig: Animal[] = [];

/** Peut se reproduire maintenant ? */
function canBreed(spec: Species, a: Animal): boolean {
  if (a.task === "dead" || a.breedCool > 0 || a.nestId || isYoung(a) || plans.has(a) || pregnant.has(a) || raids.has(a)) return false;
  // Adulte, ou au début de la vieillesse (un couple de solitaires a rarement le même âge).
  // Les grands carnivores et les nageurs ont presque toujours faim (proies rares) : la faim ne les retient pas.
  const st = stageOf(spec, a.life);
  if ((st !== "adult" && (st !== "old" || a.age > 0.75)) || (a.hunger >= 0.5 && spec.behavior.diet !== "carnivore" && spec.habitat !== "sea") || a.energy <= 0.25) return false;
  return calm(a) || (spec.habitat === "air" && a.task !== "flee");
}

/**
 * Pas de petits sans nourriture, à chaque maillon de la chaîne alimentaire : un brouteur au sol a besoin
 * d'un pâturage autour de lui (la végétation vivante), un nageur d'au moins une nuée de plancton, un
 * chasseur d'assez de proies dans la réserve (3 par chasseur de son espèce). Les populations suivent
 * ainsi leur nourriture (proies et prédateurs oscillent, comme dans la nature) sans déborder.
 * Le dernier couple d'une espèce se reproduit toujours : la réserve ne perd jamais une espèce.
 */
function fedEnough(s: GameState, spec: Species, a: Animal): boolean {
  // Un troupeau en migration ne niche pas en route : il attend d'être arrivé dans sa zone de saison.
  if (spec.migration && !migrationArrived(s, spec.id, a.x, a.y)) return false;
  const eco = s.park.eco;
  const n = living(s, spec.id);
  if (!eco || n <= 2) return true;
  if (spec.habitat === "sea") return mass(eco.plankton) > 35;
  const B = spec.behavior;
  // Dans la neige et les dunes, la végétation est clairsemée (lichens, croûte) : le seuil s'y adapte.
  if (B.diet !== "carnivore" && (B.browse === "low" || B.browse === "both")) {
    const w = worldFor(s), b = w.biome[Math.floor(a.y / CELL_H) * w.cols + Math.floor(a.x / CELL_W)];
    return meanAround(eco.veg, a.x, a.y, 400) > (b === BIOME.Tundra || b === BIOME.Desert ? 0.12 : 0.3);
  }
  if (B.prey.length) {
    let prey = 0;
    for (const o of s.park.animals) if (o.task !== "dead" && B.prey.includes(o.sp)) prey++;
    return prey >= 3 * n;
  }
  return true;
}

/** Individus actuels + attendus (œufs, chantiers, gestations) d'une espèce. */
function family(s: GameState, sp: SpeciesId): number {
  let n = 0;
  for (const o of s.park.animals) {
    if (o.sp !== sp || o.task === "dead") continue;
    n++;
    if (plans.has(o)) n += CLUTCH[0];
    if (pregnant.has(o)) n++;
  }
  for (const q of s.park.nests) if (q.sp === sp && q.hatched === undefined) n += q.eggs;
  return n;
}

function breedScan(s: GameState, k: NestKit) {
  const seen = new Set<SpeciesId>();
  for (const a0 of s.park.animals) {
    if (seen.has(a0.sp)) continue;
    seen.add(a0.sp);
    const spec = SPECIES[a0.sp];
    if (!spec) continue;
    elig.length = 0;
    for (const o of s.park.animals) if (o.sp === a0.sp && canBreed(spec, o) && fedEnough(s, spec, o)) elig.push(o);
    if (elig.length < 2 || family(s, a0.sp) >= capOf(spec)) continue;
    const hab = spec.habitat ?? "land";
    // Volants et nageurs se retrouvent de loin (vol, chants sous l'eau) : pas besoin d'être voisins.
    const near = hab === "land" ? 400 : 1e9;
    let pa: Animal | undefined, pb: Animal | undefined, bd = Infinity;
    for (let i = 0; i < elig.length; i++) for (let j = i + 1; j < elig.length; j++) {
      const d = d2(elig[i], elig[j]);
      if (d < bd) { bd = d; pa = elig[i]; pb = elig[j]; }
    }
    if (!pa || !pb) continue;
    if (bd > near) {
      // Trop loin l'un de l'autre : parade, ils se rejoignent (solitaires surtout).
      if (bd < 4000 && !courting.has(pa) && !courting.has(pb) && pa.task === "wander" && pb.task === "wander") {
        courting.set(pa, { mate: pb, ttl: 80 }); courting.set(pb, { mate: pa, ttl: 80 });
      }
      continue;
    }
    courting.delete(pa); courting.delete(pb);
    pa.breedCool = pb.breedCool = BREED_COOLDOWN * (0.85 + Math.random() * 0.3);
    // Le bâtisseur : celui qui est au sol (ptérosaure), sinon le premier.
    const mother = hab === "air" && !grounded(pa) && grounded(pb) ? pb : pa;
    // Espèces vivipares (mosasaure...) : gestation, puis un petit naît à côté de sa mère.
    if (liveBirth(SPECIES[a0.sp])) { pregnant.set(mother, PREGNANCY); mother.gestation = 0.001; continue; }
    // Tortue et ptérosaures pêcheurs : sur la plage, au-dessus de la ligne d'eau.
    const site = beachNester(mother.sp) ? beachSite(s, mother.sp, mother.y, s.park.nests) : nestSite(s, mother, hab === "air");
    if (!site) { mother.breedCool = 60; continue; }
    plans.set(mother, { x: site.x, y: site.y, t: 0, ttl: mother.sp === "archelon" ? 240 : 150 });
    if (mother.sp === "archelon") specialStats.beachTrips++;
    if (grounded(mother) && mother.task !== "rest" && mother.task !== "drink") k.setTask(mother, "wander", "nest");
  }
}

/** Pillards : un carnivore terrestre affamé tente parfois un nid mal gardé ; le gardien réagit. */
function raidScan(s: GameState, k: NestKit) {
  const nests = s.park.nests;
  if (!nests.length) return;
  for (const a of s.park.animals) {
    const spec = SPECIES[a.sp];
    if (!spec || a.task === "dead") continue;
    // Pillard en approche : le gardien défend le nid (ou donne l'alerte).
    const r = raids.get(a);
    if (r) {
      const g = r.nest.guard ? k.get(r.nest.guard) : undefined;
      if (!g || g.task === "dead" || d2(a, r.nest) > 260 || d2(g, r.nest) > 420 || !calm(g)) continue;
      const gs = SPECIES[g.sp];
      if (!gs) continue;
      if (gs.behavior.defense !== "flee") { k.setTask(g, "defend", "defend"); k.act(g, "defend"); g.targetId = a.id; g.cool = 0.4; }
      else {
        k.setTask(g, "call", "nest"); k.act(g, "call");
        let mob = 0;
        for (const o of s.park.animals) if (o !== g && o.sp === g.sp && o.task !== "dead" && !isYoung(o) && d2(o, r.nest) < 450) mob++;
        // Le troupeau accourt au cri : le pillard renonce souvent.
        if (mob >= 2 && Math.random() < 0.5) {
          raids.delete(a);
          k.setTask(a, "retreat", "wander");
          a.tx = a.x + (a.x > r.nest.x ? 300 : -300); a.ty = a.y; a.timer = 6; a.cool = 60;
        }
      }
      continue;
    }
    // Le Pectinodon, petit rôdeur nocturne, pille bien plus souvent (même en pleine chasse).
    const sneak = a.sp === "pectinodon";
    if ((spec.habitat ?? "land") !== "land" || spec.behavior.diet !== "carnivore" || (a.task !== "wander" && !(sneak && a.task === "graze"))
      || a.hunger < (sneak ? 0.3 : 0.6) || a.cool > 0 || a.nestId || isBaby(spec, a)) continue;
    if (Math.random() > (sneak ? 0.3 : 0.04)) continue; // rare
    let best: Nest | undefined, bd = spec.behavior.sight * (sneak ? 3.5 : 2);
    for (const n of nests) {
      if (n.sp === a.sp || n.eggs <= 0 || n.hatched !== undefined) continue;
      const d = d2(a, n);
      if (d >= bd) continue;
      const g = n.guard ? k.get(n.guard) : undefined;
      if (g && g.task !== "dead" && d2(g, n) < 260) continue; // bien gardé
      bd = d; best = n;
    }
    if (!best) continue;
    k.setTask(a, "feed", "scavenge");
    a.targetId = 0; a.spot = -1;
    raids.set(a, { nest: best, t: 0, got: 0 });
  }
}

/** Petits sans parent : le parent vivant, sinon l'adulte le plus proche, sinon l'aîné de la fratrie. */
function parentScan(s: GameState, k: NestKit) {
  for (const a of s.park.animals) {
    if (a.task === "dead" || !isYoung(a) || a.sp === "archelon") continue;
    const par = a.parentId ? k.get(a.parentId) : undefined;
    if (par && par.task !== "dead" && !isYoung(par)) continue;
    const ad = nearestAdult(s, a.sp, a.x, a.y, Infinity, a);
    if (ad) { a.parentId = ad.id; continue; }
    if (par && par.task !== "dead") continue;
    // Pas d'adulte : la fratrie reste groupée derrière l'aîné (le plus petit id).
    let eldest: Animal | undefined;
    for (const o of s.park.animals) if (o.sp === a.sp && o.task !== "dead" && o !== a && (!eldest || o.id < eldest.id)) eldest = o;
    a.parentId = eldest && eldest.id < a.id ? eldest.id : 0;
  }
}

/**
 * Un pas du cycle de vie : âge, croissance, mort de vieillesse, gestations, incubation et éclosion,
 * puis (toutes les secondes) parents des petits, reproduction et pillage des nids.
 */
export function stepLife(s: GameState, dt: number, k: NestKit): void {
  const p = s.park;
  for (const a of p.animals) {
    if (a.task === "dead") continue;
    const spec = SPECIES[a.sp];
    if (!spec) continue;
    const L = lifespan(spec);
    a.life += dt;
    a.growth = growthOf(spec, a.life);
    const u = a.life / L;
    // Vulnérabilité : nulle à l'âge adulte, monte pendant la vieillesse (les petits sont faibles par leur taille).
    a.age = u < STAGE_AT.old ? 0 : Math.min(1, (u - STAGE_AT.old) / (1 - STAGE_AT.old));
    a.breedCool = Math.max(0, a.breedCool - dt);
    if (a.parentId && a.growth >= 0.999) a.parentId = 0;
    const pl = plans.get(a);
    if (pl && (pl.ttl -= dt) <= 0) { plans.delete(a); a.breedCool = 60; }
    const g = pregnant.get(a);
    if (g !== undefined) {
      if (g - dt <= 0) { pregnant.delete(a); a.gestation = 0; giveBirth(s, a, spec); }
      else { pregnant.set(a, g - dt); a.gestation = 1 - (g - dt) / PREGNANCY; }
    }
    if (a.life >= L) dieOld(s, a, spec);
  }
  // Nids : incubation, éclosion, coquilles vides, gardien disparu.
  let gone = false;
  for (const n of p.nests) {
    if (n.guard) {
      const g = k.get(n.guard);
      if (!g || g.task === "dead") { n.guard = 0; if (g) g.nestId = 0; }
    }
    if (n.hatched !== undefined) { n.hatched -= dt; if (n.hatched <= 0) gone = true; continue; }
    if (n.eggs <= 0) {
      // Tous les œufs volés : le nid est abandonné.
      const g = n.guard ? k.get(n.guard) : undefined;
      if (g) g.nestId = 0;
      n.guard = 0; n.hatched = 0; gone = true;
      continue;
    }
    n.t += dt;
    if (n.t >= INCUBATION) hatch(s, n);
  }
  if (gone) {
    p.nests = p.nests.filter((n) => n.hatched === undefined || n.hatched > 0);
    if (p.nestSel !== undefined && !p.nests.some((n) => n.id === p.nestSel)) p.nestSel = undefined;
  }
  scanT -= dt;
  if (scanT > 0) return;
  scanT = 1;
  parentScan(s, k);
  breedScan(s, k);
  raidScan(s, k);
}

/**
 * Test (dev) : fait apparaître un couple d'adultes prêts à se reproduire, près de (x, y).
 * Espèce : `sp` si elle a encore de la place, sinon celle qui en a le plus. Renvoie la mère, ou null.
 */
export function addTestCouple(s: GameState, x: number, y: number, sp?: SpeciesId): Animal | null {
  const room = (id: SpeciesId) => { const spec = SPECIES[id]; return spec ? capOf(spec) - family(s, id) : -1; };
  let pick = sp && room(sp) >= 3 ? sp : undefined;
  if (!pick) {
    let best = 2;
    for (const id of s.progress.assembled) if (room(id) > best) { best = room(id); pick = id; }
  }
  const spec = pick ? SPECIES[pick] : undefined;
  if (!pick || !spec) return null;
  const w = worldFor(s);
  // Les nageurs apparaissent au large, pas dans un étang.
  if (spec.habitat === "sea") { x = w.seaX + 700; y = Math.max(300, Math.min(y, w.rows * CELL_H - 300)); }
  const life = lifespan(spec) * (STAGE_AT.adult + 0.1);
  const pair: Animal[] = [];
  for (let k = 0; k < 400 && pair.length < 2; k++) {
    const r = 40 + k * 4, a = k * 2.4;
    const px = (pair[0]?.x ?? x) + Math.cos(a) * r * (pair.length ? 0.5 : 1), py = (pair[0]?.y ?? y) + Math.sin(a) * r * 0.5;
    if (!standable(w, pick, px, py)) continue;
    const an = makeAnimal(s, pick, px, py, life); // l'ajoute déjà à la réserve
    an.breedCool = 0; an.hunger = 0.05; an.thirst = 0.05; an.energy = 1;
    pair.push(an);
  }
  if (pair.length < 2) { s.park.animals = s.park.animals.filter((a) => !pair.includes(a)); return null; }
  s.progress.population[pick] = (s.progress.population[pick] ?? 0) + 2;
  saveProgress(s.progress);
  scanT = 0; // la reproduction est examinée tout de suite
  return pair[0];
}
