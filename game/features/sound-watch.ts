import { CELL_H, CELL_W } from "../config";
import { daylight } from "../daycycle";
import { SPECIES } from "../species";
import type { Action, Species } from "../species/types";
import type { GameState } from "../state";
import { BIOME } from "../world/biomes";
import { T as METEOR, meteorTime } from "../scenes/meteor";
import { SPACE_DURATION, SPACE_IMPACT } from "../scenes/meteor-space";
import { viewH, viewW, zoomLevel } from "../scenes/park";
import { audible, play, setAmbience, setBed, setMuffle, spatial, type PlayOpts, type Sfx } from "./sound";

/**
 * Ce que le jeu fait entendre : on observe l'état à chaque pas (aucun crochet dans l'IA des animaux).
 * - Réserve : cris quand un animal passe à l'action « call », voix tirée de sa taille et de son groupe ;
 *   coups, mises à mort et envols discrets ; pas lourds des grands animaux près de la caméra ; nids qui
 *   éclosent ; éclairs et tonnerre. Atténuation et panoramique depuis le centre de la caméra ; en vue
 *   carte, les animaux se taisent presque : il reste l'ambiance.
 * - Ambiance du biome sous la caméra (fondu enchaîné), du jour, de la nuit et de la météo.
 * - Fouille, atelier, interface et cinématique de la météorite.
 */

/** Voix d'une espèce, d'après son milieu, son régime et sa masse. */
export type Voice = "trumpet" | "growl" | "rumble" | "honk" | "chirp" | "cry" | "splash";

export function voiceOf(spec: Species): Voice {
  if (spec.habitat === "sea") return "splash";
  if (spec.habitat === "air") return "cry";
  // Hadrosaure : la crête creuse sert de caisse de résonance.
  if (spec.id === "edmonto") return "trumpet";
  if (spec.behavior.diet !== "herbivore") return spec.massKg < 500 ? "chirp" : "growl";
  return spec.massKg > 15000 ? "rumble" : "honk";
}

/** Hauteur de base (Hz) : plus l'animal est lourd, plus il est grave ; un petit (growth < 1) est plus aigu. */
export const pitchOf = (spec: Species, growth = 1) => (110 * Math.pow(1000 / spec.massKg, 1 / 6)) / Math.sqrt(Math.max(0.3, growth));

// ---------------------------------------------------------------------------
// Mémoire de l'observateur
// ---------------------------------------------------------------------------

const animals = new Map<number, { action: Action; step: number; gen: number }>();
const nests = new Map<number, boolean>();
let gen = 0;
/** Pas silencieux : on note l'état sans rien jouer (premier pas, retour du son après une coupure). */
let quiet = true;
const ui = { open: false, index: 0, page: "", help: false };
const dig = { site: null as unknown, tool: "", shake: -9, got: 0, broken: 0, lx: 0, ly: 0 };
const lab = { flash: null as unknown, shake: null as unknown, synth: null as unknown, done: null as unknown, nest: null as unknown };
const sky = { bolt: -1, boom: -1 };
let meteorT = -1;
/** Poids des biomes sous la caméra (lissés : le fondu enchaîné), indexés par BIOME. */
const mix = [1, 0, 0, 0, 0];
let ambT = 0;

const fire = (name: Sfx, o?: PlayOpts) => { if (!quiet) play(name, o); };

/** Un pas du son. Sans contexte audio (Node) ou son coupé : rien à faire. */
export function updateSound(s: GameState, dt: number) {
  if (!audible()) { quiet = true; return; }
  watchUi(s);
  if (s.mode === "park") { watchPark(s); watchSky(s); }
  else if (s.mode === "dig") watchDig(s);
  else if (s.mode === "lab") watchLab(s);
  if (s.mode === "meteor") watchMeteor();
  else meteorT = -1;
  ambT -= dt;
  if (ambT <= 0) { ambient(s, 0.1 - ambT); ambT = 0.1; }
  quiet = false;
}

function watchUi(s: GameState) {
  const m = s.menu;
  if (ui.open !== m.open || (m.open && (ui.index !== m.index || ui.page !== m.page)) || ui.help !== s.help) fire("tick");
  ui.open = m.open; ui.index = m.index; ui.page = m.page; ui.help = s.help;
}

// ---------------------------------------------------------------------------
// Réserve
// ---------------------------------------------------------------------------

/** Centre et demi-taille de la vue (px monde), et facteur de proximité (vue carte : presque muet). */
function camera(s: GameState) {
  const z = zoomLevel(s), w = viewW(s), h = viewH(s);
  return { cx: s.park.cam.x + w / 2, cy: s.park.cam.y + h / 2, hw: w / 2, hh: h / 2, near: z.m > 1 ? 0.2 / z.m : 0.8 + 0.2 * z.z };
}

function watchPark(s: GameState) {
  const cam = camera(s);
  const at = (x: number, y: number, k: number) => {
    const sp = spatial(x, y, cam.cx, cam.cy, cam.hw, cam.hh);
    return { gain: sp.gain * k * cam.near, pan: sp.pan };
  };
  const tundra = s.weather.viewBiome === BIOME.Tundra;
  gen++;
  for (const a of s.park.animals) {
    const spec = SPECIES[a.sp];
    if (!spec) continue;
    const k = Math.floor(a.walk / Math.PI);
    const prev = animals.get(a.id);
    if (!prev) { animals.set(a.id, { action: a.action, step: k, gen }); continue; }
    prev.gen = gen;
    if (a.action !== prev.action) {
      const pos = at(a.x, a.y - a.alt, 1);
      // Clé par espèce : deux espèces peuvent se répondre, un troupeau ne crie pas en chœur.
      if (a.action === "call") fire(voiceOf(spec), { ...pos, p: pitchOf(spec, a.growth), key: a.sp });
      else if (a.action === "attack") fire(spec.habitat === "sea" ? "splash" : "strike", { ...pos, gain: pos.gain * 0.7 });
      else if (a.action === "dead") fire("thud", { ...pos, gain: pos.gain * 0.6 });
      else if (a.action === "takeoff" && spec.habitat === "air") {
        // Les ptérosaures ne lancent pas l'action « call » : ils crient parfois en s'envolant.
        fire("flap", pos);
        if (Math.random() < 0.4) fire("cry", { ...pos, p: pitchOf(spec, a.growth), key: a.sp });
      }
      prev.action = a.action;
    }
    // Pas lourds : les grands animaux terrestres qui marchent, un pied posé tous les demi-tours de foulée.
    if (k !== prev.step) {
      prev.step = k;
      if (spec.massKg >= 2000 && !spec.habitat && a.alt === 0 && a.moving > 0.4 && a.task !== "dead") {
        const g = at(a.x, a.y, Math.min(1, spec.massKg / 9000) * a.growth);
        // Seulement les pas bien audibles : un pas lointain ne prend pas la place d'un pas proche.
        if (g.gain > 0.03) fire("step", { ...g, p: 34 + 3000 / spec.massKg * 8, key: "step" });
        if (tundra && g.gain > 0.03) fire("crunch", { ...g, gain: g.gain * 0.7 });
      }
    }
  }
  if (gen % 300 === 0) for (const [id, v] of animals) if (v.gen !== gen) animals.delete(id);
  // Éclosions : un nid passe à « éclos » avec encore des œufs.
  for (const n of s.park.nests) {
    const h = n.hatched !== undefined;
    if (nests.get(n.id) === false && h && n.eggs > 0) fire("cheep", at(n.x, n.y, 1.2));
    nests.set(n.id, h);
  }
  if (nests.size > s.park.nests.length + 20) for (const id of nests.keys()) if (!s.park.nests.some((n) => n.id === id)) nests.delete(id);
}

function watchSky(s: GameState) {
  const st = s.weather, b = st.bolt;
  if (b && b.t0 !== sky.bolt) {
    sky.bolt = b.t0;
    const cam = camera(s);
    fire("crack", { ...spatial(b.x * CELL_W, b.y * CELL_H, cam.cx, cam.cy, cam.hw * 2, cam.hh * 2), gain: 0.6 });
  }
  if (st.boomAt !== sky.boom && s.time >= st.boomAt) { sky.boom = st.boomAt; fire("thunder", { pan: (Math.random() - 0.5) * 0.6 }); }
}

// ---------------------------------------------------------------------------
// Fouille et atelier
// ---------------------------------------------------------------------------

function watchDig(s: GameState) {
  const d = s.dig, site = d.site;
  if (!site) return;
  let got = 0, broken = 0;
  for (const f of site.fossils) { if (f.state === "lifting" || f.state === "done") got++; else if (f.state === "broken") broken++; }
  if (site === dig.site) {
    if (d.tool !== dig.tool) fire(d.tool === "loupe" ? "loupe" : "click");
    if (broken > dig.broken) fire("shatter");
    else if (d.shake !== dig.shake) fire("tok");
    if (got > dig.got) fire("chime");
    // Outil en mouvement sur la roche : coups de pinceau ou de burin.
    if (d.digging && d.last && (d.last.x !== dig.lx || d.last.y !== dig.ly)) fire(d.tool === "pick" ? "chisel" : "brush", { pan: (d.last.x / site.W - 0.5) * 0.8 });
  }
  dig.site = site; dig.tool = d.tool; dig.shake = d.shake; dig.got = got; dig.broken = broken;
  if (d.last) { dig.lx = d.last.x; dig.ly = d.last.y; }
}

function watchLab(s: GameState) {
  const l = s.lab;
  if (l.flash && lab.flash !== l.flash) fire("place");
  if (l.shake && lab.shake !== l.shake) fire("wrong");
  if (l.synth && lab.synth !== l.synth) fire("synth");
  if (l.done && lab.done !== l.done) fire("reveal");
  if (l.nest && lab.nest !== l.nest) fire("cheep");
  lab.flash = l.flash; lab.shake = l.shake; lab.synth = l.synth; lab.done = l.done; lab.nest = l.nest;
}

// ---------------------------------------------------------------------------
// Météorite : approche, impact, débris, onde de choc, silence, puis l'aube
// ---------------------------------------------------------------------------

function watchMeteor() {
  const t = meteorTime(), prev = meteorT;
  meteorT = t;
  // Échap fait sauter la cinématique : on ne rejoue pas d'un coup tout ce qui a été passé.
  if (prev < 0 || t - prev > 0.5) return;
  const crossed = (x: number) => prev < x && t >= x;
  const tp = t - SPACE_DURATION;
  if (crossed(0.8)) fire("approach", { p: SPACE_IMPACT - 0.8 });
  if (crossed(SPACE_IMPACT)) fire("impact");
  if (tp > METEOR.debris && tp < METEOR.shock + 1 && Math.random() < 0.12) fire("debris", { pan: Math.random() * 0.8, gain: 0.7 });
  if (crossed(SPACE_DURATION + METEOR.shock)) fire("roar", { pan: 0.4 });
}

/** Vie de la réserve pendant la cinématique (0 : le noir), 1 hors cinématique. */
function meteorLife(): number {
  if (meteorT < 0) return 1;
  const tp = meteorT - SPACE_DURATION;
  if (tp < 0) return 0;
  if (tp < METEOR.shock) return 1;
  if (tp < METEOR.dawn) return 0;
  return Math.min(1, (tp - METEOR.dawn) / 5);
}

// ---------------------------------------------------------------------------
// Ambiance
// ---------------------------------------------------------------------------

/** Poids des biomes visibles : neuf points de la vue (centre, bords, coins). */
function sampleBiomes(s: GameState, out: number[]) {
  out.fill(0);
  const w = s.worlds[s.style];
  if (!w) { out[BIOME.HellCreek] = 1; return; }
  const cam = camera(s);
  for (const fy of [-0.8, 0, 0.8]) for (const fx of [-0.8, 0, 0.8]) {
    const x = Math.floor((cam.cx + fx * cam.hw) / CELL_W), y = Math.floor((cam.cy + fy * cam.hh) / CELL_H);
    const i = Math.max(0, Math.min(w.rows - 1, y)) * w.cols + Math.max(0, Math.min(w.cols - 1, x));
    // Le centre compte double : c'est ce qu'on regarde.
    out[w.biome[i]] += fx === 0 && fy === 0 ? 3 : 1;
  }
  for (let b = 0; b < out.length; b++) out[b] /= 11;
}

const target = [0, 0, 0, 0, 0];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function ambient(s: GameState, dt: number) {
  const outdoor = s.mode === "park" || s.mode === "meteor";
  // Écrans d'intérieur : un souffle de vent sur la falaise de fouille, le silence ailleurs.
  if (!outdoor) {
    setAmbience(s.menu.open ? 0.5 : 1);
    setMuffle(18000);
    for (const b of ["hiss", "surf", "rain", "buzz"] as const) setBed(b, 0);
    setBed("wind", s.mode === "dig" ? 0.05 : 0, 380);
    return;
  }
  const life = meteorLife();
  sampleBiomes(s, target);
  const a = Math.min(1, dt * 0.8);
  for (let b = 0; b < mix.length; b++) mix[b] += (target[b] - mix[b]) * a;
  const [hell, swamp, tundra, desert, sea] = mix;
  const v = s.weather.view, day = daylight(s.clock), night = 1 - day;
  const map = zoomLevel(s).m > 1;
  const t = s.time;
  // Rafales : deux sinus lents, plus forts dans l'orage, la toundra et le désert.
  const gust = clamp01(0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1));
  const windy = 0.04 + tundra * 0.16 + desert * 0.1 + sea * 0.04 + v.storm * 0.3 + v.snow * 0.08;
  // Ressac : une houle de ~7 s ; près de la côte (mer et terre à l'écran), les vagues se brisent.
  const swell = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 0.21 + 2);
  const coast = clamp01(4 * sea * (1 - sea));
  setAmbience((s.menu.open ? 0.5 : 1) * life, life === 0 ? 0.15 : 0.8);
  setBed("wind", windy * (0.5 + gust), 300 + 500 * gust + tundra * 400 + v.storm * 300);
  setBed("hiss", desert * (0.025 + 0.05 * gust + 0.03 * v.heat), undefined);
  setBed("surf", (sea * 0.12 + coast * 0.25) * swell, 380 + coast * 500 + swell * 200, 0.5);
  setBed("rain", Math.max(v.rain * 0.3, v.storm * 0.35), 2200 + v.storm * 800);
  setBed("buzz", (swamp * 0.025 + hell * 0.01) * day * (1 - v.rain) * (1 - tundra), 480 + gust * 120);
  // La neige et le brouillard étouffent tout.
  setMuffle(18000 * (1 - 0.85 * clamp01(Math.max(v.snow, s.weather.viewSnow * 0.25, v.fog * 0.4))));
  // Petites bêtes : des événements au hasard, selon le biome et l'heure (moins nombreux en vue carte).
  const k = (map ? 0.4 : 1) * life * dt;
  const dawn = meteorT >= 0 ? 3 : 1;
  const dry = 1 - v.rain * 0.7;
  const bit = (name: Sfx, rate: number, gain: number) => {
    if (Math.random() < rate * k) fire(name, { gain, pan: (Math.random() - 0.5) * 1.6, amb: true });
  };
  bit("bird", day * (hell * 0.5 + swamp * 0.25 + desert * 0.05) * dry * dawn, 0.8);
  bit("cricket", night * (hell * 1.5 + swamp * 0.8 + desert * 0.6), 0.9);
  bit("frog", (night * (hell * 0.4 + swamp * 1.2) + day * swamp * 0.2) * (1 + v.rain), 0.8);
  bit("drip", swamp * 0.6 + v.rain * 0.3 * (1 - tundra), 0.7);
  bit("crunch", tundra * 0.12, 0.35);
}
