import { CELL_H, CELL_W } from "../config";
import { clockLabel, isNight } from "../daycycle";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import type { Animal, Nest } from "../scenes/park";
import { activity } from "../scenes/ecosystem";
import { UI_TOP } from "../scenes/types";
import { SPECIES } from "../species";
import type { FactUnlock, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { calm } from "../settings";
import { actions, button, fill, overlay, panel, put, region, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { unlockTrigger } from "../unlock";
import { isWater } from "../world/tiles";
import { activeTrees } from "../world/trees";

/**
 * Mode documentaire de la réserve.
 * - Toujours actif en arrière-plan : on SONDE l'état de la réserve toutes les 0,3 s et on compare
 *   avec la photo précédente de chaque animal / nid (tâche, action, humeur...) pour repérer les
 *   moments forts (chasse, éclosion, envol, bond hors de l'eau...). Chacun reçoit un score
 *   d'intérêt, un sujet et une phrase de narration.
 * - Les moments notables qui se passent hors de l'écran vont dans le journal des « moments
 *   manqués » (30 au plus) : un clic y emmène la caméra.
 * - Mode allumé (bouton ou touche V) : la caméra choisit le meilleur moment récent, y va
 *   (panoramique doux, ou coupe avec fondu au noir si c'est loin), le tient 6 à 12 s avec
 *   bandes cinéma et sous-titres, puis passe au suivant. Sans action : visite lente des troupeaux.
 * - Reprendre la caméra (flèches, glisser, molette, clic dans le monde) ARRÊTE le mode : le joueur
 *   veut regarder autre chose, on ne lui reprend pas la main. Un appui sur V le relance.
 */

type Kind =
  | "hunt" | "attack" | "kill" | "defend" | "flee" | "carcass" | "nest" | "court" | "theft" | "hatch" | "birth"
  | "takeoff" | "land" | "dive" | "leap" | "seachase" | "beach" | "crossing" | "drinking" | "call" | "answer"
  | "oldage" | "tree" | "nighthunt";

export interface Moment {
  id: number;
  kind: Kind;
  sp: SpeciesId;
  text: string;
  /** Position (px monde) au moment de l'évènement. */
  x: number;
  y: number;
  /** Animal suivi (id), 0 si aucun. */
  subject: number;
  score: number;
  /** Instant (s.time), jour et heure de la réserve. */
  t: number;
  day: number;
  clock: number;
  /** Vu à l'écran (ou depuis le journal) ; déjà filmé par le documentaire. */
  seen: boolean;
  shown: boolean;
  trigger?: FactUnlock;
}

/** Photo d'un animal au dernier sondage. */
interface Snap {
  task: string;
  action: string;
  mood: string;
  inWater: boolean;
  gen: number;
}

interface Shot {
  /** null : visite libre (troupeaux, paysage). */
  m: Moment | null;
  subject: number;
  sp: SpeciesId | null;
  x: number;
  y: number;
  text: string;
  lines: string[];
  t0: number;
  hold: number;
  score: number;
  unlocked: boolean;
}

export interface DocuState {
  on: boolean;
  /** Prochain sondage (s), génération du balayage, premier passage fait. */
  poll: number;
  gen: number;
  primed: boolean;
  snaps: Map<number, Snap>;
  nests: Map<number, { eggs: number; hatched: boolean }>;
  falling: Set<number>;
  cool: Map<string, number>;
  /** Moments récents (candidats du réalisateur) et journal des moments manqués. */
  recent: Moment[];
  log: Moment[];
  nextId: number;
  /** Jour de la réserve (passage de minuit). */
  day: number;
  lastClock: number;
  listOpen: boolean;
  shot: Shot | null;
  /** Coupe en cours : temps restant (s) et plan qui suivra le noir. */
  cut: number;
  pending: Shot | null;
  /** Début du mode (carton de titre). */
  since: number;
  lastTour: SpeciesId | null;
  /** Écoute de débogage (scripts) : appelée à chaque moment détecté et à chaque nouveau plan. */
  debug?: (what: "moment" | "shot", m: Moment | null, text: string) => void;
}

export function createDocuState(): DocuState {
  return {
    on: false, poll: 0, gen: 0, primed: false, snaps: new Map(), nests: new Map(), falling: new Set(), cool: new Map(),
    recent: [], log: [], nextId: 1, day: 1, lastClock: -1, listOpen: false, shot: null, cut: 0, pending: null, since: 0, lastTour: null,
  };
}

const POLL = 0.3;
const CUT = 0.8;
const LOG_MAX = 30;
/** Score minimal pour entrer au journal des moments manqués. */
const LOG_MIN = 5;
const BLACK: RGB = [0, 0, 0];
const RED: RGB = [235, 70, 60];

// --- Noms et petites phrases --------------------------------------------------------------------

const vowel = (n: string) => /^[aeiouyhàâéèêîïôûAEIOUYHÉÈ]/.test(n);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const N = (sp: SpeciesId | undefined) => (sp && SPECIES[sp]?.name) || "dinosaure";
const un = (n: string) => `un ${n}`;
const le = (n: string) => (vowel(n) ? `l'${n}` : `le ${n}`);
const du = (n: string) => (vowel(n) ? `de l'${n}` : `du ${n}`);
const pl = (n: string) => (/[sx]$/.test(n) ? n : `${n}s`);
const dePl = (n: string) => (vowel(n) ? `d'${pl(n)}` : `de ${pl(n)}`);
const pick = <T,>(v: T[]): T => v[Math.floor(Math.random() * v.length) % v.length];

/** Où se passe la scène, en quelques mots. */
function place(s: GameState, x: number, y: number, sp: SpeciesId): string {
  if (SPECIES[sp]?.habitat === "sea") return pick(["Au large", "Sous les vagues", "En pleine mer"]);
  if (isNight(s.clock) && Math.random() < 0.5) return pick(["Dans la nuit", "Sous la lune", "A la faveur de la nuit"]);
  const w = worldFor(s);
  const px = (x - w.pond.x) / w.pond.rx, py = (y - w.pond.y) / w.pond.ry;
  if (px * px + py * py < 2.2) return pick(["Au bord de l'étang", "Près de l'étang"]);
  for (const [ox, oy] of [[60, 0], [-60, 0], [0, 40], [0, -40]]) {
    const i = Math.floor((y + oy) / CELL_H) * w.cols + Math.floor((x + ox) / CELL_W);
    if (i >= 0 && i < w.terrain.length && isWater(w.terrain[i])) return pick(["Au bord de la rivière", "Près de l'eau"]);
  }
  return pick(["Dans la plaine", "Au cœur de la réserve", "Non loin des arbres", "Dans les hautes herbes"]);
}

interface Ctx { A: string; B: string; P: string }

/** Narrations (2-3 variantes), ton documentaire et adapté aux enfants. */
const LINES: Record<Kind, (c: Ctx) => string[]> = {
  hunt: ({ A, B, P }) => [
    `${P}, ${un(A)} repère ${un(B)} et s'approche sans un bruit...`,
    `${P}, ${un(A)} tend une embuscade. Sa proie, ${un(B)}, ne se doute de rien.`,
    `Tapi dans la végétation, ${un(A)} observe ${un(B)}. La chasse commence.`,
  ],
  attack: ({ A, B }) => [
    `Ça y est ! ${cap(le(A))} bondit sur ${le(B)} !`,
    `${cap(le(A))} passe à l'attaque : ${le(B)} va-t-il s'en sortir ?`,
  ],
  kill: ({ A, B, P }) => [
    `${P}, ${le(A)} a eu raison ${du(B)}. C'est la dure loi de la nature.`,
    `La chasse est terminée : ${le(A)} va enfin manger. Les prédateurs gardent les troupeaux en bonne santé.`,
  ],
  defend: ({ A, B }) => [
    `Quelle riposte ! ${cap(le(A))} repousse ${le(B)}, qui recule, sonné.`,
    `${cap(le(B))} a sous-estimé sa proie : ${le(A)} se défend et l'assomme !`,
    `Bien joué ! ${cap(le(A))} fait face au prédateur et le met en déroute.`,
  ],
  flee: ({ A, B, P }) => [
    `Alerte ! ${cap(le(A))} a repéré ${un(B)} et détale à toute vitesse.`,
    `${P}, ${le(A)} pousse un cri d'alarme et s'enfuit loin ${du(B)}.`,
  ],
  carcass: ({ A, B, P }) => [
    `${P}, ${un(A)} se régale d'une carcasse ${du(B)}. Dans la nature, rien ne se perd.`,
    `Le festin commence : ${le(A)} dévore ce qu'il reste ${du(B)}.`,
  ],
  nest: ({ A, P }) => [
    `${P}, ${un(A)} creuse un nid dans le sol pour y pondre ses œufs.`,
    `Moment rare : ${un(A)} prépare son nid. Il va le garder jour et nuit.`,
  ],
  court: ({ A, P }) => [
    `${P}, deux ${pl(A)} se font la cour. Une parade pleine d'élégance !`,
    `C'est la saison des amours : les ${pl(A)} paradent l'un devant l'autre.`,
  ],
  theft: ({ A, B }) => [
    `Coup de théâtre ! ${cap(un(A))} chaparde un œuf dans le nid ${du(B)}.`,
    `Profitant d'un moment d'inattention, ${un(A)} gobe un œuf ${du(B)}...`,
  ],
  hatch: ({ A }) => [
    `Les coquilles se fendillent... Des bébés ${pl(A)} sortent de leurs œufs !`,
    `Naissance au nid ! Les petits ${pl(A)} découvrent le monde pour la première fois.`,
  ],
  birth: ({ A, P }) => [
    `${P}, un bébé ${A} vient de naître. Il nage aussitôt près de sa mère.`,
    `Bienvenue au monde ! Un petit ${A} fait ses premiers mouvements.`,
  ],
  takeoff: ({ A }) => [
    `${cap(un(A))} déploie ses immenses ailes et s'élance dans le ciel !`,
    `Un bond, quelques battements d'ailes : ${le(A)} prend son envol.`,
  ],
  land: ({ A }) => [
    `${cap(le(A))} replie ses ailes et se pose en douceur.`,
    `Fin du vol : ${le(A)} revient au sol, les ailes repliées comme des béquilles.`,
  ],
  dive: ({ A }) => [
    `${cap(le(A))} pique vers la mer pour attraper un poisson !`,
    `Plongeon ! ${cap(le(A))} fond sur sa proie à la surface de l'eau.`,
  ],
  leap: ({ A }) => [
    `Spectaculaire ! ${cap(un(A))} jaillit hors de l'eau dans une gerbe d'écume.`,
    `${cap(le(A))}, poisson géant de plusieurs mètres, bondit au-dessus des vagues !`,
  ],
  seachase: ({ A, B, P }) => [
    `${P}, ${le(A)} prend en chasse ${un(B)}...`,
    `${cap(le(A))}, maître des mers, fonce droit sur ${un(B)} !`,
  ],
  beach: ({ A }) => [
    `${cap(un(A))}, tortue géante, sort de l'eau pour pondre sur la plage.`,
    `Moment rare : ${un(A)} rampe sur le sable pour y enfouir ses œufs.`,
  ],
  crossing: ({ A, P }) => [
    `${P}, un troupeau ${dePl(A)} traverse l'eau. Les plus grands ouvrent la marche.`,
    `Splash ! Les ${pl(A)} passent le gué tous ensemble, pour plus de sécurité.`,
  ],
  drinking: ({ A, P }) => [
    `${P}, les ${pl(A)} se retrouvent pour boire. Un moment de calme... restons attentifs.`,
    `L'heure de boire : tout le groupe ${dePl(A)} s'abreuve côte à côte.`,
  ],
  call: ({ A }) => [
    `${cap(un(A))} lance un appel puissant à travers la réserve.`,
    `Écoutez ! ${cap(le(A))} appelle ses congénères.`,
  ],
  answer: ({ A }) => [
    `Au loin, un autre ${A} lui répond : ils se parlent !`,
    `Réponse ! Les ${pl(A)} communiquent par de grands cris.`,
  ],
  oldage: ({ A, P }) => [
    `${P}, un vieux ${A} s'est éteint paisiblement, au terme d'une longue vie.`,
    `La vie d'un ${A} touche à sa fin. Les plus jeunes prendront la relève.`,
  ],
  tree: ({ A }) => [
    `Craaac ! ${cap(un(A))} renverse un arbre sur son passage.`,
    `Quelle force ! ${cap(le(A))} fait tomber un arbre entier.`,
  ],
  nighthunt: ({ A }) => [
    `Dans l'obscurité, ${un(A)} chasse grâce à ses grands yeux.`,
    `La nuit venue, ${le(A)} sort de sa cachette pour attraper de petites proies.`,
  ],
};

/** Score d'intérêt (0..10) et fait du carnet associé. */
const SCORE: Record<Kind, [number, FactUnlock?]> = {
  hunt: [6, "hunt"], attack: [7, "attack"], kill: [9, "attack"], defend: [7, "defend"], flee: [5, "flee"],
  carcass: [4, "scavenge"], nest: [6, "nest"], court: [5], theft: [8, "scavenge"], hatch: [10, "nest"], birth: [9, "baby"],
  takeoff: [5], land: [4], dive: [6, "hunt"], leap: [7, "call"], seachase: [7, "hunt"], beach: [8, "nest"],
  crossing: [5, "herd"], drinking: [4, "drink"], call: [3, "call"], answer: [4, "call"], oldage: [7], tree: [7], nighthunt: [6, "eat"],
};

// --- Détection ------------------------------------------------------------------------------------

const busy = (t: string) => t === "hunt" || t === "chase" || t === "attack";

function viewW() { return metrics.cols * CELL_W; }
function viewH() { return metrics.rows * CELL_H; }

function onScreen(s: GameState, x: number, y: number): boolean {
  const c = s.park.cam;
  return x >= c.x && x <= c.x + viewW() && y >= c.y && y <= c.y + viewH();
}

/** Délai anti-répétition : vrai (et réarme) si la clé est libre. */
function ready(d: DocuState, key: string, now: number, wait: number): boolean {
  const t = d.cool.get(key);
  if (t !== undefined && t > now) return false;
  d.cool.set(key, now + wait);
  return true;
}

function emit(s: GameState, kind: Kind, sp: SpeciesId, x: number, y: number, subject: number, other?: SpeciesId) {
  const d = s.docu;
  const [score, trigger] = SCORE[kind];
  const text = pick(LINES[kind]({ A: N(sp), B: N(other), P: place(s, x, y, sp) }));
  const m: Moment = { id: d.nextId++, kind, sp, text, x, y, subject, score, t: s.time, day: d.day, clock: s.clock, seen: onScreen(s, x, y), shown: false, trigger };
  d.recent.push(m);
  if (d.recent.length > 16) d.recent.shift();
  if (!m.seen && score >= LOG_MIN) {
    d.log.push(m);
    if (d.log.length > LOG_MAX) d.log.shift();
  }
  d.debug?.("moment", m, text);
}

/** Sondage : compare l'état de la réserve à la photo précédente. */
function scan(s: GameState) {
  const d = s.docu, p = s.park, now = s.time;
  const gen = ++d.gen;
  const first = !d.primed;
  d.primed = true;
  const byId = new Map<number, Animal>();
  for (const a of p.animals) byId.set(a.id, a);

  for (const a of p.animals) {
    const spec = SPECIES[a.sp];
    if (!spec) continue;
    let o = d.snaps.get(a.id);
    if (!o) {
      o = { task: a.task, action: a.action, mood: a.mood, inWater: a.inWater, gen };
      d.snaps.set(a.id, o);
      // Nouveau venu : un bébé né en mer (ou sans nid). Les éclosions sont racontées par le nid.
      if (!first && a.task !== "dead" && a.growth < 0.45 && !p.nests.some((n) => n.hatched !== undefined && Math.abs(n.x - a.x) < 200 && Math.abs(n.y - a.y) < 140)
        && ready(d, `birth:${a.sp}`, now, 30)) emit(s, "birth", a.sp, a.x, a.y, a.parentId || a.id);
      continue;
    }
    o.gen = gen;
    const sea = spec.habitat === "sea", air = spec.habitat === "air";
    const fish = sea && a.sp === "xiphactinus";
    const other = a.targetId ? byId.get(a.targetId) : undefined;

    if (a.task !== o.task) {
      const t = a.task;
      if (t === "dead") {
        if (a.natural) { if (a.meat > 0) emit(s, "oldage", a.sp, a.x, a.y, 0); }
        else {
          let killer: Animal | undefined;
          for (const k of p.animals) if (k.targetId === a.id && k.task === "feed") { killer = k; break; }
          emit(s, "kill", killer?.sp ?? a.sp, a.x, a.y, killer?.id ?? a.id, killer ? a.sp : undefined);
        }
      } else if (sea) {
        if (t === "chase" && other && ready(d, `sc:${a.id}`, now, 25)) emit(s, "seachase", a.sp, a.x, a.y, a.id, other.sp);
        else if (t === "call" && fish && ready(d, `leap:${a.sp}`, now, 40)) emit(s, "leap", a.sp, a.x, a.y, a.id);
      } else if ((t === "hunt" || t === "chase") && !busy(o.task) && !air && other && other.task !== "dead") {
        if (ready(d, `hunt:${a.id}`, now, 30)) emit(s, "hunt", a.sp, a.x, a.y, a.id, other.sp);
      } else if (t === "attack" && o.task !== "attack" && !air && other && ready(d, `atk:${a.id}`, now, 15)) {
        emit(s, "attack", a.sp, a.x, a.y, a.id, other.sp);
      } else if (t === "stunned" && ready(d, `def:${a.targetId || a.id}`, now, 45)) {
        // Le prédateur sonné vise celui qui l'a frappé : c'est lui le héros du plan.
        emit(s, "defend", other?.sp ?? a.sp, other?.x ?? a.x, other?.y ?? a.y, other?.id ?? a.id, other ? a.sp : undefined);
      } else if (t === "flee" && ready(d, `flee:${a.sp}`, now, 30)) {
        emit(s, "flee", a.sp, a.x, a.y, a.id, other?.sp);
      } else if (t === "feed" && a.mood === "scavenge" && other && other.task === "dead" && !busy(o.task) && ready(d, `feed:${other.id}`, now, 120)) {
        emit(s, "carcass", a.sp, a.x, a.y, a.id, other.sp);
      } else if (t === "call" && !air) {
        if (a.answer < 0) { if (ready(d, `ans:${a.sp}`, now, 40)) emit(s, "answer", a.sp, a.x, a.y, a.id); }
        else if (ready(d, `call:${a.sp}`, now, 40)) emit(s, "call", a.sp, a.x, a.y, a.id);
      } else if (a.sp === "pectinodon" && t === "graze" && isNight(s.clock) && ready(d, `night:${a.id}`, now, 90)) {
        emit(s, "nighthunt", a.sp, a.x, a.y, a.id);
      }
    }
    if (air && a.action !== o.action && a.task !== "dead") {
      if (a.action === "takeoff" && ready(d, `fly:${a.sp}`, now, 40)) emit(s, "takeoff", a.sp, a.x, a.y, a.id);
      else if (a.action === "land" && ready(d, `land:${a.sp}`, now, 40)) emit(s, "land", a.sp, a.x, a.y, a.id);
      else if (a.action === "attack" && a.alt > 0 && ready(d, `dive:${a.sp}`, now, 30)) emit(s, "dive", a.sp, a.x, a.y, a.id);
    }
    if (a.mood !== o.mood && a.task !== "dead") {
      if (a.mood === "nest" && a.growth >= 1) {
        if (ready(d, `nest:${a.id}`, now, 200)) emit(s, a.sp === "archelon" ? "beach" : "nest", a.sp, a.x, a.y, a.id);
      } else if (a.mood === "court" && ready(d, `court:${a.sp}`, now, 60)) emit(s, "court", a.sp, a.x, a.y, a.id);
    }
    // Troupeau qui entre dans l'eau (gué).
    if (a.inWater && !o.inWater && !sea && !air && a.herd >= 3 && a.task !== "flee" && ready(d, `ford:${a.sp}`, now, 90)) emit(s, "crossing", a.sp, a.x, a.y, a.id);
    // Groupe qui boit ensemble.
    if (a.action === "drink" && o.action !== "drink" && (d.cool.get(`drink:${a.sp}`) ?? 0) <= now) {
      let n = 0;
      for (const b of p.animals) if (b.sp === a.sp && b.action === "drink" && Math.abs(b.x - a.x) < 260 && Math.abs(b.y - a.y) < 160) n++;
      if (n >= 3 && ready(d, `drink:${a.sp}`, now, 120)) emit(s, "drinking", a.sp, a.x, a.y, a.id);
    }
    o.task = a.task; o.action = a.action; o.mood = a.mood; o.inWater = a.inWater;
  }
  for (const [id, o] of d.snaps) if (o.gen !== gen) d.snaps.delete(id);

  // Nids : éclosions et œufs volés.
  const seenNests = new Set<number>();
  for (const n of p.nests) {
    seenNests.add(n.id);
    const o = d.nests.get(n.id);
    const hatched = n.hatched !== undefined;
    if (o && !first) {
      if (hatched && !o.hatched && n.eggs > 0) emit(s, "hatch", n.sp, n.x, n.y, n.guard);
      else if (!hatched && n.eggs < o.eggs) nestRaid(s, n, byId);
    }
    if (o) { o.eggs = n.eggs; o.hatched = hatched; } else d.nests.set(n.id, { eggs: n.eggs, hatched });
  }
  for (const id of d.nests.keys()) if (!seenNests.has(id)) d.nests.delete(id);

  // Arbres qui tombent : un grand animal les a renversés.
  const fallingNow = new Set<number>();
  for (const t of activeTrees()) {
    if (t.state !== "falling") continue;
    fallingNow.add(t.id);
    if (d.falling.has(t.id) || first) continue;
    let best: Animal | undefined, bd = 260;
    for (const a of p.animals) {
      if (a.task === "dead") continue;
      const dd = Math.hypot(a.x - t.x, (a.y - t.y) * 1.4);
      if (dd < bd) { bd = dd; best = a; }
    }
    if (best && ready(d, `tree:${best.sp}`, now, 120)) emit(s, "tree", best.sp, t.x, t.y, best.id);
  }
  d.falling = fallingNow;
}

function nestRaid(s: GameState, n: Nest, byId: Map<number, Animal>) {
  const d = s.docu;
  if (!ready(d, `theft:${n.id}`, s.time, 25)) return;
  let thief: Animal | undefined;
  for (const a of byId.values()) {
    if (a.mood === "scavenge" && a.task === "feed" && a.targetId === 0 && Math.abs(a.x - n.x) < 220 && Math.abs(a.y - n.y) < 160) { thief = a; break; }
  }
  emit(s, "theft", thief?.sp ?? n.sp, n.x, n.y, thief?.id ?? n.guard, thief ? n.sp : undefined);
}

// --- Réalisation ----------------------------------------------------------------------------------

const alive = (s: GameState, id: number) => (id ? s.park.animals.find((a) => a.id === id) : undefined);

function makeShot(s: GameState, m: Moment | null, a: Animal | undefined, txt: string, score: number): Shot {
  const hold = Math.min(12, 6 + Math.random() * 3 + score * 0.3);
  return { m, subject: a?.id ?? m?.subject ?? 0, sp: a?.sp ?? m?.sp ?? null, x: a?.x ?? m?.x ?? 0, y: (a ? a.y - a.alt : m?.y) ?? 0, text: txt, lines: [], t0: s.time, hold, score, unlocked: false };
}

/** Visite libre : un troupeau ou un animal au hasard, avec un fait du carnet. */
function tourShot(s: GameState): Shot | null {
  const d = s.docu;
  const live = s.park.animals.filter((a) => a.task !== "dead" && a.sp !== d.lastTour);
  const pool = live.length ? live : s.park.animals.filter((a) => a.task !== "dead");
  if (!pool.length) return null;
  // Les troupeaux d'abord.
  const herds = pool.filter((a) => a.herd > 1);
  const a = pick(herds.length && Math.random() < 0.7 ? herds : pool);
  d.lastTour = a.sp;
  const spec = SPECIES[a.sp]!;
  const name = spec.name;
  const intro = a.herd > 2 ? `Voici un groupe ${dePl(name)}. L'un d'eux ${activity(a)}.` : `${cap(le(name))} ${activity(a)}.`;
  const known = spec.facts.filter((f) => s.progress.facts.includes(`${a.sp}:${f.id}`));
  const fact = pick(known.length ? known : spec.facts.filter((f) => f.unlock === "discover"));
  return makeShot(s, null, a, fact ? `${intro} ${fact.text}` : intro, 0);
}

/** Meilleur moment récent pas encore filmé (score moins un malus d'ancienneté). */
function bestMoment(s: GameState): Moment | null {
  // Seuil : en dessous, une visite libre vaut mieux ; même genre de plan que le précédent : malus (variété).
  let best: Moment | null = null, bv = 4.5;
  const last = s.docu.shot?.m?.kind;
  for (const m of s.docu.recent) {
    const age = s.time - m.t;
    if (m.shown || age > 10) continue;
    if (m.subject && !alive(s, m.subject) && m.kind !== "kill" && m.kind !== "oldage") continue;
    const v = m.score - age * 0.3 - (m.kind === last ? 2 : 0);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

function startShot(s: GameState, sh: Shot) {
  const d = s.docu, c = s.park.cam;
  // Sous-titres : 5 lignes au plus (la dernière coupée par « ... » si le texte déborde).
  const all = wrap(sh.text, Math.max(20, Math.min(90, metrics.ucols - 8)));
  sh.lines = all.slice(0, 5);
  if (all.length > 5) sh.lines[4] = `${sh.lines[4].slice(0, Math.max(0, sh.lines[4].length - 3))}...`;
  if (sh.m) { sh.m.shown = true; sh.m.seen = true; }
  d.debug?.("shot", sh.m, sh.text);
  const dx = sh.x - (c.x + viewW() / 2), dy = sh.y - (c.y + viewH() / 2);
  // Loin : coupe franche avec fondu au noir ; près : panoramique.
  if (!d.shot || Math.abs(dx) > viewW() * 0.7 || Math.abs(dy) > viewH() * 0.7) { d.pending = sh; d.cut = CUT; }
  else d.shot = sh;
}

function aim(s: GameState, sh: Shot) {
  const a = alive(s, sh.subject);
  if (a) { sh.x = a.x; sh.y = a.y - a.alt - 20; }
}

function goTo(s: GameState, x: number, y: number) {
  s.park.cam.x = x - viewW() / 2;
  s.park.cam.y = y - viewH() / 2;
}

function stop(s: GameState, why?: string) {
  const d = s.docu;
  d.on = false; d.shot = null; d.pending = null; d.cut = 0;
  if (why) toast(s, "Documentaire arrêté", why);
}

/** Logique (détection des moments forts, caméra). Renvoie true s'il pilote la caméra cette image. */
export function updateDocumentary(s: GameState, input: Input, dt: number): boolean {
  const d = s.docu, p = s.park;
  // Jours de la réserve : l'horloge repasse par minuit.
  if (d.lastClock >= 0 && s.clock < d.lastClock - 12) d.day++;
  d.lastClock = s.clock;

  d.poll -= dt;
  if (d.poll <= 0) { d.poll = POLL; scan(s); }

  for (const id of input.ui) {
    if (id === "docu:toggle") toggle(s);
    else if (id === "docu:list") d.listOpen = !d.listOpen;
    else if (id === "docu:seen") { for (const m of d.log) m.seen = true; }
    else if (id.startsWith("docu:go:")) {
      const m = d.log.find((e) => e.id === Number(id.slice(8)));
      if (!m) continue;
      m.seen = true;
      d.listOpen = false;
      if (d.on) stop(s);
      const a = alive(s, m.subject);
      if (a && a.task !== "dead") {
        goTo(s, a.x, a.y - a.alt);
        p.selected = a.id; p.follow = true; p.nestSel = undefined; p.bug = undefined;
      } else { goTo(s, m.x, m.y); p.follow = false; }
    }
  }
  if (input.pressed.includes("KeyV")) toggle(s);
  if (!d.on) return false;

  // Le joueur reprend la caméra : le documentaire s'arrête.
  const m = input.mouse;
  if (input.dx || input.dy || (m.down && (m.dragX || m.dragY)) || m.wheel || input.worldClicks.length) {
    stop(s, "Tu as repris la caméra. Touche V pour relancer.");
    return false;
  }
  p.follow = false;

  // Coupe : fondu au noir, saut de caméra au milieu, retour de l'image.
  if (d.cut > 0) {
    const was = d.cut;
    d.cut = Math.max(0, d.cut - dt);
    if (was > CUT / 2 && d.cut <= CUT / 2 && d.pending) {
      d.shot = d.pending; d.pending = null;
      d.shot.t0 = s.time;
      aim(s, d.shot);
      goTo(s, d.shot.x, d.shot.y);
    }
    if (d.cut > CUT / 2) return true;
  }

  const sh = d.shot;
  const el = sh ? s.time - sh.t0 : 0;
  const next = bestMoment(s);
  if (!sh || el > sh.hold || (next && el > 4 && next.score >= sh.score + 3)) {
    let n: Shot | null = null;
    if (next) n = makeShot(s, next, alive(s, next.subject), next.text, next.score);
    else if (!sh || el > sh.hold) n = tourShot(s);
    if (n) { aim(s, n); startShot(s, n); }
  }
  const cur = d.shot;
  if (!cur) return true;
  aim(s, cur);
  // Panoramique doux (plus lent en visite libre).
  const k = Math.min(1, dt * (cur.m ? 2.2 : 0.8));
  p.cam.x += (cur.x - viewW() / 2 - p.cam.x) * k;
  p.cam.y += (cur.y - viewH() / 2 - p.cam.y) * k;
  // Regarder le moment assez longtemps remplit le carnet, comme un clic d'observation.
  if (!cur.unlocked && s.time - cur.t0 > 2.5 && cur.m?.trigger && cur.sp) {
    cur.unlocked = true;
    unlockTrigger(s, cur.sp, cur.m.trigger);
  }
  return true;
}

function toggle(s: GameState) {
  const d = s.docu;
  if (d.on) { stop(s); return; }
  d.on = true; d.shot = null; d.pending = null; d.cut = 0; d.since = s.time; d.listOpen = false;
  s.park.follow = false;
}

// --- Dessin ---------------------------------------------------------------------------------------

/** Nombre de moments manqués (badge du bouton « Moments » de la barre d'outils). */
export const missedCount = (s: GameState) => s.docu.log.reduce((n, m) => n + (m.seen ? 0 : 1), 0);

/** Arrête le documentaire (Échap, bouton). */
export function stopDocumentary(s: GameState) {
  if (s.docu.on) stop(s);
}

/**
 * Mode documentaire : bandes noires, REC, bouton Arrêter, sous-titres. Hors tournage, rien : le bouton
 * et le journal des moments sont dans la barre d'outils de la réserve (voir park.ts, drawDocuLog).
 */
export function drawDocumentary(s: GameState, th: Theme, ui: Frame): void {
  const d = s.docu, u = th.ui;
  if (!d.on) return;
  const top = UI_TOP, bot = ui.rows - 8;
  fill(ui, 0, top, ui.cols, 3, BLACK, 0.82);
  fill(ui, 0, bot, ui.cols, 7, BLACK, 0.82);
  // REC (clignotant, sauf animations réduites) et horodatage.
  if (calm() || Math.floor(s.time * 1.4) % 2 === 0) text(ui, 2, top + 1, "(o)", RED, BLACK, 0.82);
  text(ui, 6, top + 1, `REC  J${d.day} ${clockLabel(s.clock)}`, u.text, BLACK, 0.82);
  const title = "Paléoglyphes — Documentaire";
  const tw = title.length;
  const bx = 24;
  const w = button(ui, th, "docu:toggle", bx, top + 1, "Arrêter", { key: "V", variant: "primary", tip: "Arreter le documentaire (V ou Echap)" });
  const tx = Math.max(bx + w + 3, Math.floor((ui.cols - tw) / 2));
  // Carton de titre appuyé au début, discret ensuite.
  if (tx + tw < ui.cols - 24) text(ui, tx, top + 1, title, s.time - d.since < 4 ? u.hi : u.dim, BLACK, 0.82);
  const sh = d.shot;
  if (sh && d.cut <= CUT / 2) {
    const shown = Math.floor((s.time - sh.t0) * 50);
    let left = shown;
    const y0 = bot + 1 + Math.max(0, Math.floor((5 - sh.lines.length) / 2));
    for (let i = 0; i < sh.lines.length && left > 0; i++) {
      const l = sh.lines[i];
      const part = left >= l.length ? l : l.slice(0, left);
      left -= l.length + 1;
      text(ui, Math.max(0, Math.floor((ui.cols - l.length) / 2)), y0 + i, part.slice(0, ui.cols), i === 0 && sh.m ? u.hi : u.text, BLACK, 0.82);
    }
    // Durée du plan : un fin trait dans la bande du haut.
    const n = Math.round(Math.min(1, (s.time - sh.t0) / sh.hold) * 20);
    for (let i = 0; i < 20; i++) put(ui, ui.cols - 23 + i, top + 2, i < n ? 45 : 46, i < n ? u.dim : u.border, BLACK, 0.82);
  }
  if (d.cut > 0) {
    const f = 1 - Math.abs(d.cut - CUT / 2) / (CUT / 2);
    fill(ui, 0, top, ui.cols, ui.rows - top - 1, BLACK, Math.min(1, f * 1.1));
  }
}

/** Journal des moments manqués (menu déroulant) : le plus récent en haut, un clic pour y aller. */
export function drawDocuLog(s: GameState, th: Theme, ui: Frame, x: number, y: number) {
  const d = s.docu, u = th.ui;
  if (!d.log.length) return;
  let W = Math.min(76, ui.cols - x - 2);
  // Trop près du bord droit : le menu s'appuie sur la droite de l'écran.
  if (W < 40) { W = Math.min(76, ui.cols - 4); x = ui.cols - W - 2; }
  const rows = Math.max(1, Math.min(d.log.length, ui.rows - y - 6, 14));
  const H = rows + 4;
  panel(ui, th, x, y, W, H, "Moments manqués", { close: "docu:list", overlay: true });
  for (let i = 0; i < rows; i++) {
    const m = d.log[d.log.length - 1 - i];
    const ly = y + 1 + i;
    const head = `${m.seen ? " " : "*"} J${m.day} ${clockLabel(m.clock)} `;
    text(ui, x + 1, ly, head, m.seen ? u.dim : u.hi, u.panel, u.alpha);
    const room = W - 3 - head.length;
    const body = m.text.length > room ? `${m.text.slice(0, room - 3)}...` : m.text;
    text(ui, x + 1 + head.length, ly, body, m.seen ? u.dim : u.text, u.panel, u.alpha);
    region(`docu:go:${m.id}`, x + 1, ly, W - 2, 1, { focus: true });
  }
  text(ui, x + 2, y + H - 2, "Clic : aller voir", u.dim, u.panel, u.alpha);
  overlay(() => actions(ui, th, x + 2, y + H - 2, W - 4, [{ id: "docu:seen", label: "Tout marquer vu" }]));
}
