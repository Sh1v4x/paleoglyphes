import { WORLD_H, WORLD_W } from "../config";
import { addAt, densest } from "../features/lenia";
import { SPECIES } from "../species";
import type { Species, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { deepAt, glider, isFish, isFisher, onLand, specialStats } from "./eco-special";
import { coastAt, deepSea } from "./nav";
import type { Animal } from "./park";

/**
 * Milieux particuliers de la réserve : la mer (mosasaure, poissons, tortue) et les airs (ptérosaures).
 * Les briques de déplacement (go, reach, approach...) sont fournies par ecosystem.ts.
 */

export interface WildKit {
  get(id: number): Animal | undefined;
  go(s: GameState, a: Animal, spec: Species, tx: number, ty: number, speed: number, dt: number, plan?: boolean): number;
  reach(s: GameState, a: Animal, spec: Species, speed: number, dt: number): boolean;
  approach(s: GameState, a: Animal, spec: Species, x: number, y: number, side: number): boolean;
  canStand(s: GameState, sp: Animal["sp"], x: number, y: number): boolean;
  act(a: Animal, action: Animal["action"]): void;
  setTask(a: Animal, t: Animal["task"], mood?: string): void;
  face(a: Animal, x: number): void;
  water(): { x: number; y: number }[];
  pickWater(a: Animal): number;
  waterSide(s: GameState, x: number, y: number): number;
  /** Un prédateur terrestre est-il à moins de `range` px ? */
  threat(a: Animal, range: number): boolean;
  /** L'animal a-t-il bougé pendant ce pas ? */
  moved(): boolean;
  /** Le prédateur tue sa proie (carcasse, toast, compteurs). */
  kill(s: GameState, pred: Animal, prey: Animal): void;
  /** Individus vivants de l'espèce (on ne fait jamais disparaître une espèce). */
  count(sp: SpeciesId): number;
}

/** En vol, l'ombre reste assez loin du bord nord pour que l'animal (dessiné plus haut) reste visible. */
const SKY_TOP = 520;

/** Point du large (eau profonde : la plage de la tortue n'en fait pas partie). */
function seaPoint(s: GameState, a: Animal, r: number): boolean {
  const w = worldFor(s);
  for (let n = 0; n < 16; n++) {
    const tx = a.x + (Math.random() - 0.5) * r * 2, ty = a.y + (Math.random() - 0.5) * r;
    if (deepSea(w, a.sp, tx, ty)) { a.tx = tx; a.ty = ty; return true; }
  }
  return false;
}

/**
 * La nuée de plancton la plus dense à portée : poissons, méduses et tortues s'y rassemblent, et les
 * chasseurs les y suivent. Faute de nuée, la chasse part au hasard (seaPoint).
 */
function bloomPoint(s: GameState, a: Animal): boolean {
  const pl = s.park.eco?.plankton;
  const b = pl && densest(pl, a.x, a.y, 1500);
  if (!b || !deepSea(worldFor(s), a.sp, b.x, b.y)) return false;
  a.tx = b.x; a.ty = b.y;
  return true;
}

/** Proies des grands nageurs : poissons et tortues du large (rarement attrapés adultes). */
const SEA_PREY: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["xiphactinus", "archelon"]);

/** Le mosasaure affamé repère un Xiphactinus ou une Archelon au large, à portée de vue. */
function seaPrey(s: GameState, a: Animal, spec: Species): Animal | undefined {
  const w = worldFor(s);
  let best: Animal | undefined, bd = spec.behavior.sight;
  for (const o of s.park.animals) {
    if (o.task === "dead" || !SEA_PREY.has(o.sp) || !deepSea(w, o.sp, o.x, o.y)) continue;
    // Les jeunes sont repérés de plus loin (proies plus faciles).
    const d = Math.hypot(o.x - a.x, o.y - a.y) - (1 - o.growth) * 200;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/**
 * Mosasaure : patrouille au large, chasse les bancs de poissons (accélération, attaque, il avale),
 * remonte respirer en surface (cri), dérive pour se reposer. Il ne quitte jamais l'eau profonde.
 */
export function liveSea(k: WildKit, s: GameState, a: Animal, spec: Species, dt: number, done: boolean) {
  a.hunger = Math.min(1, a.hunger + dt / 150);
  a.thirst = 0;
  if (a.task === "rest") a.energy = Math.min(1, a.energy + dt / 25);
  else a.energy = Math.max(0, a.energy - dt / (a.action === "run" ? 60 : 400));
  a.timer -= dt;
  switch (a.task) {
    case "hunt": {
      a.mood = "hunt";
      const d = k.go(s, a, spec, a.tx, a.ty, spec.runSpeed, dt, true);
      if (d >= 0 && d < 30) { k.setTask(a, "attack", "hunt"); k.act(a, "attack"); }
      else if (d < 0 || a.timer < -12) k.setTask(a, "wander");
      break;
    }
    case "chase": {
      // Le mosasaure poursuit un nageur (Xiphactinus, Archelon) : sprint, puis un coup de mâchoires.
      a.mood = "hunt";
      const prey = k.get(a.targetId);
      if (!prey || prey.task === "dead" || !deepSea(worldFor(s), prey.sp, prey.x, prey.y) || a.timer < -10) { k.setTask(a, "wander"); a.timer = 2; break; }
      const ps = SPECIES[prey.sp];
      const range = (spec.halfLen + (ps?.halfLen ?? 40) * prey.growth) * 0.45;
      const d = k.go(s, a, spec, prey.x - a.facing * range * 0.3, prey.y, spec.runSpeed, dt);
      if (d < 0) { k.setTask(a, "wander"); a.timer = 3; break; }
      if (Math.hypot(prey.x - a.x, prey.y - a.y) < range) { a.task = "attack"; k.act(a, "attack"); k.face(a, prey.x); }
      break;
    }
    case "attack":
      k.act(a, "attack");
      if (done) {
        const prey = a.targetId ? k.get(a.targetId) : undefined;
        if (prey) {
          // Un adulte s'échappe presque toujours ; un jeune beaucoup moins.
          const p = prey.growth < 0.999 ? 0.45 : 0.1;
          if (prey.task !== "dead" && Math.hypot(prey.x - a.x, prey.y - a.y) < (SPECIES[a.sp]?.halfLen ?? 100) && k.count(prey.sp) > 1 && Math.random() < p) {
            k.kill(s, a, prey);
            prey.meat = Math.min(prey.meat, 0.15); // avalé presque en entier
            specialStats.seaKills++;
            k.act(a, "eat"); a.timer = 5;
            break;
          }
          k.setTask(a, "wander"); a.timer = 3; a.targetId = 0;
          break;
        }
        k.setTask(a, "feed", "hunt"); k.act(a, "eat"); a.timer = 3;
      }
      break;
    case "feed": {
      k.act(a, "eat");
      a.hunger = Math.max(0, a.hunger - dt / 4);
      // Le festin entame la nuée (un Orbium trop entamé se disloque, une autre nuée prendra le relais).
      const pl = s.park.eco?.plankton;
      if (pl) addAt(pl, a.x, a.y, 2, -dt * 0.15);
      if (a.timer <= 0) { k.setTask(a, "wander"); a.timer = 2; }
      break;
    }
    case "rest":
      k.act(a, "rest");
      if (a.energy > 0.95) { k.setTask(a, "wander"); a.timer = 1; }
      break;
    case "call":
      // Remonte respirer : la tête sort de l'eau (le Xiphactinus, lui, bondit hors de l'eau).
      k.act(a, "call");
      if (done) { k.setTask(a, "wander"); a.timer = 2; }
      break;
    default: {
      a.mood = "wander";
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d > 20 && a.timer > -20) { if (k.go(s, a, spec, a.tx, a.ty, spec.walkSpeed, dt, true) < 0) a.timer = -99; }
      else {
        k.act(a, "idle");
        if (a.timer <= 0) {
          if (a.energy < 0.2) { k.setTask(a, "rest"); break; }
          if (a.sp === "mosa" && a.hunger > 0.5 && Math.random() < 0.35) {
            const prey = seaPrey(s, a, spec);
            if (prey) { k.setTask(a, "chase", "hunt"); a.targetId = prey.id; specialStats.seaChases++; break; }
          }
          if (a.hunger > 0.5 && (bloomPoint(s, a) || seaPoint(s, a, 900))) { k.setTask(a, "hunt", "hunt"); a.timer = 0; a.targetId = 0; break; }
          // Le poisson bondit plus souvent qu'un reptile ne remonte respirer.
          if (Math.random() < (isFish(spec) ? 0.3 : 0.15)) { k.setTask(a, "call"); k.act(a, "call"); if (isFish(spec)) specialStats.leaps++; break; }
          seaPoint(s, a, 1100);
          a.timer = 2 + Math.random() * 5;
        }
      }
    }
  }
  settle(k, a, dt);
}

/**
 * Ptérosaure : plane et bat des ailes au-dessus de la réserve et de la mer, puis se pose pour chasser
 * à pied (comme une cigogne géante), boire ou dormir, et redécolle (tout de suite si un prédateur approche).
 * Pêcheurs (Pteranodon, Nyctosaurus) : ils patrouillent au-dessus de la mer, descendent raser l'eau et
 * plongent (action « attack » en vol) pour attraper un poisson ; ils se posent sur la plage
 * (le Nyctosaurus presque jamais : il se repose en planant).
 * `a.alt` > 0 : en vol ; `a.mood === "fly"` : en vol ou en approche d'atterrissage.
 */
export function liveAir(k: WildKit, s: GameState, a: Animal, spec: Species, dt: number, done: boolean) {
  const fisher = isFisher(a.sp), glide = glider(a.sp);
  a.hunger = Math.min(1, a.hunger + dt / 220);
  // L'eau de mer ne se boit pas : les pêcheurs tirent leur eau des poissons.
  a.thirst = fisher ? 0 : Math.min(1, a.thirst + dt / 260);
  if (a.task === "rest" && a.alt === 0 && a.mood !== "fly") a.energy = Math.min(1, a.energy + dt / 22);
  else if (glide && a.alt > 0 && a.moving < 0.5) a.energy = Math.min(1, a.energy + dt / 120); // repos en vol plané
  else a.energy = Math.max(0, a.energy - dt / (a.alt > 0 ? 260 : 420));
  a.timer -= dt;

  // Envol : accroupi, poussée, puis il monte en battant des ailes.
  if (a.action === "takeoff") {
    a.mood = "fly";
    a.moving = 0;
    if (a.actionT > 0.4) a.alt += dt * 120;
    if (done) k.act(a, "fly");
    return;
  }
  // Atterrissage : il freine ailes cabrées en finissant sa descente, se pose, replie les ailes.
  if (a.action === "land") {
    a.moving = 0;
    a.alt = a.actionT > 0.45 ? 0 : Math.max(0, a.alt - dt * 110);
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (d > 1 && a.actionT < 0.45) { const v = Math.min(d, spec.walkSpeed * 1.5 * dt); a.x += (dx / d) * v; a.y += (dy / d) * v; }
    if (done) {
      a.alt = 0; a.mood = "wander";
      k.act(a, "idle");
      if (a.task !== "drink") k.setTask(a, fisher && a.energy < 0.7 ? "rest" : "wander");
      a.timer = 1 + Math.random() * 2;
    }
    return;
  }

  if (a.alt > 0 || a.mood === "fly") {
    a.mood = a.task === "hunt" || a.task === "attack" ? "fish" : "fly";
    // Plongeon du pêcheur : il pique jusqu'à raser l'eau, attrape (ou rate) un poisson, et remonte.
    if (a.task === "attack") {
      k.act(a, "attack");
      const v = spec.runSpeed * 0.45 * dt;
      a.x += a.facing * v;
      // Le modèle touche l'eau du bout du bec vers actionT 0,4-0,62 (repère de « fly ») : il rase la surface.
      const want = a.actionT < 0.6 ? 6 : 90;
      a.alt = Math.max(6, a.alt + Math.sign(want - a.alt) * Math.min(Math.abs(want - a.alt), dt * (want < a.alt ? 160 : 220)));
      a.walk += dt * spec.stride * 0.2;
      a.moving = 0;
      if (done) {
        if (Math.random() < 0.6) { a.hunger = Math.max(0, a.hunger - 0.35); specialStats.catches++; }
        k.setTask(a, "wander", "fly");
        k.act(a, "fly");
        a.timer = 3 + Math.random() * 5;
        cruisePoint(s, a, true);
      }
      return;
    }
    // « wander » = croisière, « hunt » = descente vers un poisson repéré ; toute autre tâche = il cherche à se poser à (tx, ty).
    const fishing = a.task === "hunt";
    const landing = a.task !== "wander" && !fishing;
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    const v = spec.runSpeed * (landing && d < 200 ? 0.55 : fishing ? 0.6 : 1) * dt;
    if (d > 3) {
      a.x += (dx / d) * Math.min(d, v); a.y += (dy / d) * Math.min(d, v) * 0.8;
      if (Math.abs(dx) > 4) a.facing = dx > 0 ? 1 : -1;
    }
    const cruise = (fisher ? 140 : 170) + 50 * Math.sin(s.time * 0.3 + a.phase);
    // En approche : il descend jusqu'à ~45 px, puis la séquence d'atterrissage prend le relais.
    const want = fishing ? 50 : landing && d < 160 ? 45 : cruise;
    a.alt = Math.max(0, a.alt + Math.sign(want - a.alt) * Math.min(Math.abs(want - a.alt), dt * 90));
    // Bat des ailes en montée (et de temps en temps) ; plane le reste du temps (le Nyctosaurus plane plus).
    const flap = want > a.alt + 5 || Math.sin(s.time * 0.4 + a.phase) > (glide ? 0.75 : 0.35);
    k.act(a, "fly");
    a.walk += dt * spec.stride * (flap ? 1.4 : 0.15);
    a.moving = flap ? 1 : 0;
    if (fishing) {
      if (d < 50 && a.alt < 80) { k.setTask(a, "attack", "fish"); k.act(a, "attack"); specialStats.dives++; }
      else if (d < 50) { a.tx = a.x + a.facing * 120; } // encore trop haut : il tourne et reprend sa descente
      else if (a.timer < -15) k.setTask(a, "wander", "fly");
      return;
    }
    if (landing && d <= 40 && a.alt <= 50) {
      k.act(a, "land");
      if (fisher) specialStats.beachLandings++;
    } else if (!landing && fisher && a.hunger > 0.25 && a.timer <= 0 && Math.random() < dt * 0.6 && deepAt(worldFor(s), a.x, a.y)) {
      // Un poisson repéré sous la surface : il descend le prendre.
      const tx = a.x + a.facing * (180 + Math.random() * 160), ty = a.y + (Math.random() - 0.5) * 120;
      if (tx > 150 && tx < WORLD_W - 150 && ty > SKY_TOP && deepAt(worldFor(s), tx, ty)) { k.setTask(a, "hunt", "fish"); a.tx = tx; a.ty = ty; }
    } else if (!landing && d < 40) {
      if (fisher) {
        // Pteranodon : se pose sur la plage pour se reposer ; Nyctosaurus : seulement à bout de forces.
        const tired = glide ? a.energy < 0.15 || Math.random() < 0.03 : a.energy < 0.45 || Math.random() < 0.2;
        if (a.timer <= 0 && tired && a.hunger < 0.6) pickLanding(k, s, a);
        else cruisePoint(s, a, a.hunger > 0.25 || Math.random() < 0.8);
      } else if (a.timer <= 0 && (a.hunger > 0.4 || a.energy < 0.4 || a.thirst > 0.5 || Math.random() < 0.5)) pickLanding(k, s, a);
      else {
        a.tx = 200 + Math.random() * (WORLD_W - 400);
        a.ty = SKY_TOP + Math.random() * (WORLD_H - SKY_TOP - 200);
      }
    }
    return;
  }

  // Posé au sol : un animal terrestre comme les autres, mais il redécolle au moindre danger.
  const takeOff = () => {
    k.setTask(a, "wander", "fly");
    a.alt = 0;
    k.act(a, "takeoff");
    a.timer = fisher ? 2 + Math.random() * 4 : 20 + Math.random() * 30;
    if (fisher) { cruisePoint(s, a, true); return; }
    a.tx = Math.max(200, Math.min(WORLD_W - 200, a.x + (Math.random() - 0.5) * 1600));
    a.ty = Math.max(SKY_TOP, Math.min(WORLD_H - 200, a.y + (Math.random() - 0.5) * 800));
  };
  if (k.threat(a, spec.behavior.sight * 0.45)) { takeOff(); return; }
  switch (a.task) {
    case "graze":
      // Chasse à l'affût de petites proies : quelques pas, un coup de bec, il avale.
      a.mood = "hunt";
      if (fisher) { takeOff(); break; } // les pêcheurs se nourrissent en mer
      if (a.action === "attack") { if (done) { k.act(a, "eat"); a.timer = 3; } break; }
      if (a.action === "eat") {
        a.hunger = Math.max(0, a.hunger - dt / 6);
        if (a.timer <= 0) { if (a.hunger < 0.1) k.setTask(a, "wander"); else { a.tx = a.x; a.ty = a.y; k.act(a, "idle"); } }
        break;
      }
      if (Math.random() < dt * 0.35) { k.act(a, "attack"); break; }
      if (k.go(s, a, spec, a.tx, a.ty, spec.walkSpeed, dt, true) < 8) {
        a.tx = a.x + (Math.random() - 0.5) * 220; a.ty = a.y + (Math.random() - 0.5) * 110;
      }
      break;
    case "drink": {
      const q = k.water()[a.spot];
      if (!q) { k.setTask(a, "wander"); break; }
      if (a.action !== "drink") {
        if (!k.reach(s, a, spec, spec.walkSpeed, dt)) { if (a.spot < 0) k.setTask(a, "wander"); break; }
        k.face(a, q.x); k.act(a, "drink");
      }
      a.thirst = Math.max(0, a.thirst - dt / 5);
      if (a.thirst < 0.05) k.setTask(a, "wander");
      break;
    }
    case "rest":
      k.act(a, "rest");
      if (a.energy > 0.95) k.setTask(a, "wander");
      break;
    case "call":
      k.act(a, "call");
      if (done) k.setTask(a, "wander");
      break;
    default:
      k.act(a, "idle");
      if (a.timer > 0) break;
      a.timer = fisher ? 3 + Math.random() * 5 : 2;
      if (a.energy < (fisher && !glide ? 0.6 : 0.3)) { k.setTask(a, "rest"); break; }
      if (a.thirst > 0.5 && k.water().length) {
        a.spot = k.pickWater(a);
        const q = k.water()[a.spot];
        if (q && k.approach(s, a, spec, q.x, q.y, k.waterSide(s, q.x, q.y))) { k.setTask(a, "drink"); break; }
      }
      if (fisher && (a.hunger > 0.3 || glide)) { takeOff(); break; }
      if (a.hunger > 0.3) { k.setTask(a, "graze", "hunt"); a.timer = 6; a.tx = a.x; a.ty = a.y; break; }
      if (Math.random() < 0.25) { k.setTask(a, "call"); k.act(a, "call"); break; }
      takeOff();
  }
  settle(k, a, dt);
}

/** Cap de croisière d'un pêcheur : au-dessus de la mer (`sea`), sinon le long de la côte. */
function cruisePoint(s: GameState, a: Animal, sea: boolean) {
  const w = worldFor(s);
  const ty = Math.max(SKY_TOP, Math.min(WORLD_H - 200, a.y + (Math.random() - 0.5) * 900));
  const c = coastAt(w, ty);
  a.ty = ty;
  a.tx = sea ? Math.min(WORLD_W - 150, c + 120 + Math.random() * Math.max(100, WORLD_W - 270 - c)) : c - 300 + Math.random() * 400;
}

/** Choisit où se poser : au bord de l'eau s'il a soif, sur la plage (pêcheurs), sinon un coin praticable de la réserve. */
function pickLanding(k: WildKit, s: GameState, a: Animal) {
  const thirsty = a.thirst > 0.5 && k.water().length > 0;
  const beach = isFisher(a.sp), w = worldFor(s);
  for (let n = 0; n < 40; n++) {
    let tx: number, ty: number;
    if (beach) {
      ty = Math.max(SKY_TOP, Math.min(WORLD_H - 150, a.y + (Math.random() - 0.5) * 700));
      tx = coastAt(w, ty) - 40 - Math.random() * 180;
      if (!onLand(w, tx, ty)) continue;
    } else if (thirsty) {
      const q = k.water()[Math.floor(Math.random() * k.water().length)];
      tx = q.x + (Math.random() - 0.5) * 160; ty = q.y - 30 - Math.random() * 80;
    } else {
      tx = a.x + (Math.random() - 0.5) * 1400; ty = a.y + (Math.random() - 0.5) * 700;
    }
    if (!k.canStand(s, a.sp, tx, ty)) continue;
    k.setTask(a, "rest", "fly");
    a.tx = tx; a.ty = ty;
    return;
  }
}

function settle(k: WildKit, a: Animal, dt: number) {
  const m = k.moved();
  a.moving = m ? Math.min(1, a.moving + dt * 3) : Math.max(0, a.moving - dt * 3);
  if (!m && (a.action === "walk" || a.action === "run")) k.act(a, "idle");
}
