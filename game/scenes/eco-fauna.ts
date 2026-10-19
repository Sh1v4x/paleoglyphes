import { CELL_H, CELL_W, WORLD_H, WORLD_W } from "../config";
import { saveProgress } from "../progress";
import type { Actor } from "../render/compose";
import { worldCellAt } from "../render/metrics";
import { placed, RasterCache, type Raster } from "../render/raster";
import { mulberry32 } from "../rng";
import { FAUNA, type FaunaDef, type FaunaId } from "../species/fauna";
import type { Action } from "../species/types";
import { worldFor, type GameState } from "../state";
import { toast } from "../ui/toast";
import type { World } from "../world/generate";
import { isWater } from "../world/tiles";
import type { EcoState } from "./ecosystem";
import type { Animal } from "./park";

/**
 * Petite faune de la réserve (registre FAUNA, parcouru dynamiquement) :
 * libellules en essaims au bord de l'eau, coléoptères, Didelphodon (charognards craintifs),
 * ptérosaures qui planent en cercles (dessinés en altitude, ombre au sol).
 * Cliquer une bête ajoute une note « fauna:<id> » aux extras du carnet.
 */

export interface Bug {
  uid: number;
  kind: FaunaId;
  /** Position au sol (px monde) ; `alt` = hauteur de vol (px). */
  x: number;
  y: number;
  alt: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  walk: number;
  moving: number;
  action: Action;
  actionT: number;
  timer: number;
  phase: number;
  /** Carcasse visée (id d'animal), 0 sinon. */
  target: number;
}

/** Combien de chaque bête, et leur façon de vivre. */
// Le grand ptérosaure est désormais une espèce à fouiller (Quetzalcoatlus) : plus de ptérosaure d'ambiance.
const COUNT: Partial<Record<string, number>> = { dragonfly: 9, beetle: 8, didelphodon: 3 };
const UID0 = 1_000_000;
const cache = new RasterCache(800);
const TAU = Math.PI * 2;
const EMPTY: Raster = { cx: 0, cy: 0, w: 1, h: 1, mat: new Uint16Array(1), lum: new Float32Array(1), glyph: new Uint8Array(1) };

export const faunaDef = (b: Bug): FaunaDef | undefined => (FAUNA as Partial<Record<string, FaunaDef>>)[b.kind];
const darting = (d: FaunaDef) => d.flying && (d.altitude ?? 20) < 60;

function land(w: World, x: number, y: number): boolean {
  if (x < 20 || y < 70 || x > WORLD_W - 20 || y > WORLD_H - 8) return false;
  const i = Math.floor(y / CELL_H) * w.cols + Math.floor(x / CELL_W);
  return !isWater(w.terrain[i]) && !w.solid[i];
}

export function initFauna(s: GameState, eco: EcoState) {
  const w = worldFor(s);
  const rng = mulberry32(777);
  let uid = 1;
  const landPoint = (nearX: number, nearY: number, r: number) => {
    for (let k = 0; k < 200; k++) {
      const x = nearX + (rng() - 0.5) * r * 2, y = nearY + (rng() - 0.5) * r;
      if (land(w, x, y)) return { x, y };
    }
    return { x: w.spawn.x, y: w.spawn.y };
  };
  for (const def of Object.values(FAUNA) as FaunaDef[]) {
    const n = COUNT[def.id] ?? (def.flying ? 2 : 3);
    let home = { x: w.pond.x, y: w.pond.y };
    for (let k = 0; k < n; k++) {
      if (darting(def)) {
        // Essaims de trois au-dessus d'un point d'eau.
        if (k % 3 === 0) home = eco.water.length ? eco.water[Math.floor(rng() * eco.water.length)] : landPoint(w.pond.x, w.pond.y, w.pond.rx * 1.3);
      } else if (def.flying) home = { x: w.pond.x + (rng() - 0.5) * 300, y: w.pond.y + (rng() - 0.5) * 200 };
      else home = def.id === "beetle" ? landPoint(WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.45) : landPoint(w.pond.x, w.pond.y, w.pond.rx * 2.2);
      const x = home.x + (rng() - 0.5) * 40, y = home.y + (rng() - 0.5) * 20;
      eco.fauna.push({
        uid: uid++, kind: def.id, x, y, alt: def.flying ? (def.altitude ?? 20) : 0, hx: home.x, hy: home.y, tx: x, ty: y,
        facing: rng() < 0.5 ? 1 : -1, walk: rng() * TAU, moving: 0, action: "idle", actionT: rng(), timer: rng() * 2, phase: rng() * TAU, target: 0,
      });
    }
  }
}

function moveTo(b: Bug, tx: number, ty: number, speed: number, dt: number): number {
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
  if (d < 2) return d;
  const k = Math.min(d, speed * dt) / d;
  b.x += dx * k;
  b.y += dy * k;
  if (Math.abs(dx) > 1) b.facing = dx > 0 ? 1 : -1;
  return d;
}

export function stepFauna(s: GameState, eco: EcoState, animals: Animal[], dt: number) {
  const w = worldFor(s);
  const t = s.time;
  for (const b of eco.fauna) {
    const def = faunaDef(b);
    if (!def) continue;
    b.actionT = (b.actionT + dt / 1.5) % 1;
    if (darting(def)) {
      // Libellule : petits sauts rapides autour de son point d'eau, vol stationnaire entre deux.
      b.timer -= dt;
      if (b.timer <= 0) { b.tx = b.hx + (Math.random() - 0.5) * 140; b.ty = b.hy + (Math.random() - 0.5) * 70; b.timer = 0.4 + Math.random(); }
      moveTo(b, b.tx, b.ty, def.speed * 1.5, dt);
      b.alt = (def.altitude ?? 18) + Math.sin(t * 3 + b.phase) * 4;
      b.action = "walk"; b.moving = 1; b.walk += dt * 30;
      continue;
    }
    if (def.flying) {
      // Ptérosaure : grands cercles planés, quelques battements d'ailes de temps en temps.
      const R = 180 + (b.uid % 3) * 70;
      const ang = b.phase + (t * def.speed) / R * (b.uid % 2 ? 1 : -1);
      const nx = b.hx + Math.cos(ang) * R, ny = b.hy + Math.sin(ang) * R * 0.55;
      if (Math.abs(nx - b.x) > 0.05) b.facing = nx > b.x ? 1 : -1;
      b.x = Math.max(30, Math.min(WORLD_W - 30, nx));
      b.y = Math.max(120, Math.min(WORLD_H - 10, ny));
      b.alt = (def.altitude ?? 170) + Math.sin(t * 0.5 + b.phase) * 20;
      const flap = (t * 0.2 + b.phase) % 1 < 0.25;
      b.action = flap ? "walk" : "idle"; b.moving = flap ? 1 : 0; b.walk += dt * 8;
      continue;
    }
    // Au sol : fuit les dinosaures, le Didelphodon chaparde aux carcasses.
    const fear = b.kind === "beetle" ? 40 : 170;
    let danger: Animal | undefined, dd = fear;
    for (const a of animals) {
      if (a.task === "dead") continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < dd) { dd = d; danger = a; }
    }
    let speed = def.speed, running = false;
    if (danger) {
      const dx = b.x - danger.x, dy = b.y - danger.y, n = Math.hypot(dx, dy) || 1;
      b.tx = b.x + (dx / n) * 80; b.ty = b.y + (dy / n) * 40;
      speed = def.speed * 1.8; running = true; b.target = 0; b.timer = 1;
    } else if (b.kind === "didelphodon" && b.target === 0 && Math.random() < dt * 0.5) {
      // Une carcasse sans gros dinosaure autour ? On s'en approche.
      for (const c of animals) {
        if (c.task !== "dead" || c.meat <= 0.02 || Math.hypot(c.x - b.x, c.y - b.y) > 1400) continue;
        if (animals.some((a) => a.task !== "dead" && Math.hypot(a.x - c.x, a.y - c.y) < 120)) continue;
        b.target = c.id; b.timer = 12 + Math.random() * 10;
        break;
      }
    }
    const carcass = b.target ? animals.find((a) => a.id === b.target && a.task === "dead") : undefined;
    if (b.target && !carcass) b.target = 0;
    b.timer -= dt;
    let eating = false;
    if (carcass && !running) {
      const d = moveTo(b, carcass.x + (b.uid % 2 ? 22 : -22), carcass.y + 3, speed * 1.2, dt);
      if (d < 3) { eating = true; b.facing = carcass.x > b.x ? 1 : -1; carcass.meat = Math.max(0, carcass.meat - dt / 600); }
      if (b.timer <= 0) b.target = 0;
    } else {
      if (!running && b.timer <= 0) {
        const r = b.kind === "beetle" ? 70 : 220;
        b.tx = b.hx + (Math.random() - 0.5) * r * 2; b.ty = b.hy + (Math.random() - 0.5) * r;
        b.timer = 2 + Math.random() * 5;
      }
      const ox = b.x, oy = b.y;
      moveTo(b, b.tx, b.ty, speed, dt);
      if (!land(w, b.x, b.y)) { b.x = ox; b.y = oy; b.tx = b.hx; b.ty = b.hy; }
    }
    const mv = Math.hypot(b.tx - b.x, b.ty - b.y) > 2 && !eating;
    b.moving = mv ? 1 : 0;
    b.action = eating ? "eat" : mv ? (running ? "run" : "walk") : "idle";
    if (mv) b.walk += dt * (running ? 16 : 10);
  }
}

function bugRaster(b: Bug, def: FaunaDef, time: number): Raster {
  const wq = Math.floor(((b.walk % TAU) + TAU) % TAU / (TAU / 8));
  const tq = Math.floor(((time + b.phase) % 2.4) * 2.5);
  const aq = Math.floor(b.actionT * 6) % 6;
  const flip = b.facing < 0;
  const key = `${b.kind}|${flip ? 1 : 0}|${b.action}|${b.moving}|${wq}|${tq}|${aq}`;
  return cache.get(key, () => def.model({ walk: wq * (TAU / 8), moving: b.moving, time: tq / 2.5, action: b.action, actionT: aq / 6 }), flip);
}

/** Ajoute la petite faune visible aux acteurs du monde (les volants passent devant tout, avec une ombre au sol). */
export function faunaActors(s: GameState, out: Actor[], x0: number, y0: number, x1: number, y1: number) {
  const eco = s.park.eco;
  if (!eco) return;
  for (const b of eco.fauna) {
    if (b.x < x0 || b.x > x1 || b.y - b.alt < y0 || b.y > y1) continue;
    const def = faunaDef(b);
    if (!def) continue;
    const r = bugRaster(b, def, s.time);
    const cx = Math.floor(b.x / CELL_W), cy = Math.floor((b.y - b.alt) / CELL_H);
    if (def.flying) {
      if (b.alt > 60) out.push({ id: UID0 * 2 + b.uid, r: EMPTY, x: b.x, y: b.y, inWater: false, shadowRx: Math.max(8, r.w * CELL_W * 0.3), eyeX: -9999, eyeY: -9999 });
      out.push({ id: UID0 + b.uid, r: placed(r, cx, cy), x: b.x, y: WORLD_H * 4 + b.y, inWater: false, shadowRx: 0.01, eyeX: b.x, eyeY: b.y - b.alt });
    } else {
      out.push({ id: UID0 + b.uid, r: placed(r, cx, cy), x: b.x, y: b.y, inWater: false, shadowRx: Math.max(3, r.w * CELL_W * 0.35), eyeX: b.x, eyeY: b.y - 3 });
    }
  }
}

/** Petite bête sous un point écran (px CSS). Tolérance large : elles sont minuscules. */
export function faunaAt(s: GameState, px: number, py: number): Bug | undefined {
  const eco = s.park.eco;
  if (!eco) return undefined;
  const c = worldCellAt(px, py);
  const wx = c.x + Math.floor(s.park.cam.x / CELL_W), wy = c.y + Math.floor(s.park.cam.y / CELL_H);
  let best: Bug | undefined, bd = Infinity;
  for (const b of eco.fauna) {
    const def = faunaDef(b);
    if (!def) continue;
    const r = bugRaster(b, def, s.time);
    const bx = Math.floor(b.x / CELL_W) + r.cx, by = Math.floor((b.y - b.alt) / CELL_H) + r.cy;
    const i = wx - bx, j = wy - by;
    if (i < -3 || j < -2 || i > r.w + 2 || j > r.h + 1) continue;
    const d = Math.abs(i - r.w / 2) + Math.abs(j - r.h / 2);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Cliquer une petite bête : note bonus dans le carnet (une seule fois). */
export function noteFauna(s: GameState, b: Bug) {
  const def = faunaDef(b);
  if (!def) return;
  const key = `fauna:${b.kind}`;
  if (s.progress.extras.includes(key)) return;
  s.progress.extras.push(key);
  saveProgress(s.progress);
  toast(s, "Nouvelle note au carnet !", `${def.name} : à lire dans les Extras du carnet.`);
}
