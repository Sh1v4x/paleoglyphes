import { isNight } from "../daycycle";
import { CELL_H, CELL_W, WORLD_H } from "../config";
import type { Species, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import type { World } from "../world/generate";
import { isWater, T } from "../world/tiles";
import type { NestKit } from "./eco-nest";
import type { WildKit } from "./eco-wild";
import { coastAt, nearestFree, standable } from "./nav";
import type { Animal, Nest } from "./park";

/**
 * Comportements propres à quelques espèces : Pectinodon nocturne (dort le jour en forêt, chasse la
 * nuit), poissons (Xiphactinus : frai, bonds hors de l'eau), pêcheurs des mers (Pteranodon,
 * Nyctosaurus), proies supplémentaires (jeunes sauropodes) et sites de ponte sur la plage.
 */

/** Poissons de la réserve : « fraie » plutôt que « met bas ». */
const FISH: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["xiphactinus"]);
export const isFish = (spec: Species | undefined) => !!spec && FISH.has(spec.id);

/** Ptérosaures pêcheurs : ils patrouillent au-dessus de la mer et plongent sur les poissons. */
const FISHERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["pteranodon", "nyctosaurus"]);
export const isFisher = (sp: SpeciesId) => FISHERS.has(sp);
/** Nyctosaurus (sans griffes aux ailes) : se repose en planant, ne se pose presque jamais. */
export const glider = (sp: SpeciesId) => sp === "nyctosaurus";

/** Pondeurs de plage : la tortue de mer et les ptérosaures pêcheurs nichent sur le sable, près de la côte. */
export const beachNester = (sp: SpeciesId) => sp === "archelon" || FISHERS.has(sp);

/**
 * Proies en plus de la liste de l'espèce : les grands carnivores s'attaquent aux jeunes sauropodes
 * (les adultes sont trop gros, voir `preyFits`).
 */
const EXTRA_PREY: Partial<Record<SpeciesId, readonly SpeciesId[]>> = { trex: ["alamosaurus"], allosaurus: ["alamosaurus"] };
export const huntsSp = (pred: Species, sp: SpeciesId) => pred.behavior.prey.includes(sp) || !!EXTRA_PREY[pred.id]?.includes(sp);
/** La proie n'est-elle pas trop grosse pour le prédateur ? (corps au plus 1,3 fois plus long) */
export const preyFits = (pred: Species, pa: Animal, prey: Species, pb: Animal) => prey.halfLen * pb.growth <= pred.halfLen * pa.growth * 1.3;

/** Compteurs pour la simulation (scripts/sim-park.ts). */
export const specialStats = {
  /** Mesures du Pectinodon : nuit active, nuit au repos, jour au repos, jour actif. */
  nightActive: 0, nightRest: 0, dayRest: 0, dayActive: 0,
  dives: 0, catches: 0, beachLandings: 0,
  beachTrips: 0, turtleNests: 0, turtleHome: 0, teleports: 0, hatchlingsHome: 0,
  leaps: 0, seaChases: 0, seaKills: 0,
};

const cellAt = (w: World, x: number, y: number) => Math.floor(y / CELL_H) * w.cols + Math.floor(x / CELL_W);
export const onLand = (w: World, x: number, y: number) => !isWater(w.terrain[cellAt(w, x, y)]);
export const deepAt = (w: World, x: number, y: number) => w.terrain[cellAt(w, x, y)] === T.Deep;

/**
 * Site de ponte sur la plage : terre ferme au-dessus de la ligne d'eau, entre 40 et 220 px de la
 * côte, praticable pour l'espèce, loin des autres nids. Cherché le long de la côte autour de y.
 */
export function beachSite(s: GameState, sp: SpeciesId, y0: number, nests: Nest[]): { x: number; y: number } | null {
  const w = worldFor(s);
  for (let n = 0; n < 60; n++) {
    const y = Math.max(160, Math.min(WORLD_H - 120, y0 + (Math.random() - 0.5) * (n < 30 ? 700 : 1800)));
    const x = coastAt(w, y) - 40 - Math.random() * 180;
    if (!onLand(w, x, y) || !onLand(w, x + 30, y) || !standable(w, sp, x, y)) continue;
    let ok = true;
    for (const o of nests) if (Math.hypot(o.x - x, o.y - y) < 160) { ok = false; break; }
    if (ok) return { x, y };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pectinodon : nocturne
// ---------------------------------------------------------------------------

/** Cachette pour la journée : au pied d'un arbre debout, près de l'animal. */
function den(w: World, a: Animal): { x: number; y: number } | null {
  let best: { x: number; y: number } | undefined, bd = 1100;
  for (const t of w.trees) {
    if (t.state !== "up") continue;
    const d = Math.hypot(t.x - a.x, (t.y - a.y) * 1.3);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return null;
  return nearestFree(w, a.sp, best.x + (a.id % 2 ? 26 : -26), best.y + 8, 6);
}

/** Terrain de chasse nocturne : une berge (point d'eau) ou une lisière, pas trop loin. */
function prowlSpot(k: WildKit, s: GameState, a: Animal) {
  const w = worldFor(s);
  const water = k.water();
  for (let n = 0; n < 10; n++) {
    let tx: number, ty: number;
    if (water.length && Math.random() < 0.6) {
      const q = water[Math.floor(Math.random() * water.length)];
      if (Math.hypot(q.x - a.x, q.y - a.y) > 1400 && n < 6) continue;
      tx = q.x + (Math.random() - 0.5) * 160; ty = q.y - 20 - Math.random() * 60;
    } else {
      tx = a.x + (Math.random() - 0.5) * 700; ty = a.y + (Math.random() - 0.5) * 350;
    }
    if (k.canStand(s, a.sp, tx, ty)) { a.tx = tx; a.ty = ty; return; }
  }
  const f = nearestFree(w, a.sp, a.x + (Math.random() - 0.5) * 300, a.y, 8);
  if (f) { a.tx = f.x; a.ty = f.y; }
}

/**
 * Pectinodon : la nuit, il rôde le long des berges et des lisières et happe de petites proies
 * (tâche « graze », humeur « hunt ») ; le jour, il dort caché au pied d'un arbre (tâche « rest »,
 * humeur « den »). Fuite, défense, boisson, carcasses et pillage de nids restent à l'IA ordinaire.
 * Renvoie true si l'animal a été pris en charge pour ce pas.
 */
export function liveNight(k: NestKit, s: GameState, a: Animal, spec: Species, dt: number, done: boolean): boolean {
  const t = a.task;
  if (t !== "wander" && t !== "graze" && t !== "rest") return false;
  const night = isNight(s.clock);
  if (!night) {
    // Très soif : il file boire (ou manger une carcasse), puis retourne se cacher.
    if (a.thirst > (t === "rest" ? 0.85 : 0.75)) {
      k.decide(s, a, spec);
      if (a.task === "drink" || a.task === "feed") return true;
    }
    if (t !== "rest" || a.mood !== "den") {
      k.setTask(a, "rest", "den");
      const d = den(worldFor(s), a);
      a.tx = d?.x ?? a.x; a.ty = d?.y ?? a.y;
      a.vt = 1;
    }
    if (a.vt) {
      const d = k.go(s, a, spec, a.tx, a.ty, spec.walkSpeed * 1.3, dt, true);
      if (d < 0 || d < 10) a.vt = 0;
      return true;
    }
    k.act(a, "rest");
    a.energy = Math.min(1, a.energy + dt / 22);
    return true;
  }
  // La nuit : réveil, puis la chasse.
  if (t === "rest") {
    if (a.mood !== "den" && a.energy < 0.3) return false; // épuisé : il dort un peu (IA ordinaire)
    k.setTask(a, "graze", "hunt");
    prowlSpot(k, s, a);
    return true;
  }
  if (t === "wander") {
    if (a.thirst > 0.6 || a.energy < 0.08) return false;
    k.setTask(a, "graze", "hunt");
    prowlSpot(k, s, a);
    return true;
  }
  // Chasse : quelques pas silencieux, arrêt, coup de museau, il avale.
  a.mood = "hunt";
  if (a.action === "attack") {
    if (done) {
      if (Math.random() < 0.55 && a.hunger > 0.05) { k.act(a, "eat"); a.timer = 2.5; } else k.act(a, "idle");
    }
    return true;
  }
  if (a.action === "eat") {
    a.hunger = Math.max(0, a.hunger - dt / 8);
    a.timer -= dt;
    if (a.timer <= 0) k.act(a, "idle");
    return true;
  }
  // Besoins pressants : l'IA ordinaire reprend la main (boire, dormir).
  if (a.thirst > 0.6 || a.energy < 0.08) { k.setTask(a, "wander"); a.timer = 0; return false; }
  // Très faim : il tente une plus grosse proie (jeune Pachycephalosaurus, carcasse) avec l'IA ordinaire.
  if (a.hunger > 0.55 && a.cool <= 0 && Math.random() < dt * 0.2) { k.decide(s, a, spec); if (a.task !== "graze") return true; }
  if (Math.random() < dt * (a.hunger > 0.2 ? 0.3 : 0.08)) { k.act(a, "attack"); return true; }
  const d = k.go(s, a, spec, a.tx, a.ty, spec.walkSpeed * 1.2, dt, true);
  if (d < 0 || d < 10) prowlSpot(k, s, a);
  return true;
}
