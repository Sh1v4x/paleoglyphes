import { WORLD_H, WORLD_W } from "../config";
import type { Species } from "../species/types";
import type { GameState } from "../state";
import type { Animal } from "./park";

/**
 * Milieux particuliers de la réserve : la mer (mosasaure) et les airs (ptérosaure).
 * Les briques de déplacement (go, reach, approach...) sont fournies par ecosystem.ts.
 */

export interface WildKit {
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
}

/** En vol, l'ombre reste assez loin du bord nord pour que l'animal (dessiné plus haut) reste visible. */
const SKY_TOP = 520;

function seaPoint(k: WildKit, s: GameState, a: Animal, r: number): boolean {
  for (let n = 0; n < 16; n++) {
    const tx = a.x + (Math.random() - 0.5) * r * 2, ty = a.y + (Math.random() - 0.5) * r;
    if (k.canStand(s, a.sp, tx, ty)) { a.tx = tx; a.ty = ty; return true; }
  }
  return false;
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
    case "attack":
      k.act(a, "attack");
      if (done) { k.setTask(a, "feed", "hunt"); k.act(a, "eat"); a.timer = 3; }
      break;
    case "feed":
      k.act(a, "eat");
      a.hunger = Math.max(0, a.hunger - dt / 4);
      if (a.timer <= 0) { k.setTask(a, "wander"); a.timer = 2; }
      break;
    case "rest":
      k.act(a, "rest");
      if (a.energy > 0.95) { k.setTask(a, "wander"); a.timer = 1; }
      break;
    case "call":
      // Remonte respirer : la tête sort de l'eau.
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
          if (a.hunger > 0.5 && seaPoint(k, s, a, 900)) { k.setTask(a, "hunt", "hunt"); a.timer = 0; break; }
          if (Math.random() < 0.15) { k.setTask(a, "call"); k.act(a, "call"); break; }
          seaPoint(k, s, a, 1100);
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
 * `a.alt` > 0 : en vol ; `a.mood === "fly"` : en vol ou en approche d'atterrissage.
 */
export function liveAir(k: WildKit, s: GameState, a: Animal, spec: Species, dt: number, done: boolean) {
  a.hunger = Math.min(1, a.hunger + dt / 220);
  a.thirst = Math.min(1, a.thirst + dt / 260);
  if (a.task === "rest" && a.alt === 0 && a.mood !== "fly") a.energy = Math.min(1, a.energy + dt / 22);
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
      if (a.task !== "drink") k.setTask(a, "wander");
      a.timer = 1 + Math.random() * 2;
    }
    return;
  }

  if (a.alt > 0 || a.mood === "fly") {
    a.mood = "fly";
    // « wander » = croisière ; toute autre tâche = il cherche à se poser à (tx, ty).
    const landing = a.task !== "wander";
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    const v = spec.runSpeed * (landing && d < 200 ? 0.55 : 1) * dt;
    if (d > 3) {
      a.x += (dx / d) * Math.min(d, v); a.y += (dy / d) * Math.min(d, v) * 0.8;
      if (Math.abs(dx) > 4) a.facing = dx > 0 ? 1 : -1;
    }
    const cruise = 170 + 50 * Math.sin(s.time * 0.3 + a.phase);
    // En approche : il descend jusqu'à ~45 px, puis la séquence d'atterrissage prend le relais.
    const want = landing && d < 160 ? 45 : cruise;
    a.alt = Math.max(0, a.alt + Math.sign(want - a.alt) * Math.min(Math.abs(want - a.alt), dt * 90));
    // Bat des ailes en montée (et de temps en temps) ; plane le reste du temps.
    const flap = want > a.alt + 5 || Math.sin(s.time * 0.4 + a.phase) > 0.35;
    k.act(a, "fly");
    a.walk += dt * spec.stride * (flap ? 1.4 : 0.15);
    a.moving = flap ? 1 : 0;
    if (landing && d <= 40 && a.alt <= 50) {
      k.act(a, "land");
    } else if (!landing && d < 40) {
      if (a.timer <= 0 && (a.hunger > 0.4 || a.energy < 0.4 || a.thirst > 0.5 || Math.random() < 0.5)) pickLanding(k, s, a);
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
    a.timer = 20 + Math.random() * 30;
    a.tx = Math.max(200, Math.min(WORLD_W - 200, a.x + (Math.random() - 0.5) * 1600));
    a.ty = Math.max(SKY_TOP, Math.min(WORLD_H - 200, a.y + (Math.random() - 0.5) * 800));
  };
  if (k.threat(a, spec.behavior.sight * 0.45)) { takeOff(); return; }
  switch (a.task) {
    case "graze":
      // Chasse à l'affût de petites proies : quelques pas, un coup de bec, il avale.
      a.mood = "hunt";
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
      a.timer = 2;
      if (a.energy < 0.3) { k.setTask(a, "rest"); break; }
      if (a.thirst > 0.5 && k.water().length) {
        a.spot = k.pickWater(a);
        const q = k.water()[a.spot];
        if (q && k.approach(s, a, spec, q.x, q.y, k.waterSide(s, q.x, q.y))) { k.setTask(a, "drink"); break; }
      }
      if (a.hunger > 0.3) { k.setTask(a, "graze", "hunt"); a.timer = 6; a.tx = a.x; a.ty = a.y; break; }
      if (Math.random() < 0.25) { k.setTask(a, "call"); k.act(a, "call"); break; }
      takeOff();
  }
  settle(k, a, dt);
}

/** Choisit où se poser : au bord de l'eau s'il a soif, sinon un coin praticable de la réserve. */
function pickLanding(k: WildKit, s: GameState, a: Animal) {
  const thirsty = a.thirst > 0.5 && k.water().length > 0;
  for (let n = 0; n < 40; n++) {
    let tx: number, ty: number;
    if (thirsty) {
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
