import { isNight } from "../daycycle";
import { CELL_H, CELL_W, WORLD_H, WORLD_W } from "../config";
import { saveProgress } from "../progress";
import { M } from "../render/materials";
import { mulberry32 } from "../rng";
import { SPECIES, SPECIES_LIST } from "../species";
import type { Action, Species, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { toast } from "../ui/toast";
import type { World } from "../world/generate";
import { T, isWater } from "../world/tiles";
import { initFauna, stepFauna, type Bug } from "./eco-fauna";
import { liveAir, liveSea, type WildKit } from "./eco-wild";
import { knockTree } from "../world/trees";
import { BREAKERS, clearLine, findPath, navStats, nearestFree, pathBudget } from "./nav";
import { canStand, parkBrain, type Animal, type Task } from "./park";

/**
 * Écosystème de la réserve : besoins (faim, soif, énergie), broutage, abreuvement, sommeil,
 * troupeaux, appels, chasse et défense, carcasses et charognards.
 * Tout est lisible à l'œil : chaque tâche joue une action du modèle (eat, drink, rest, run...).
 * Coût : O(n²) seulement aux balayages (toutes les ~0,3 s par animal) et pour l'écartement ; aucune
 * allocation dans les boucles chaudes.
 */

export interface EcoPlant { x: number; y: number; level: "low" | "high"; food: number }
export interface EcoState {
  /** Monde pour lequel plantes et points d'eau ont été calculés (change avec le style). */
  world: World | null;
  plants: EcoPlant[];
  water: { x: number; y: number }[];
  fauna: Bug[];
}

const ONE_SHOT: Partial<Record<Action, number>> = { attack: 0.9, call: 1.6, dead: 1.4, takeoff: 1.6, land: 1.4 };
const LOOP: Partial<Record<Action, number>> = { idle: 4, eat: 1.6, drink: 1.4, rest: 4, defend: 1.2 };
/** Angles d'évitement essayés tour à tour (radians, du plus direct au plus large). */
const ANG = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4];
const DEAD_TIME = 180;

// Index et chefs de troupeau, reconstruits à chaque pas sans allocation.
const byId = new Map<number, Animal>();
/** Rang de chaque suiveur dans son espèce (0 = chef) et rang des chasseurs d'une même proie. */
const herdRank = new Map<number, number>();
const huntRank = new Map<number, number>();
const leader: Partial<Record<SpeciesId, Animal>> = {};
const alive: Partial<Record<SpeciesId, number>> = {};
let moved = false;
let prevT = 0;

const spOf = (a: Animal) => SPECIES[a.sp];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, (a.y - b.y) * 1.3);

function act(a: Animal, action: Action) {
  if (a.action !== action) { a.action = action; a.actionT = 0; }
}

/** Avance l'animation de l'action. Renvoie true quand une action ponctuelle vient de finir. */
function tick(a: Animal, dt: number): boolean {
  prevT = a.actionT;
  const once = ONE_SHOT[a.action];
  if (once) {
    a.actionT = Math.min(0.999, a.actionT + dt / once);
    return prevT < 0.999 && a.actionT >= 0.999;
  }
  const loop = LOOP[a.action];
  if (loop) a.actionT = (a.actionT + dt / loop) % 1;
  return false;
}
/** L'action ponctuelle vient-elle de franchir `t` (moment de l'impact) ? */
const crossed = (a: Animal, t: number) => prevT < t && a.actionT >= t;

function setTask(a: Animal, t: Task, mood = "wander") {
  a.task = t;
  a.mood = mood;
  a.timer = 0;
  a.blocked = 0;
}

/**
 * Avance vers (tx, ty) : suit un chemin A* (grille de navigation de l'espèce), recalculé quand la
 * cible bouge, quand le chemin vieillit ou quand l'animal ne progresse plus vers son point d'étape.
 * Les voisins sont évités en route (voir `step`). `plan` = destination fixe (chemin gardé plus longtemps).
 * Renvoie la distance restante au but, ou -1 si l'animal reste bloqué : l'appelant change alors d'objectif.
 */
function go(s: GameState, a: Animal, spec: Species, tx: number, ty: number, speed: number, dt: number, plan = false): number {
  const d = Math.hypot(tx - a.x, ty - a.y);
  if (d < 6) { a.path = null; return d; }
  const w = worldFor(s);
  a.repath -= dt;
  const drift = Math.hypot(tx - a.pgx, ty - a.pgy);
  // Nouveau chemin seulement si la cible a vraiment bougé, si le chemin a vieilli ou si l'on piétine :
  // recalculer trop souvent fait hésiter entre deux contournements équivalents (allers-retours).
  if ((!a.path || drift > Math.max(60, d * 0.35) || a.repath <= 0) && navStats.budget > 0) {
    // Ligne droite praticable : inutile de lancer A* (sauf si l'on vient de buter : la grille est moins fine).
    const direct = a.blocked < 0.2 && a.stuckT < 1 && clearLine(w, a.sp, a.x, a.y, tx, ty);
    const found = direct ? [tx, ty] : findPath(w, a.sp, a.x, a.y, tx, ty);
    // Pas de chemin (cible isolée) : on tente tout droit, et l'on abandonnera vite si ça ne passe pas
    // (sans relancer A* à chaque frame, ce qui remettrait la vigie à zéro).
    if (!found) a.stuckT += 2.5;
    a.path = found ?? [tx, ty];
    a.pi = 0; a.pgx = tx; a.pgy = ty;
    a.repath = plan ? 8 : 3 + Math.random();
    a.prog = Infinity; a.progT = 0;
  }
  // Point d'étape courant ; le dernier est remplacé par la vraie cible (elle peut bouger un peu).
  let wx = tx, wy = ty;
  const P = a.path;
  if (P && a.pi * 2 < P.length) {
    const last = a.pi * 2 >= P.length - 2;
    wx = last && drift < 40 ? tx : P[a.pi * 2]; wy = last && drift < 40 ? ty : P[a.pi * 2 + 1];
    if (!last && Math.hypot(wx - a.x, wy - a.y) < Math.max(12, spec.walkSpeed * dt * 2)) {
      a.pi++; a.prog = Infinity; a.progT = 0;
      wx = P[a.pi * 2]; wy = P[a.pi * 2 + 1];
    }
  }
  // Vigie : aucun progrès vers le point d'étape -> nouveau chemin ; trop longtemps -> abandon.
  const dw = Math.hypot(wx - a.x, wy - a.y);
  if (dw < a.prog - 2) { a.prog = dw; a.progT = 0; } else a.progT += dt;
  if (a.progT > 1.5) { a.repath = 0; a.prog = Infinity; a.progT = 0; a.stuckT += 1.5; a.side = a.side > 0 ? -1 : 1; }
  const r = step(s, a, spec, wx, wy, speed, dt);
  a.stuckT = r >= 0 ? Math.max(0, a.stuckT - dt * 0.3) : a.stuckT + dt;
  if (a.stuckT > 6) { a.stuckT = 0; a.path = null; a.blocked = 2; return -1; }
  return d;
}

/**
 * Un pas vers (tx, ty) avec évitement : les voisins proches repoussent la direction voulue
 * (ellipse d'espace personnel, longue à l'horizontale comme les corps), on contourne par le
 * haut ou le bas, et l'on ralentit derrière un plus gros ou un animal qui mange / dort.
 * Ensuite, angles de repli si le décor bloque. Renvoie -1 si aucun angle n'est praticable.
 */
function step(s: GameState, a: Animal, spec: Species, tx: number, ty: number, speed: number, dt: number): number {
  const dx = tx - a.x, dy = ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return d;
  let ux = dx / d, uy = dy / d;
  let ax = 0, ay = 0, slow = 1;
  // Perpendiculaire à la route : on contourne par ce côté-là, sans jamais freiner l'avancée.
  const px = -uy, py = ux;
  for (const o of byId.values()) {
    if (o === a || o.task === "dead" || o.id === a.targetId || o.targetId === a.id || apart(a, o)) continue;
    const os = spOf(o);
    if (!os) continue;
    const rx = (spec.halfLen + os.halfLen) * 0.5 + 8, ry = 22;
    const relx = o.x - a.x, rely = o.y - a.y;
    const e = Math.hypot(relx / rx, rely / ry);
    if (e > 1.8) continue;
    const fwd = relx * ux + rely * uy;
    if (fwd > 0 && e < 1.6) {
      // Devant nous : on passe du côté opposé à lui (côté fixe si pile en face, selon les id).
      const lat = relx * px + rely * py;
      const sgn = Math.abs(lat) > 2 ? -Math.sign(lat) : a.id < o.id ? 1 : -1;
      const k = 1 - e / 1.6;
      ax += px * sgn * k * 1.5; ay += py * sgn * k * 1.5;
      // On ralentit derrière un plus gros (ou un prioritaire) qui avance ; un animal immobile se contourne.
      if (o.moving > 0.3 && (os.halfLen > spec.halfLen * 1.1 || o.id < a.id)) slow = Math.min(slow, 0.5 + e * 0.3);
    }
    // Au contact : légère répulsion, quel que soit le côté.
    if (e < 1) { ax -= (relx / rx) * (1 - e) * 0.7; ay -= (rely / ry) * (1 - e) * 0.7; }
  }
  if (ax || ay) {
    ux += ax; uy += ay;
    const n = Math.hypot(ux, uy) || 1;
    ux /= n; uy /= n;
  }
  const base = Math.atan2(uy, ux);
  const stp = Math.min(d, speed * slow * dt);
  const look = Math.max(stp * 4, 18);
  for (let k = 0; k < ANG.length; k++) {
    const ang = base + ANG[k] * a.side;
    const c = Math.cos(ang), sn = Math.sin(ang) * 0.75;
    if (!canStand(s, a.sp, a.x + c * look, a.y + sn * look) || !canStand(s, a.sp, a.x + c * stp, a.y + sn * stp)) continue;
    a.x += c * stp;
    a.y += sn * stp;
    // Se retourner seulement sur un vrai déplacement horizontal (pas de clignotement gauche/droite).
    if (Math.abs(c) > 0.5) a.facing = c > 0 ? 1 : -1;
    const run = speed > spec.walkSpeed * 1.3;
    act(a, run ? "run" : "walk");
    a.walk += dt * spec.stride * (run ? 1.7 : Math.max(0.6, (speed * slow) / spec.walkSpeed));
    a.blocked = Math.max(0, a.blocked - dt);
    moved = true;
    return d;
  }
  // Passage serré : on retente à petits pas, sans regarder loin devant.
  for (let k = 0; k < ANG.length; k++) {
    const ang = base + ANG[k] * a.side;
    const c = Math.cos(ang), sn = Math.sin(ang) * 0.75;
    if (!canStand(s, a.sp, a.x + c * stp, a.y + sn * stp)) continue;
    a.x += c * stp;
    a.y += sn * stp;
    act(a, "walk");
    a.walk += dt * spec.stride * 0.6;
    moved = true;
    a.blocked += dt * 0.5;
    return d;
  }
  a.blocked += dt;
  if (a.blocked > 0.5) a.side = a.side > 0 ? -1 : 1;
  return -1;
}

/** Regarde vers un point. */
const face = (a: Animal, x: number) => { if (Math.abs(x - a.x) > 2) a.facing = x > a.x ? 1 : -1; };

/**
 * Choisit où se tenir pour avoir la tête au-dessus de (x, y) : `side` = 1 si l'animal doit regarder
 * vers la droite. Écrit la place dans a.tx/a.ty. Renvoie false si aucune place n'est praticable.
 */
function approach(s: GameState, a: Animal, spec: Species, x: number, y: number, side: number): boolean {
  const reachX = spec.eye.x * 0.85;
  for (const sd of [side, -side]) {
    for (const dy of [0, 7, -7, 14, -14, 24, -24]) {
      const tx = x - sd * reachX, ty = y + dy;
      if (canStand(s, a.sp, tx, ty)) return budget(a, spec, tx, ty);
    }
  }
  for (let r = 20; r <= 100; r += 20) {
    for (let k = 0; k < 8; k++) {
      const tx = x + Math.cos(k * 0.785) * r, ty = y + Math.sin(k * 0.785) * r * 0.5;
      if (canStand(s, a.sp, tx, ty)) return budget(a, spec, tx, ty);
    }
  }
  return false;
}

/** Fixe la destination et le temps de trajet accordé (a.chase, s) avant d'abandonner. */
function budget(a: Animal, spec: Species, tx: number, ty: number): true {
  a.tx = tx;
  a.ty = ty;
  a.chase = Math.hypot(tx - a.x, ty - a.y) / spec.walkSpeed * 1.8 + 10;
  return true;
}

/** Marche jusqu'à la place choisie (a.tx, a.ty). Renvoie true une fois arrivé ; abandonne si le trajet traîne. */
function reach(s: GameState, a: Animal, spec: Species, speed: number, dt: number): boolean {
  a.timer += dt;
  const d = go(s, a, spec, a.tx, a.ty, speed, dt, true);
  if (d >= 0 && d < 8) return true;
  // Tout près mais on piétine (berge, voisin, rocher) : on fait avec.
  const near = Math.hypot(a.tx - a.x, a.ty - a.y);
  if (near < Math.max(40, spec.halfLen * 0.9) && (a.blocked > 0.6 || a.timer > a.chase * 0.5)) return true;
  if (a.timer > a.chase) a.spot = -1;
  return false;
}

// ---------------------------------------------------------------------------
// Plantes et points d'eau
// ---------------------------------------------------------------------------

/** Plantes et points d'eau du monde (generate.ts), ou repli calculé ici s'ils manquent. */
function ensureEco(s: GameState): EcoState {
  const w = worldFor(s);
  const p = s.park;
  if (p.eco && p.eco.world === w) return p.eco;
  const ext = w as World & { plants?: { x: number; y: number; level: "low" | "high"; food?: number }[]; waterPoints?: { x: number; y: number }[] };
  const plants: EcoPlant[] = ext.plants?.length
    ? ext.plants.map((q) => ({ x: q.x, y: q.y, level: q.level, food: q.food ?? 1 }))
    : fallbackPlants(w);
  const water = ext.waterPoints?.length ? ext.waterPoints.map((q) => ({ x: q.x, y: q.y })) : fallbackWater(w);
  const eco: EcoState = { world: w, plants, water, fauna: p.eco?.fauna ?? [] };
  p.eco = eco;
  if (!eco.fauna.length) initFauna(s, eco);
  return eco;
}

function fallbackPlants(w: World): EcoPlant[] {
  const rng = mulberry32(4242);
  const out: EcoPlant[] = [];
  // Hautes : pied des arbres (cellules de feuillage -> ligne de sol de l'objet).
  const seen = new Set<number>();
  for (let i = 0; i < w.cols * w.rows && out.length < 70; i += 7) {
    const m = w.decorMat[i];
    if (m !== M.Leaf && m !== M.Moss && m !== M.Wood) continue;
    const x = (i % w.cols) * CELL_W, base = w.decorBase[i];
    if (base < 0) continue;
    const key = Math.floor(x / 90) * 1000 + Math.floor(base / 90);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: x + (rng() < 0.5 ? -30 : 30), y: base + 8, level: "high", food: 1 });
  }
  // Basses : touffes sur l'herbe, plus denses près de l'eau.
  for (let k = 0, n = 0; k < 6000 && n < 150; k++) {
    const x = 60 + rng() * (WORLD_W - 120), y = 120 + rng() * (WORLD_H - 160);
    const i = Math.floor(y / CELL_H) * w.cols + Math.floor(x / CELL_W);
    if (w.terrain[i] !== T.Grass || w.solid[i]) continue;
    out.push({ x, y, level: "low", food: 0.6 + rng() * 0.4 });
    n++;
  }
  return out;
}

function fallbackWater(w: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const { pond } = w;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    // Du large vers le centre : premier point d'eau peu profonde.
    for (let r = 1.6; r > 0.3; r -= 0.02) {
      const x = pond.x + Math.cos(a) * pond.rx * r, y = pond.y + Math.sin(a) * pond.ry * r;
      if (x < 40 || y < 90 || x > WORLD_W - 40 || y > WORLD_H - 10) continue;
      const i = Math.floor(y / CELL_H) * w.cols + Math.floor(x / CELL_W);
      if (isWater(w.terrain[i])) { out.push({ x, y }); break; }
    }
  }
  return out;
}

function pickPlant(eco: EcoState, a: Animal, browse: Species["behavior"]["browse"]): number {
  let best = -1, bs = Infinity;
  for (let i = 0; i < eco.plants.length; i++) {
    const q = eco.plants[i];
    if (q.food < 0.35 || (browse !== "both" && q.level !== browse)) continue;
    let sc = dist(a, q) + Math.random() * 120;
    if (sc - 120 > bs) continue;
    for (const o of byId.values()) if (o !== a && o.task === "graze" && o.spot === i) { sc += 300; break; }
    if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}

function pickWater(eco: EcoState, a: Animal): number {
  // Le plus proche, en évitant les places déjà prises (le troupeau s'étale le long de la rive).
  let best = -1, bs = Infinity;
  for (let i = 0; i < eco.water.length; i++) {
    const q = eco.water[i];
    let sc = dist(a, q) + Math.random() * 90;
    if (sc - 90 > bs) continue;
    for (const o of byId.values()) if (o !== a && o.task === "drink" && o.spot === i) { sc += 400; break; }
    if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/** `pred` chasse-t-il l'espèce `sp` ? */
const hunts = (pred: Species, sp: SpeciesId) => pred.behavior.prey.includes(sp);
const busyHunting = (t: Task) => t === "hunt" || t === "chase" || t === "attack";
const calmTask = (t: Task) => t === "wander" || t === "graze" || t === "drink" || t === "rest";

/** Prédateur menaçant le plus proche (en chasse, ou simplement trop près). */
function threatFor(a: Animal, spec: Species): Animal | undefined {
  let best: Animal | undefined, bd = Infinity;
  for (const o of byId.values()) {
    if (o.task === "dead" || o.task === "stunned" || o.task === "retreat") continue;
    const os = spOf(o);
    if (!os || !hunts(os, a.sp)) continue;
    const d = dist(a, o);
    const menacing = (busyHunting(o.task) && d < spec.behavior.sight) || (d < spec.behavior.sight * 0.35 && o.task !== "feed" && o.task !== "rest");
    if (menacing && d < bd) { bd = d; best = o; }
  }
  return best;
}

function nearestCarcass(a: Animal, range: number): Animal | undefined {
  let best: Animal | undefined, bd = range;
  for (const o of byId.values()) {
    if (o.task !== "dead" || o.meat <= 0.02 || o === a) continue;
    const d = dist(a, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Choisit une proie : la plus proche, avec un bonus pour les fatiguées, vieilles ou isolées. */
function pickPrey(a: Animal, spec: Species): Animal | undefined {
  let best: Animal | undefined, bs = Infinity;
  for (const o of byId.values()) {
    if (o.task === "dead" || !hunts(spec, o.sp)) continue;
    const d = dist(a, o);
    const weak = (o.energy < 0.3 ? 150 : 0) + o.age * 120 + (o.herd <= 1 ? 120 : 0);
    const sc = d - weak + Math.random() * 100;
    if (sc < bs) { bs = sc; best = o; }
  }
  return best;
}

function herdMates(a: Animal, range: number, fn: (o: Animal) => void) {
  for (const o of byId.values()) if (o !== a && o.sp === a.sp && o.task !== "dead" && dist(a, o) < range) fn(o);
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

function startCall(a: Animal, answer: boolean) {
  setTask(a, "call", a.mood === "herd" ? "herd" : "wander");
  act(a, "call");
  if (!answer) herdMates(a, 650, (o) => { if (calmTask(o.task) && o.answer === 0) o.answer = 0.4 + Math.random() * 1.1; });
  a.answer = answer ? -1 : 0;
}

/** La proie réagit au prédateur selon sa défense. */
function react(a: Animal, spec: Species, pred: Animal) {
  a.targetId = pred.id;
  const d = spec.behavior.defense;
  if (d === "club" || d === "horns" || d === "headbutt") {
    if (a.task !== "defend") { setTask(a, "defend", "defend"); act(a, "defend"); a.cool = 0.4; }
    return;
  }
  if (a.task === "flee") return;
  setTask(a, "flee", "flee");
  a.targetId = pred.id;
  // Les grands troupeaux qui fuient donnent l'alerte : un cri, puis tout le monde court.
  if (spec.behavior.herd[1] > 1) {
    a.alarm = 0.7;
    act(a, "call");
    herdMates(a, 650, (o) => { if (o.task !== "flee" && o.task !== "defend") { setTask(o, "flee", "flee"); o.targetId = pred.id; o.alarm = 0.2 + Math.random() * 0.4; } });
  }
}

/** Le prédateur est repoussé : sonné, puis il renonce un moment. */
function stun(pred: Animal, from: Animal, s: GameState) {
  setTask(pred, "stunned", "stunned");
  act(pred, "idle");
  pred.stun = 3;
  pred.cool = 45;
  pred.targetId = from.id;
  const dir = pred.x > from.x ? 1 : -1;
  for (let k = 30; k > 0; k -= 10) {
    if (canStand(s, pred.sp, pred.x + dir * k, pred.y)) { pred.x += dir * k; break; }
  }
}

function kill(s: GameState, pred: Animal, prey: Animal) {
  setTask(prey, "dead", "dead");
  act(prey, "dead");
  prey.hp = 0;
  prey.decay = DEAD_TIME;
  prey.meat = 1;
  prey.moving = 0;
  setTask(pred, "feed", "scavenge");
  pred.targetId = prey.id;
  pred.spot = -1;
  pred.cool = 60;
  // La meute partage le repas.
  for (const o of byId.values()) {
    if (o !== pred && o.sp === pred.sp && busyHunting(o.task) && o.targetId === prey.id) { setTask(o, "feed", "scavenge"); o.targetId = prey.id; o.spot = -1; }
  }
  // Un animal synthétisé de moins dans la réserve.
  const pop = s.progress.population;
  pop[prey.sp] = Math.max(0, (pop[prey.sp] ?? 1) - 1);
  saveProgress(s.progress);
  const ps = spOf(prey), ds = spOf(pred);
  toast(s, "Chaîne alimentaire", `Un ${ps?.name ?? prey.sp} a été chassé par un ${ds?.name ?? pred.sp}. C'est la chaîne alimentaire.`);
}

/** Succès d'une attaque : ~20-25 %, plus si la proie est fatiguée, vieille ou isolée. */
function attackSucceeds(prey: Animal): boolean {
  const ps = spOf(prey);
  if (!ps || (alive[prey.sp] ?? 0) <= 1) return false; // on ne fait jamais disparaître une espèce
  if (prey.task === "defend" && prey.action === "attack") return false;
  let p = 0.22;
  if (prey.energy < 0.3) p += 0.2;
  if (prey.herd <= 1 && ps.behavior.herd[1] > 1) p += 0.12;
  p += prey.age * 0.12;
  if (ps.behavior.defense !== "flee" && ps.behavior.defense !== "bite") p *= 0.6;
  return Math.random() < p;
}

// ---------------------------------------------------------------------------
// Décision
// ---------------------------------------------------------------------------

function waterSide(s: GameState, x: number, y: number): number {
  const w = worldFor(s);
  const at = (px: number) => isWater(w.terrain[Math.floor(y / CELL_H) * w.cols + Math.floor(px / CELL_W)]);
  return at(x + 24) && !at(x - 24) ? 1 : at(x - 24) && !at(x + 24) ? -1 : x < w.pond.x ? 1 : -1;
}

function graze(s: GameState, eco: EcoState, a: Animal, spec: Species): boolean {
  if (!spec.behavior.browse) return false;
  a.spot = pickPlant(eco, a, spec.behavior.browse);
  const q = eco.plants[a.spot];
  if (!q || !approach(s, a, spec, q.x, q.y, a.x < q.x ? 1 : -1)) { a.spot = -1; return false; }
  setTask(a, "graze", a.mood);
  return true;
}

/** Que faire maintenant ? Appelé quand l'animal est disponible (errance, fin de tâche). */
function decide(s: GameState, eco: EcoState, a: Animal, spec: Species) {
  const B = spec.behavior;
  const dark = isNight(s.clock);
  if (a.energy < 0.08) { setTask(a, "rest", a.mood); return; }
  if (a.thirst > 0.6 && eco.water.length) {
    a.spot = pickWater(eco, a);
    const q = eco.water[a.spot];
    // Regarder vers l'eau : de quel côté est-elle ?
    if (q && approach(s, a, spec, q.x, q.y, waterSide(s, q.x, q.y))) { setTask(a, "drink", a.mood); return; }
  }
  if (a.hunger > 0.35 && (B.scavenger || B.diet === "carnivore")) {
    const c = nearestCarcass(a, B.sight * 2.5);
    if (c) { setTask(a, "feed", "scavenge"); a.targetId = c.id; a.spot = -1; return; }
  }
  if (a.hunger > 0.55) {
    if (B.prey.length && a.cool <= 0) {
      const prey = pickPrey(a, spec);
      if (prey) {
        setTask(a, "hunt", "hunt");
        a.targetId = prey.id;
        a.chase = 0;
        // La meute se joint à la chasse.
        herdMates(a, 500, (o) => { if (calmTask(o.task) && o.hunger > 0.3 && o.cool <= 0) { setTask(o, "hunt", "hunt"); o.targetId = prey.id; o.chase = 0; } });
        return;
      }
    }
    if (B.browse && eco.plants.length && graze(s, eco, a, spec)) return;
  }
  if (a.energy < (dark ? 0.45 : 0.28) || (dark && a.energy < 0.8 && Math.random() < 0.06)) { setTask(a, "rest", a.mood); return; }
  if (a.hunger > 0.3 && B.browse && Math.random() < 0.3 && graze(s, eco, a, spec)) return;
  if (Math.random() < 0.07) { startCall(a, false); return; }
  setTask(a, "wander", a.herd > 1 ? "herd" : "wander");
  const ld = leader[a.sp];
  if (B.herd[1] > 1 && ld && ld !== a) { a.timer = 1 + Math.random() * 2; return; }
  // Errance : un point au hasard, pas trop loin.
  const r = spec.walkSpeed * 16;
  a.chase = 0;
  for (let k = 0; k < 8; k++) {
    const tx = a.x + (Math.random() - 0.5) * r * 2, ty = a.y + (Math.random() - 0.5) * r;
    if (canStand(s, a.sp, tx, ty)) { a.tx = tx; a.ty = ty; break; }
  }
  a.timer = 3 + Math.random() * 6;
}

/** Une étape de vie d'un animal. */
function live(s: GameState, eco: EcoState, a: Animal, dt: number) {
  const spec = spOf(a);
  if (!spec) return;
  moved = false;
  const done = tick(a, dt);
  if (a.task === "dead") { a.moving = 0; a.alt = Math.max(0, a.alt - dt * 200); return; }
  if (spec.habitat === "sea") return liveSea(kit(eco), s, a, spec, dt, done);
  if (spec.habitat === "air") return liveAir(kit(eco), s, a, spec, dt, done);
  const B = spec.behavior;
  const carn = B.diet === "carnivore";
  a.hunger = Math.min(1, a.hunger + dt / (carn ? 260 : 200));
  a.thirst = Math.min(1, a.thirst + dt / 220);
  if (a.task === "rest") a.energy = Math.min(1, a.energy + dt / 22);
  else a.energy = Math.max(0, a.energy - dt / (a.action === "run" ? 40 : 320));
  a.cool = Math.max(0, a.cool - dt);

  // Balayage des alentours : troupeau, menaces.
  a.scan -= dt;
  if (a.scan <= 0) {
    a.scan = 0.25 + Math.random() * 0.15;
    let n = 1;
    herdMates(a, 380, () => n++);
    a.herd = n;
    const th = a.task === "stunned" ? undefined : threatFor(a, spec);
    if (th) react(a, spec, th);
    else if ((a.task === "flee" || a.task === "defend") && a.timer > 2.5) { setTask(a, "wander", "wander"); a.timer = 0.5; }
    else if (a.task === "flee" || a.task === "defend") a.timer += 0.3; // calme depuis peu : on attend un peu
  }

  // Réponse différée à l'appel d'un congénère.
  if (a.answer > 0 && (a.answer -= dt) <= 0) { a.answer = 0; if (a.task === "wander") startCall(a, true); }

  const run = spec.runSpeed * (a.energy < 0.15 ? 0.7 : 1) * (1 - a.age * 0.15);
  switch (a.task) {
    case "wander": {
      const ld = leader[a.sp];
      a.mood = a.herd > 1 ? "herd" : "wander";
      if (B.herd[1] > 1 && ld && ld !== a) {
        // Suiveur : sa place dans la formation, en échelons derrière le chef (un rang en haut,
        // un rang en bas, de plus en plus en retrait). Chacun vise un point différent : pas de bouchon.
        // L'arrière et les côtés suivent la direction réelle de marche du chef (lissée), pas son
        // orientation gauche/droite : un demi-tour ne fait plus se croiser tout le troupeau.
        const k = Math.max(0, (herdRank.get(a.id) ?? 1) - 1);
        const row = Math.floor(k / 2) + 1, up = k % 2 ? 1 : -1;
        const hn = Math.hypot(ld.vx, ld.vy);
        const bx = hn > 0.2 ? -ld.vx / hn : -ld.facing, by = hn > 0.2 ? -ld.vy / hn : 0;
        // Rangs en retrait vers l'arrière (b), décalés d'un côté puis de l'autre (perpendiculaire).
        let tx = ld.x + bx * row * spec.halfLen * 0.75 - by * up * row * 30;
        let ty = ld.y + by * row * 28 + bx * up * row * 30;
        // Place inaccessible (eau, bosquet) : la case libre la plus proche.
        if (!canStand(s, a.sp, tx, ty)) {
          const f = nearestFree(worldFor(s), a.sp, tx, ty, 8);
          if (f) { tx = f.x; ty = f.y; } else { tx = ld.x - ld.facing * spec.halfLen; ty = ld.y; }
        }
        const far = Math.hypot(tx - a.x, ty - a.y);
        // Hystérésis (a.vt = 1 : en route) : on repart au-delà de 50 px, on s'arrête sous 20 px.
        if (far > 50) a.vt = 1;
        else if (far < 20) a.vt = 0;
        if (a.vt && go(s, a, spec, tx, ty, spec.walkSpeed * (far > 320 ? 1.9 : far > 120 ? 1.15 : 0.9), dt) < 0) a.vt = 0;
        if (!a.vt) { act(a, "idle"); if (ld.moving < 0.2) face(a, a.x + ld.facing); }
        a.timer -= dt;
        if (a.timer <= 0) { a.timer = 1.5 + Math.random() * 2; if (ld.moving < 0.5 || a.hunger > 0.6 || a.thirst > 0.65) decide(s, eco, a, spec); }
        break;
      }
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      a.chase += dt;
      if (d > 8 && a.blocked < 1.5 && a.chase < 30) go(s, a, spec, a.tx, a.ty, spec.walkSpeed, dt, true);
      else {
        act(a, "idle");
        a.tx = a.x; a.ty = a.y;
        a.timer -= dt;
        if (a.timer <= 0) decide(s, eco, a, spec);
      }
      break;
    }
    case "graze": {
      const q = eco.plants[a.spot];
      if (!q || q.food < 0.05) { a.spot = -1; if (a.hunger > 0.25 && graze(s, eco, a, spec)) break; setTask(a, "wander"); break; }
      if (a.action !== "eat") {
        if (!reach(s, a, spec, spec.walkSpeed, dt)) { if (a.spot < 0) setTask(a, "wander"); break; }
        face(a, q.x);
        act(a, "eat");
      }
      a.hunger = Math.max(0, a.hunger - dt / 9);
      q.food = Math.max(0, q.food - dt / 14);
      if (a.hunger < 0.06) { setTask(a, "wander", a.mood); a.timer = 1 + Math.random() * 2; }
      break;
    }
    case "drink": {
      const q = eco.water[a.spot];
      if (!q) { setTask(a, "wander"); break; }
      if (a.action !== "drink") {
        if (!reach(s, a, spec, spec.walkSpeed * (a.thirst > 0.85 ? 1.3 : 1), dt)) { if (a.spot < 0) setTask(a, "wander"); break; }
        face(a, q.x);
        act(a, "drink");
      }
      a.thirst = Math.max(0, a.thirst - dt / 6);
      if (a.thirst < 0.04) { setTask(a, "wander", a.mood); a.timer = 1 + Math.random() * 3; }
      break;
    }
    case "rest":
      act(a, "rest");
      if (a.energy > 0.97 || (!isNight(s.clock) && a.energy > 0.9 && Math.random() < dt * 0.2)) { setTask(a, "wander", a.mood); a.timer = 1; }
      break;
    case "call":
      act(a, "call");
      if (done) { a.answer = 0; setTask(a, "wander", a.mood); a.timer = 1 + Math.random() * 2; }
      break;
    case "hunt":
    case "chase": {
      const prey = byId.get(a.targetId);
      if (!prey || prey.task === "dead") { setTask(a, "wander"); a.cool = 6; a.timer = 1; break; }
      const ps = spOf(prey)!;
      const d = dist(a, prey);
      a.mood = "hunt";
      // Meute : chacun prend un angle différent autour de la proie (de face, de dos, par le haut,
      // par le bas) au lieu de tous viser le même point.
      const rank = huntRank.get(a.id) ?? 0;
      const near = prey.x > a.x ? -1 : 1;
      const sideX = rank % 2 === 0 ? near : -near;
      const offY = rank < 2 ? 0 : rank % 2 === 0 ? -34 : 34;
      // Place de chasse dans un obstacle (proie contre un arbre, au bord de l'eau) : la case libre la plus proche.
      const slot = (sx: number, sy: number) => (canStand(s, a.sp, sx, sy) ? { x: sx, y: sy } : nearestFree(worldFor(s), a.sp, sx, sy, 8) ?? { x: prey.x, y: prey.y });
      if (a.task === "hunt") {
        // Approche discrète, puis la poursuite.
        const q = slot(prey.x + sideX * spec.halfLen * 0.6, prey.y + offY);
        go(s, a, spec, q.x, q.y, spec.walkSpeed * 1.1, dt);
        if (d < B.sight * 0.45) { a.task = "chase"; a.chase = 0; }
        a.chase += dt;
        if (a.chase > 60) { setTask(a, "wander"); a.cool = 15; }
        break;
      }
      a.chase += dt;
      const range = (spec.halfLen + ps.halfLen) * 0.55;
      const q = slot(prey.x + sideX * range * 0.6, prey.y + offY * 0.5);
      go(s, a, spec, q.x, q.y, run, dt);
      if (d < range) { a.task = "attack"; act(a, "attack"); face(a, prey.x); }
      else if (a.chase > 9 || d > B.sight * 1.4 || a.energy < 0.05) { setTask(a, "wander"); a.cool = 25; a.timer = 2; }
      break;
    }
    case "attack": {
      const prey = byId.get(a.targetId);
      a.mood = "hunt";
      if (!prey || prey.task === "dead") { if (done || !prey) setTask(a, "wander"); break; }
      act(a, "attack");
      face(a, prey.x);
      if (crossed(a, 0.55)) {
        const ps = spOf(prey);
        const range = ((ps?.halfLen ?? 30) + spec.halfLen) * 0.7;
        if (dist(a, prey) < range && attackSucceeds(prey)) { kill(s, a, prey); break; }
        // Raté : une seule tentative par chasse, la proie a sa chance.
        a.chase = 99;
      }
      if (done) {
        if (a.chase > 9) { setTask(a, "wander"); a.cool = 30; a.timer = 2; }
        else a.task = "chase";
      }
      break;
    }
    case "feed": {
      const c = byId.get(a.targetId);
      if (!c || c.task !== "dead" || c.meat <= 0.02) { setTask(a, "wander"); a.timer = 1; break; }
      a.mood = "scavenge";
      if (a.action !== "eat") {
        // La carcasse ne bouge pas : place calculée une fois, recalculée si l'on piétine.
        if (a.spot !== c.id) { a.spot = c.id; if (!approach(s, a, spec, c.x, c.y, a.x < c.x ? 1 : -1)) { setTask(a, "wander"); break; } }
        if (!reach(s, a, spec, spec.walkSpeed * 1.2, dt)) { if (a.spot < 0) setTask(a, "wander"); break; }
        face(a, c.x);
        act(a, "eat");
      }
      a.hunger = Math.max(0, a.hunger - dt / 12);
      c.meat = Math.max(0, c.meat - dt / 110);
      if (a.hunger < 0.05) {
        // Repu : une bonne sieste.
        a.energy = Math.min(a.energy, 0.3);
        setTask(a, "rest", "wander");
      }
      break;
    }
    case "flee": {
      const pred = byId.get(a.targetId);
      a.mood = "flee";
      if (a.alarm > 0) { a.alarm -= dt; act(a, "call"); break; }
      if (!pred) { setTask(a, "wander"); break; }
      let dx = a.x - pred.x, dy = (a.y - pred.y) * 1.3;
      const n = Math.hypot(dx, dy) || 1;
      dx /= n; dy /= n;
      go(s, a, spec, a.x + dx * 160, a.y + dy * 160, run, dt);
      break;
    }
    case "defend": {
      const pred = byId.get(a.targetId);
      if (!pred || pred.task === "dead") { setTask(a, "wander"); break; }
      const ds = spOf(pred);
      const d = dist(a, pred);
      const club = B.defense === "club";
      const strike = ((ds?.halfLen ?? 40) + spec.halfLen) * (club ? 0.8 : 0.65);
      a.mood = "defend";
      // La massue se présente queue en avant ; cornes et crâne font face.
      if (a.action !== "run") a.facing = (pred.x > a.x) !== club ? 1 : -1;
      if (a.action === "attack") {
        if (crossed(a, 0.55) && d < strike * 1.25 && Math.random() < (club ? 0.6 : B.defense === "horns" ? 0.55 : 0.5)) stun(pred, a, s);
        if (done) { act(a, "defend"); a.cool = 1.2; }
      } else if (d < strike && a.cool <= 0) act(a, "attack");
      else if (!club && d < strike * 2.4 && d > strike * 0.8 && a.energy > 0.2 && pred.task !== "stunned") {
        // Charge : cornes ou crâne en avant.
        go(s, a, spec, pred.x, pred.y, run * 0.9, dt);
      } else act(a, "defend");
      break;
    }
    case "stunned":
      act(a, "idle");
      a.stun -= dt;
      if (a.stun <= 0) {
        const from = byId.get(a.targetId);
        const dir = from && from.x > a.x ? -1 : 1;
        setTask(a, "retreat", "wander");
        a.tx = a.x + dir * 300; a.ty = a.y + (Math.random() - 0.5) * 120;
        a.timer = 6;
      }
      break;
    case "retreat":
      a.timer -= dt;
      if (go(s, a, spec, a.tx, a.ty, spec.walkSpeed * 1.3, dt, true) < 10 || a.timer <= 0) { setTask(a, "wander"); a.timer = 2; }
      break;
  }

  a.moving = moved ? Math.min(1, a.moving + dt * 4) : Math.max(0, a.moving - dt * 4);
  if (!moved && (a.action === "walk" || a.action === "run")) act(a, "idle");
}

/** Deux animaux qui ne partagent pas le même espace (mer / sol / ciel) s'ignorent. */
const apart = (a: Animal, b: Animal) => (spOf(a)?.habitat === "sea") !== (spOf(b)?.habitat === "sea") || a.alt > 4 || b.alt > 4;

/** Briques de déplacement prêtées aux cerveaux de la mer et des airs (eco-wild.ts). */
let kitCache: { eco: EcoState; k: WildKit } | null = null;
function kit(eco: EcoState): WildKit {
  if (kitCache?.eco === eco) return kitCache.k;
  const k: WildKit = {
    go, reach, approach, canStand, act, setTask, face, waterSide,
    water: () => eco.water,
    pickWater: (a) => pickWater(eco, a),
    threat: (a, range) => {
      for (const o of byId.values()) {
        const os = spOf(o);
        if (o === a || o.task === "dead" || !os || os.habitat || os.behavior.diet !== "carnivore") continue;
        if (dist(a, o) < range) return true;
      }
      return false;
    },
    moved: () => moved,
  };
  kitCache = { eco, k };
  return k;
}

/** Poids d'un animal dans les bousculades : qui dort, mange ou boit ne se laisse pas pousser. */
const mass = (a: Animal, h: number) => (a.task === "rest" || a.action === "eat" || a.action === "drink" ? h * 6 : h);

/**
 * Écartement : deux corps qui se chevauchent malgré l'évitement sont séparés, surtout en profondeur
 * (haut / bas). Le plus léger bouge le plus ; si le décor bloque, on essaie l'autre axe.
 */
function separate(s: GameState, list: Animal[], dt: number) {
  const k = Math.min(1, dt * 8);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.task === "dead") continue;
    const sa = spOf(a);
    if (!sa) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.task === "dead" || a.targetId === b.id || b.targetId === a.id || apart(a, b)) continue;
      const sb = spOf(b);
      if (!sb) continue;
      const rx = (sa.halfLen + sb.halfLen) * 0.45, ry = 18;
      const ox = b.x - a.x, oy = b.y - a.y;
      const e = Math.hypot(ox / rx, oy / ry);
      if (e >= 1) continue;
      const pen = 1 - e;
      const sy = oy !== 0 ? Math.sign(oy) : a.id < b.id ? 1 : -1;
      const sx = ox !== 0 ? Math.sign(ox) : 1;
      const py = pen * ry * k, px = pen * rx * 0.25 * k;
      const ma = mass(a, sa.halfLen), mb = mass(b, sb.halfLen);
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      const shove = (o: Animal, dirX: number, dirY: number, wgt: number) => {
        if (canStand(s, o.sp, o.x + dirX * px * wgt, o.y + dirY * py * wgt)) { o.x += dirX * px * wgt; o.y += dirY * py * wgt; }
        else if (canStand(s, o.sp, o.x, o.y + dirY * py * wgt)) o.y += dirY * py * wgt;
        else if (canStand(s, o.sp, o.x, o.y - dirY * py * wgt)) o.y -= dirY * py * wgt;
      };
      shove(a, -sx, -sy, wa);
      shove(b, sx, sy, wb);
    }
  }
}

/** Arbres sous l'emprise d'un animal massif : ils tombent, poussés dans son sens de marche. */
function smash(w: World, a: Animal) {
  const spec = spOf(a);
  if (!spec) return;
  const half = spec.halfLen * 0.72;
  const row = Math.floor(a.y / CELL_H);
  for (let r = row - 1; r <= row; r++) {
    for (let lx = -half; lx <= half; lx += CELL_W) {
      const i = r * w.cols + Math.floor((a.x + lx) / CELL_W);
      const id = w.solidOwner[i];
      if (id < 0 || !w.solid[i]) continue;
      const t = w.trees[id];
      if (t) knockTree(w, t, Math.abs(a.vx) > 0.2 ? (a.vx > 0 ? 1 : -1) : t.x >= a.x ? 1 : -1);
    }
  }
}

/** Un pas de l'écosystème : plantes, animaux, carcasses, petite faune. */
export function stepEcosystem(s: GameState, dt: number) {
  const p = s.park;
  const w = worldFor(s);
  const eco = ensureEco(s);
  byId.clear();
  for (const sp of SPECIES_LIST) { leader[sp.id] = undefined; alive[sp.id] = 0; }
  for (const a of p.animals) {
    byId.set(a.id, a);
    if (a.task === "dead") continue;
    alive[a.sp] = (alive[a.sp] ?? 0) + 1;
    const l = leader[a.sp];
    if (!l || a.id < l.id) leader[a.sp] = a;
  }
  // Rangs de formation (par espèce, dans l'ordre des id) et de meute (par proie).
  herdRank.clear(); huntRank.clear();
  const count: Record<string, number> = {};
  for (const a of p.animals) {
    if (a.task === "dead") continue;
    herdRank.set(a.id, (count[a.sp] = (count[a.sp] ?? -1) + 1));
    if (a.task === "hunt" || a.task === "chase" || a.task === "attack") {
      const key = `t${a.targetId}`;
      huntRank.set(a.id, (count[key] = (count[key] ?? -1) + 1));
    }
  }
  // Quelques chemins A* par pas au plus : les autres animaux attendent leur tour (ils avancent quand même).
  pathBudget(4);
  for (const q of eco.plants) if (q.food < 1) q.food = Math.min(1, q.food + dt / 70);
  separate(s, p.animals, dt);
  const brain = parkBrain;
  for (const a of p.animals) {
    if (brain) brain(s, a, dt);
    else live(s, eco, a, dt);
    // Filet de sécurité : un animal coincé dans le décor (poussé, apparu de travers) est replacé
    // sur la case libre la plus proche.
    if (a.task !== "dead" && a.alt === 0 && a.mood !== "fly" && !canStand(s, a.sp, a.x, a.y)) {
      const f = nearestFree(w, a.sp, a.x, a.y);
      if (f) { a.x = f.x; a.y = f.y; a.path = null; }
    }
    // Le T. rex renverse les arbres qu'il traverse (ils repoussent plus tard, voir trees.ts).
    if (BREAKERS.has(a.sp) && a.moving > 0.3 && a.task !== "dead") smash(w, a);
    // Direction de marche lissée (sert à la formation du troupeau).
    const mx = a.x - a.gx, my = a.y - a.gy, ml = Math.hypot(mx, my);
    if (ml > 0.05 && ml < 50) { const f = Math.min(1, dt * 1.5); a.vx += (mx / ml - a.vx) * f; a.vy += (my / ml - a.vy) * f; }
    else if (ml <= 0.05) { a.vx *= 1 - Math.min(1, dt * 0.3); a.vy *= 1 - Math.min(1, dt * 0.3); }
    a.gx = a.x; a.gy = a.y;
    const i = Math.floor(a.y / CELL_H) * w.cols + Math.floor(a.x / CELL_W);
    a.inWater = w.terrain[i] === T.Shallow;
  }
  // Carcasses : elles se décomposent puis disparaissent.
  let gone = false;
  for (const a of p.animals) {
    if (a.task !== "dead") continue;
    if (a.meat <= 0.02) a.decay = Math.min(a.decay, 20);
    a.decay -= dt;
    if (a.decay <= 0) gone = true;
  }
  if (gone) {
    p.animals = p.animals.filter((a) => a.task !== "dead" || a.decay > 0);
    if (p.selected !== undefined && !p.animals.some((a) => a.id === p.selected)) p.selected = undefined;
  }
  stepFauna(s, eco, p.animals, dt);
}

/** Ce que fait l'animal, en français simple (« broute », « fuit un prédateur »...). */
export function activity(a: Animal): string {
  const spec = SPECIES[a.sp];
  const still = a.moving < 0.3;
  if (spec?.habitat === "sea" && a.task !== "dead") {
    switch (a.task) {
      case "hunt": return "fonce sur un banc de poissons";
      case "attack": return "attaque un poisson !";
      case "feed": return "avale sa proie";
      case "rest": return "derive en se reposant";
      case "call": return "remonte respirer a la surface";
      default: return still ? "flotte entre deux eaux" : "nage au large";
    }
  }
  if (spec?.habitat === "air" && a.task !== "dead") {
    if (a.action === "takeoff") return "prend son envol";
    if (a.action === "land") return "se pose";
    if (a.alt > 0 || a.mood === "fly") return a.task === "wander" ? (a.moving > 0.5 ? "bat des ailes" : "plane dans le ciel") : "descend pour se poser";
    if (a.task === "graze") return a.action === "eat" ? "avale une petite proie" : "chasse de petites betes au sol";
  }
  switch (a.task) {
    case "wander": return a.action === "idle" ? (a.herd > 1 ? "se tient avec son troupeau" : "observe les alentours") : a.herd > 1 ? "suit son troupeau" : "se promène";
    case "graze": return a.action === "eat" ? (spec?.behavior.browse === "high" ? "broute les feuilles des arbres" : "broute") : "cherche des plantes à brouter";
    case "drink": return a.action === "drink" ? "boit" : "va boire";
    case "rest": return "dort";
    case "call": return a.answer < 0 ? "répond à l'appel d'un congénère" : "appelle ses congénères";
    case "hunt": return "traque une proie";
    case "chase": return "poursuit une proie";
    case "attack": return "attaque !";
    case "feed": return a.action === "eat" ? "dévore une carcasse" : "rejoint une carcasse";
    case "flee": return a.alarm > 0 ? "donne l'alerte" : "fuit un prédateur";
    case "defend": {
      const d = spec?.behavior.defense;
      if (a.action === "attack") return d === "club" ? "frappe avec sa massue" : d === "horns" ? "charge avec ses cornes" : "donne un coup de tête";
      return !still ? "charge le prédateur" : d === "club" ? "présente sa massue au prédateur" : "fait face au prédateur";
    }
    case "stunned": return "est sonné";
    case "retreat": return "renonce et s'éloigne";
    case "dead": return "est mort";
  }
  return "se promène";
}
