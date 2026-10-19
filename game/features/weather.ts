import { createNoise2D } from "simplex-noise";
import { CELL_H, CELL_W, DEV } from "../config";
import { DAY_SECONDS, daylight } from "../daycycle";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { hash2, mulberry32 } from "../rng";
import { worldFor, type GameState } from "../state";
import { calm } from "../settings";
import { put, region, text } from "../ui/kit";
import { toast } from "../ui/toast";
import { BIOME } from "../world/biomes";
import type { World } from "../world/generate";
import { T, isWater } from "../world/tiles";
import { knockTree, type Tree } from "../world/trees";

/**
 * Saisons, météo et événements rares de la réserve.
 *
 * - Une année dure YEAR_DAYS jours de réserve : saison des pluies (orages, verdure), fin des pluies,
 *   saison sèche (chaleur, végétation jaunie, mares plus basses, tourbillons de poussière), retour des pluies.
 * - Le ciel du moment (`Sky`) fixe des cibles d'intensité (nuages, pluie, orage, neige, brouillard,
 *   chaleur) que les niveaux rejoignent en douceur : les transitions sont progressives.
 * - Événements rares (notification + note éducative) : incendie après la foudre, crue, canicule,
 *   coup de froid (neige !), pluie d'étoiles filantes.
 * - Tout le dessin est déterministe (hachage de la position et du temps), sans allocation par cellule.
 *   Les particules vivent dans le monde (elles restent en place quand la caméra bouge), sauf les
 *   étoiles filantes, dessinées dans le ciel (écran).
 *
 * Temps : la météo avance en temps de réserve (dt déjà multiplié par la vitesse de l'horloge) ;
 * les animations (gouttes, éclairs) suivent le temps réel `s.time`.
 *
 * À brancher dans l'IA (voir les accesseurs en bas de fichier) : `plantGrowth`, `thirstRate`,
 * `seasonName`, `isRaining`, `isStorm`, `temperature`. Clic sur le panneau : `weatherClick`.
 */

/** Jours de réserve par année (6 jours = 48 min à x1, 3 min à x16). */
export const YEAR_DAYS = 6;
/** Position dans l'année au lancement (début de la saison des pluies). */
const YEAR_START = 0.06;

export type Sky = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "heat";
type Rare = "heatwave" | "coldsnap" | "meteors";

/** Intensités 0..1 de chaque phénomène (suivent les cibles du ciel courant). */
interface Levels {
  cloud: number;
  rain: number;
  storm: number;
  snow: number;
  fog: number;
  heat: number;
}

const TARGET: Record<Sky, Levels> = {
  clear: { cloud: 0.05, rain: 0, storm: 0, snow: 0, fog: 0, heat: 0 },
  cloudy: { cloud: 0.75, rain: 0, storm: 0, snow: 0, fog: 0, heat: 0 },
  rain: { cloud: 0.85, rain: 0.7, storm: 0, snow: 0, fog: 0, heat: 0 },
  storm: { cloud: 1, rain: 1, storm: 1, snow: 0, fog: 0, heat: 0 },
  snow: { cloud: 0.7, rain: 0, storm: 0, snow: 0.9, fog: 0, heat: 0 },
  fog: { cloud: 0.3, rain: 0, storm: 0, snow: 0, fog: 1, heat: 0 },
  heat: { cloud: 0, rain: 0, storm: 0, snow: 0, fog: 0, heat: 1 },
};

const SKY_LABEL: Record<Sky, string> = {
  clear: "Ciel dégagé", cloudy: "Nuageux", rain: "Pluie", storm: "Orage", snow: "Neige", fog: "Brouillard", heat: "Chaleur sèche",
};
/** Icône ASCII (3 caractères) et sa couleur. */
const SKY_ICON: Record<Sky, [string, RGB]> = {
  clear: ["-O-", [255, 196, 64]],
  cloudy: ["(~)", [170, 180, 196]],
  rain: ["'/'", [110, 170, 235]],
  storm: ["/Z/", [255, 230, 90]],
  snow: ["*.*", [225, 238, 255]],
  fog: ["=-=", [190, 196, 205]],
  heat: ["\\O/", [255, 130, 40]],
};

/** Ordre du forçage de test (clic sur le panneau, DEV seulement). */
const FORCE = ["auto", "clear", "cloudy", "rain", "storm", "snow", "fog", "heat", "incendie", "crue", "etoiles"] as const;

/** Un arbre qui brûle (ou fume encore après sa chute). */
interface Fire {
  tree: Tree;
  t: number;
  /** Éteint par la pluie : il fume un peu, ne brûle plus. */
  out: boolean;
}

/** Un éclair : point d'impact (cellules monde), début (temps réel), graine du tracé. */
interface Bolt {
  x: number;
  y: number;
  t0: number;
  seed: number;
}

export interface WeatherState {
  ready: boolean;
  /** Jours de réserve écoulés (on compte les passages de minuit). */
  day: number;
  prevClock: number;
  kind: Sky;
  /** Temps de réserve restant avant le prochain changement de ciel (s). */
  timer: number;
  lv: Levels;
  /** Compteur du tirage déterministe. */
  seed: number;
  /** Neige au sol, sol mouillé (flaques) : 0..1. */
  snowCover: number;
  wet: number;
  /** Crue : temps écoulé depuis le début (s de réserve), -1 sans crue. */
  floodT: number;
  event: Rare | null;
  eventT: number;
  fires: Fire[];
  /** Arbres touchés par l'incendie en cours (plafonné) et pluie reçue depuis le départ du feu. */
  burned: number;
  douse: number;
  bolt: Bolt | null;
  nextBolt: number;
  /** Tonnerre : « BOOM » affiché à partir de cet instant (temps réel). */
  boomAt: number;
  /** Saison affichée (pour annoncer les changements). */
  season: number;
  /** Forçage de test (index dans FORCE), 0 = automatique. */
  force: number;
  /**
   * Ce que voit la caméra : la météo globale vue à travers le biome au centre de l'écran (neige au lieu
   * de pluie en toundra, sécheresse et chaleur au désert, brume au marais), et la neige au sol vue.
   * Sert au dessin et à la température ; la simulation (plantes, feux, animaux) garde `lv`.
   */
  view: Levels;
  viewSnow: number;
  viewBiome: number;
}

export function createWeatherState(): WeatherState {
  return {
    ready: false, day: 0, prevClock: 0, kind: "clear", timer: 0,
    lv: { ...TARGET.clear }, seed: 1, snowCover: 0, wet: 0, floodT: -1, event: null, eventT: 0,
    fires: [], burned: 0, douse: 0, bolt: null, nextBolt: 0, boomAt: -1e9, season: -1, force: 0,
    view: { ...TARGET.clear }, viewSnow: 0, viewBiome: BIOME.HellCreek,
  };
}

// ---------------------------------------------------------------------------
// Saisons
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const rnd = (st: WeatherState) => hash2(st.seed++, 7919, 31);

/** Position dans l'année 0..1. */
function yearFrac(s: GameState): number {
  return (((s.weather.day + s.clock / 24) / YEAR_DAYS + YEAR_START) % 1 + 1) % 1;
}
/** Humidité de la saison : 1 au cœur des pluies, 0 au cœur de la saison sèche. */
function seasonWet(s: GameState): number {
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * (yearFrac(s) - 0.19));
}
const SEASONS = ["Saison des pluies", "Fin des pluies", "Saison sèche", "Retour des pluies"];
function seasonIndex(s: GameState): number {
  const f = yearFrac(s);
  return f < 0.36 ? 0 : f < 0.5 ? 1 : f < 0.86 ? 2 : 3;
}
const SEASON_NOTE = [
  "Hell Creek, il y a 66 millions d'années : une plaine côtière chaude et humide, parcourue de rivières. Les orages sont fréquents, tout reverdit.",
  "Les averses s'espacent. Les rivières sont encore hautes, la végétation au plus dense.",
  "Il fait chaud et sec : la végétation jaunit, les mares baissent. Les herbivores doivent marcher plus loin pour boire.",
  "Les premiers orages reviennent : la végétation repart et les mares se remplissent.",
];

/** Jaunissement de la végétation 0..1 (saison sèche + chaleur), effacé par la neige. */
function dryness(s: GameState): number {
  const st = s.weather;
  return clamp01(smooth(0.5, 0.12, seasonWet(s)) * 0.7 + st.view.heat * 0.35) * (1 - st.viewSnow);
}

/** Niveau de crue 0..1 (montée, palier, décrue). */
function floodLevel(st: WeatherState): number {
  const t = st.floodT;
  if (t < 0) return 0;
  return t < 40 ? smooth(0, 40, t) : t < 160 ? 1 : 1 - smooth(160, 300, t);
}

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

function setSky(st: WeatherState, kind: Sky, dur: number) {
  st.kind = kind;
  st.timer = dur;
}

/** Choisit le prochain ciel selon la saison (et déclenche parfois un événement rare). */
function pickSky(s: GameState) {
  const st = s.weather, wet = seasonWet(s);
  const dur = (0.15 + rnd(st) * 0.25) * DAY_SECONDS;
  const was = st.kind;
  if (st.event === "coldsnap") return setSky(st, "snow", Math.min(dur, st.eventT));
  if (st.event === "heatwave") return setSky(st, "heat", Math.min(dur, st.eventT));
  const r = rnd(st);
  // Coup de froid : très rare, un peu moins rare aux changements de saison.
  if (r < 0.025 + 0.02 * (1 - Math.abs(wet - 0.5) * 2)) {
    st.event = "coldsnap"; st.eventT = 0.6 * DAY_SECONDS;
    toast(s, "Coup de froid : il neige !",
      "Rare sous ce climat subtropical. Mais plus au nord, en Alaska, des dinosaures (Edmontosaurus, Pachyrhinosaurus) vivaient sous la neige des hivers polaires du Crétacé.");
    return setSky(st, "snow", dur);
  }
  // Canicule : en pleine saison sèche.
  if (wet < 0.3 && rnd(st) < 0.15) {
    st.event = "heatwave"; st.eventT = DAY_SECONDS;
    toast(s, "Canicule",
      "Le Crétacé était bien plus chaud qu'aujourd'hui : pas de calottes glaciaires, des forêts jusqu'aux pôles. Les animaux cherchent l'eau et l'ombre.");
    return setSky(st, "heat", dur);
  }
  // Brouillard à l'aube, jusqu'au milieu de la matinée.
  if (s.clock > 3.5 && s.clock < 7.5 && rnd(st) < 0.3 + 0.3 * wet) return setSky(st, "fog", (9.5 - s.clock) * (DAY_SECONDS / 24));
  const weights: [Sky, number][] = [
    ["clear", 1 + (1 - wet) * 1.5],
    ["cloudy", 0.8 + wet * 0.6],
    ["rain", 0.1 + wet * 1.4],
    ["storm", 0.03 + wet * 0.7],
    ["heat", (1 - wet) * (1 - wet) * 1.2],
  ];
  let total = 0;
  for (const [, v] of weights) total += v;
  let pick = rnd(st) * total, kind: Sky = "clear";
  for (const [k, v] of weights) { pick -= v; if (pick <= 0) { kind = k; break; } }
  // Après un gros orage de saison des pluies, la rivière peut déborder.
  if (was === "storm" && kind !== "storm" && wet > 0.55 && st.floodT < 0 && rnd(st) < 0.35) startFlood(s);
  setSky(st, kind, kind === "storm" ? dur * 0.6 : dur);
}

function startFlood(s: GameState) {
  s.weather.floodT = 0;
  toast(s, "Crue !",
    "Après des pluies diluviennes, l'eau déborde sur les rives. À Hell Creek, les crues enfouissaient vite les carcasses sous la boue : c'est ainsi que se forment beaucoup de fossiles.");
}

function startMeteors(s: GameState) {
  s.weather.event = "meteors";
  toast(s, "Pluie d'étoiles filantes",
    "De petites poussières qui brûlent en entrant dans l'atmosphère. Rien à voir avec l'astéroïde de Chicxulub qui, lui, mettra fin au Crétacé !");
}

/** Vue courante en cellules monde (pour choisir où frappe la foudre). */
function view(s: GameState) {
  return { x: Math.floor(s.park.cam.x / CELL_W), y: Math.floor(s.park.cam.y / CELL_H), cols: metrics.cols, rows: metrics.rows };
}

const burning = (st: WeatherState, t: Tree) => st.fires.some((f) => f.tree === t);

/** Un arbre debout, visible à l'écran et pas déjà en feu (tiré au sort par `r`). */
function treeInView(s: GameState, w: World, r: number): Tree | undefined {
  const v = view(s);
  const x0 = v.x * CELL_W, y0 = (v.y + 8) * CELL_H, x1 = (v.x + v.cols) * CELL_W, y1 = (v.y + v.rows) * CELL_H;
  const list = w.trees.filter((t) => t.state === "up" && t.x > x0 && t.x < x1 && t.y > y0 && t.y < y1 && !burning(s.weather, t));
  return list.length ? list[Math.floor(r * list.length)] : undefined;
}

function ignite(s: GameState, t: Tree, first: boolean) {
  const st = s.weather;
  st.fires.push({ tree: t, t: 0, out: false });
  st.burned++;
  if (first) {
    toast(s, "Incendie !",
      "La foudre a enflammé un arbre. Les incendies existaient au Crétacé : on retrouve du charbon de bois fossile (fusain) dans les couches de Hell Creek.");
  }
}

/** Éclair : frappe un point de l'écran, parfois un arbre (qui prend feu). */
function strike(s: GameState, w: World, target?: Tree) {
  const st = s.weather, v = view(s);
  let x = v.x + Math.floor((0.1 + 0.8 * rnd(st)) * v.cols), y = v.y + Math.floor((0.35 + 0.6 * rnd(st)) * v.rows);
  const t = target ?? (st.fires.length === 0 && rnd(st) < 0.12 ? treeInView(s, w, rnd(st)) : undefined);
  if (t) {
    x = Math.floor(t.x / CELL_W);
    y = Math.floor(t.y / CELL_H) - 4;
    ignite(s, t, true);
  }
  st.bolt = { x, y, t0: s.time, seed: st.seed };
  st.boomAt = s.time + 0.5 + rnd(st) * 1.1;
}

const BURN = 30, EMBERS = 25, MAX_BURN = 10;

function updateFires(s: GameState, w: World, dt: number) {
  const st = s.weather;
  if (!st.fires.length) { st.burned = 0; st.douse = 0; return; }
  // La pluie finit par éteindre le feu.
  if (st.lv.rain > 0.4) st.douse += dt * st.lv.rain;
  if (st.douse > 10 && st.fires.some((f) => !f.out && f.t < BURN)) {
    for (const f of st.fires) if (f.t < BURN) { f.out = true; f.t = BURN + EMBERS - 8; }
    toast(s, "Incendie éteint", "La pluie a eu raison des flammes. La forêt repoussera.");
  }
  for (let n = st.fires.length - 1; n >= 0; n--) {
    const f = st.fires[n];
    if (!w.trees.includes(f.tree)) { st.fires.splice(n, 1); continue; }
    f.t += dt;
    // Calciné : l'arbre s'effondre (puis souche, puis repousse : voir trees.ts).
    if (!f.out && f.t >= BURN && f.tree.state === "up") knockTree(w, f.tree, hash2(f.tree.id, 3, 5) < 0.5 ? -1 : 1);
    // Le feu gagne lentement l'arbre voisin (contenu : MAX_BURN arbres au plus, pas sous la pluie).
    if (!f.out && f.t > 5 && f.t < BURN && st.burned < MAX_BURN && st.lv.rain < 0.3 && rnd(st) < dt * 0.07 * (1 + st.lv.heat)) {
      let best: Tree | undefined, bd = 170 * 170;
      for (const t of w.trees) {
        if (t.state !== "up" || burning(st, t)) continue;
        const d = (t.x - f.tree.x) ** 2 + ((t.y - f.tree.y) * 1.5) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      if (best) ignite(s, best, false);
    }
    if (f.t > BURN + EMBERS) st.fires.splice(n, 1);
  }
}

/** Avance la météo (temps de la réserve, déjà multiplié par la vitesse de l'horloge). */
export function updateWeather(s: GameState, dt: number): void {
  const st = s.weather;
  const w = worldFor(s);
  if (!st.ready) {
    st.ready = true;
    st.prevClock = s.clock;
    st.season = seasonIndex(s);
    setSky(st, "clear", 0.2 * DAY_SECONDS);
    return;
  }
  // Jours : on compte les passages de minuit.
  if (s.clock < st.prevClock - 12) st.day++;
  const prev = st.prevClock;
  st.prevClock = s.clock;

  // Changement de saison.
  const si = seasonIndex(s);
  if (si !== st.season) {
    st.season = si;
    if (si === 0 || si === 2) toast(s, SEASONS[si], SEASON_NOTE[si]);
  }

  // Événements en cours.
  if (st.event && st.event !== "meteors") { st.eventT -= dt; if (st.eventT <= 0) { st.event = null; st.timer = 0; } }
  if (st.event === "meteors" && daylight(s.clock) > 0.5) st.event = null;
  // Nuit claire : parfois une pluie d'étoiles filantes.
  if (prev < 21 && s.clock >= 21 && !st.event && st.lv.cloud < 0.4 && rnd(st) < 0.18) startMeteors(s);
  // Brouillard qui se lève à l'aube.
  if (!st.force && prev < 4.5 && s.clock >= 4.5 && (st.kind === "clear" || st.kind === "cloudy") && !st.event && rnd(st) < 0.3 + 0.3 * seasonWet(s)) {
    setSky(st, "fog", 5 * (DAY_SECONDS / 24));
  }
  if (st.floodT >= 0) { st.floodT += dt; if (st.floodT > 300) st.floodT = -1; }

  // Ciel : nouveau tirage à l'échéance (sauf forçage de test).
  if (!st.force) { st.timer -= dt; if (st.timer <= 0) pickSky(s); }

  // Les niveaux rejoignent en douceur les cibles du ciel (plus vite en forçage de test).
  const tau = st.force ? 3 : 25;
  const a = 1 - Math.exp(-dt / tau);
  const tg = TARGET[st.kind];
  // Orage de saison sèche : moins de pluie (orage sec, propice aux incendies).
  const stormRain = st.kind === "storm" ? 0.55 + 0.45 * seasonWet(s) : tg.rain;
  st.lv.cloud += (tg.cloud - st.lv.cloud) * a;
  st.lv.rain += (stormRain - st.lv.rain) * a;
  st.lv.storm += (tg.storm - st.lv.storm) * a;
  st.lv.snow += (tg.snow - st.lv.snow) * a;
  st.lv.fog += (tg.fog - st.lv.fog) * a;
  st.lv.heat += (tg.heat - st.lv.heat) * a;

  // Sol : neige qui s'accumule puis fond, flaques qui sèchent.
  const acc = st.force ? 6 : 1;
  if (st.lv.snow > 0.3) st.snowCover = Math.min(1, st.snowCover + (dt * st.lv.snow * acc) / 120);
  else st.snowCover = Math.max(0, st.snowCover - (dt * acc * (1 + st.lv.heat * 2)) / 160);
  if (st.lv.rain > 0.2) st.wet = Math.min(1, st.wet + (dt * st.lv.rain * acc) / 60);
  else st.wet = Math.max(0, st.wet - (dt * acc * (1 + st.lv.heat * 2)) / 200);

  localize(s, dt);

  // Foudre (temps réel : un éclair toutes les quelques secondes à l'écran).
  if (st.lv.storm > 0.55 && s.time >= st.nextBolt) {
    if (st.nextBolt > 0) strike(s, w);
    st.nextBolt = s.time + (3 + rnd(st) * 8) / st.lv.storm;
  }
  if (st.bolt && s.time - st.bolt.t0 > 2) st.bolt = null;
  updateFires(s, w, dt);
}

/** Clic sur le panneau météo (DEV) : force tour à tour chaque ciel et chaque événement. Renvoie true si traité. */
/** Niveaux vus par la caméra (voir WeatherState.view). */
const seen = (s: GameState): Levels => s.weather.view;

/** Météo locale : le biome au centre de l'écran transforme la météo globale (transition en douceur). */
function localize(s: GameState, dt: number) {
  const st = s.weather, L = st.lv, w = worldFor(s);
  const cx = Math.floor((s.park.cam.x + (metrics.cols * metrics.cellW) / 2) / CELL_W);
  const cy = Math.floor((s.park.cam.y + (metrics.rows * metrics.cellH) / 2) / CELL_H);
  const b = cx >= 0 && cy >= 0 && cx < w.cols && cy < w.rows ? w.biome[cy * w.cols + cx] : BIOME.HellCreek;
  st.viewBiome = b;
  const tg: Levels = { ...L };
  let snowCover = st.snowCover;
  if (b === BIOME.Tundra) {
    // Alaska : ce qui tombe tombe en neige ; jamais de canicule.
    tg.snow = Math.max(L.snow, L.rain * 0.9, L.cloud * 0.25);
    tg.rain = 0; tg.storm = 0; tg.heat = 0; tg.cloud = Math.max(L.cloud, 0.3);
    snowCover = Math.max(st.snowCover, 0.35 + 0.65 * tg.snow); // poudrée par beau temps, blanche quand il neige
  } else if (b === BIOME.Desert) {
    // Gobi : presque pas de pluie, chaleur sèche (le soir, elle retombe vite : voir temperature()).
    tg.rain = L.rain * 0.2; tg.storm = L.storm * 0.2; tg.snow = 0; tg.fog = 0;
    tg.cloud = L.cloud * 0.5; tg.heat = Math.max(L.heat, 0.5);
    snowCover = 0;
  } else if (b === BIOME.Swamp) {
    // Marais : brume sur l'eau, averses plus fortes.
    tg.fog = Math.max(L.fog, 0.3); tg.rain = Math.min(1, L.rain * 1.2);
  }
  const a = Math.min(1, dt * 0.5), v = st.view;
  v.cloud += (tg.cloud - v.cloud) * a; v.rain += (tg.rain - v.rain) * a; v.storm += (tg.storm - v.storm) * a;
  v.snow += (tg.snow - v.snow) * a; v.fog += (tg.fog - v.fog) * a; v.heat += (tg.heat - v.heat) * a;
  st.viewSnow += (snowCover - st.viewSnow) * a;
}

export function weatherClick(s: GameState, id: string): boolean {
  if (id !== "weather:panel" || !DEV) return false;
  forceWeather(s, FORCE[(s.weather.force + 1) % FORCE.length]);
  return true;
}

/** Forçage de test : un ciel, un événement (« incendie », « crue », « etoiles ») ou « auto ». */
export function forceWeather(s: GameState, name: (typeof FORCE)[number]) {
  const st = s.weather, w = worldFor(s);
  st.force = FORCE.indexOf(name);
  st.event = null;
  if (name === "auto") { st.force = 0; st.timer = 0; return; }
  if (name === "incendie") {
    setSky(st, "heat", 1e9);
    const t = treeInView(s, w, rnd(st));
    if (t) strike(s, w, t);
  } else if (name === "crue") {
    setSky(st, "rain", 1e9);
    startFlood(s);
  } else if (name === "etoiles") {
    setSky(st, "clear", 1e9);
    s.clock = 22;
    st.prevClock = 22;
    startMeteors(s);
  } else setSky(st, name, 1e9);
}

// ---------------------------------------------------------------------------
// Thème
// ---------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Teinte le thème éclairé selon la météo (ciel couvert, orage...). */
export function weatherTheme(s: GameState, th: Theme): Theme {
  const st = s.weather;
  if (!st.ready) return th;
  const lv = seen(s);
  const over = clamp01(Math.max(lv.cloud * 0.55, lv.rain * 0.75, lv.storm * 0.95, lv.snow * 0.5, lv.fog * 0.45));
  const tint = th.lightTint;
  let r = lerp(tint[0], 0.78, over * 0.6), g = lerp(tint[1], 0.84, over * 0.6), b = lerp(tint[2], 0.95, over * 0.6);
  // Chaleur : lumière blanche et dorée ; neige : lumière froide et réfléchie.
  r *= 1 + lv.heat * 0.06; b *= 1 - lv.heat * 0.14;
  r = lerp(r, 0.92, lv.snow * 0.4); g = lerp(g, 0.96, lv.snow * 0.4); b = lerp(b, 1.05, lv.snow * 0.4);
  return {
    ...th,
    ambient: th.ambient * (1 - over * 0.38) + st.snowCover * 0.06 + lv.heat * 0.04,
    lightTint: [r, g, b],
    vignette: [th.vignette[0] - over * 0.15 - lv.fog * 0.2, th.vignette[1] - lv.fog * 0.2],
    fog: lv.fog > 0.3 ? "mist" : th.fog,
  };
}

// ---------------------------------------------------------------------------
// Champs précalculés par monde : creux du terrain (flaques, congères, nuages) et distance à l'eau (crue)
// ---------------------------------------------------------------------------

const FLOOD_MAX = 12;
const fields = new WeakMap<World, { low: Uint8Array; dist: Uint8Array }>();
function fieldsFor(w: World) {
  let fl = fields.get(w);
  if (fl) return fl;
  const n = w.cols * w.rows;
  const low = new Uint8Array(n), dist = new Uint8Array(n).fill(255);
  const noise = createNoise2D(mulberry32(77));
  for (let y = 0; y < w.rows; y++) for (let x = 0; x < w.cols; x++) {
    const v = noise(x * 0.035, y * 0.06) * 0.7 + noise(x * 0.11, y * 0.19) * 0.3;
    low[y * w.cols + x] = Math.max(0, Math.min(255, Math.round(128 + v * 127)));
  }
  // Distance (en cellules, 4-voisins) à l'eau, plafonnée : parcours en largeur.
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (isWater(w.terrain[i])) { dist[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++], d = dist[i];
    if (d >= FLOOD_MAX) continue;
    const x = i % w.cols;
    for (const j of [x > 0 ? i - 1 : -1, x < w.cols - 1 ? i + 1 : -1, i - w.cols, i + w.cols]) {
      if (j < 0 || j >= n || dist[j] !== 255) continue;
      dist[j] = d + 1;
      q[tail++] = j;
    }
  }
  fl = { low, dist };
  fields.set(w, fl);
  return fl;
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

const SNOW: RGB = [236, 242, 252];
const RAIN: RGB = [190, 212, 240];
const BOLT: RGB = [235, 242, 255];
const FLAME: RGB[] = [[255, 228, 110], [255, 150, 40], [230, 70, 30]];
const SMOKE: RGB = [120, 118, 116];

/** Gust() de compose.ts (non exporté) : même souffle, pour que la pluie penche avec les plantes. */
const gust = (t: number) => 0.45 + 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1);

/** Lumière d'une cellule pour une particule : jamais tout à fait noire (on voit la pluie la nuit). */
const lightAt = (f: Frame, i: number) => Math.min(1.15, 0.35 + ((f.lr[i] + f.lg[i] + f.lb[i]) / 3) * 0.8);

/** Pose un glyphe coloré (écran), fondu `a` vers sa couleur ; bg facultatif (`ab`). */
function plot(f: Frame, x: number, y: number, ch: number, c: RGB, a: number, k = lightAt(f, y * f.cols + x), ab = 0) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = y * f.cols + x, q = i * 4;
  f.ch[i] = ch;
  f.fg[q] += (c[0] * k - f.fg[q]) * a; f.fg[q + 1] += (c[1] * k - f.fg[q + 1]) * a; f.fg[q + 2] += (c[2] * k - f.fg[q + 2]) * a;
  if (ab > 0) { f.bg[q] += (c[0] * k - f.bg[q]) * ab; f.bg[q + 1] += (c[1] * k - f.bg[q + 1]) * ab; f.bg[q + 2] += (c[2] * k - f.bg[q + 2]) * ab; }
}
/** La cellule écran (x, y) existe-t-elle ? */
const inside = (f: Frame, x: number, y: number) => x >= 0 && y >= 0 && x < f.cols && y < f.rows;

/** Dessine pluie, neige, éclairs... par-dessus le calque monde de la réserve. */
export function drawWeather(s: GameState, th: Theme, world: Frame, camX: number, camY: number): void {
  const st = s.weather;
  if (!st.ready) return;
  const w = worldFor(s);
  const fl = fieldsFor(w);
  groundPass(s, th, w, fl, world, camX, camY);
  shimmerPass(s, world, camY);
  rainPass(s, w, fl, world, camX, camY);
  snowPass(s, world, camX, camY);
  dustPass(s, th, world, camX, camY);
  firePass(s, w, world, camX, camY);
  meteorPass(s, world);
  boltPass(s, world, camX, camY);
}

/**
 * Passe par cellule (une seule boucle) : crue, boue des mares basses, végétation jaunie, flaques,
 * neige au sol et sur les cimes, brouillard, ombres de nuages. Chaque effet est sauté s'il est nul.
 */
function groundPass(s: GameState, th: Theme, w: World, fl: { low: Uint8Array; dist: Uint8Array }, f: Frame, camX: number, camY: number) {
  const st = s.weather, lv = seen(s), t = s.time, P = th.pal;
  const dry = dryness(s), snowC = st.viewSnow, fog = lv.fog;
  const floodCells = floodLevel(st) * FLOOD_MAX;
  const lowWater = dry * 0.3 * (st.floodT < 0 ? 1 : 0);
  const puddle = st.wet > 0.05 ? 255 - st.wet * 55 : 999;
  const cloud = clamp01((lv.cloud - 0.15) / 0.85) + lv.storm * 0.2;
  if (dry < 0.02 && snowC < 0.01 && fog < 0.02 && floodCells < 0.5 && lowWater < 0.01 && puddle > 255 && cloud < 0.02) return;
  const { cols, rows } = f;
  const mist = P.mistFg, mud = P.dirt[1], mudBg = P.dirt[0];
  const fw: RGB = [lerp(P.waterMid[0], P.dirt[2][0], 0.3), lerp(P.waterMid[1], P.dirt[2][1], 0.3), lerp(P.waterMid[2], P.dirt[2][2], 0.3)];
  const cox = Math.floor(t * 3), coy = Math.floor(t * 1.2);
  for (let y = 0; y < rows; y++) {
    const wy = camY + y;
    if (wy < 0 || wy >= w.rows) continue;
    for (let x = 0; x < cols; x++) {
      const wx = camX + x;
      if (wx < 0 || wx >= w.cols) continue;
      const i = y * cols + x, k = i * 4, wi = wy * w.cols + wx;
      const terr = w.terrain[wi], obj = f.obj[i];
      const L = (f.lr[i] + f.lg[i] + f.lb[i]) / 3;
      if (terr === T.Shallow || terr === T.Deep) {
        // Saison sèche : les bords des mares se découvrent (boue craquelée).
        if (lowWater > 0 && !obj && terr === T.Shallow && w.depth[wi] / 255 < lowWater) {
          const h = hash2(wx, wy, 81);
          f.ch[i] = h < 0.35 ? 46 : h < 0.55 ? 44 : h < 0.65 ? 95 : 32; // . , _
          f.fg[k] = mud[0] * L * 1.2; f.fg[k + 1] = mud[1] * L * 1.2; f.fg[k + 2] = mud[2] * L * 1.2;
          f.bg[k] = mudBg[0] * L * 0.75; f.bg[k + 1] = mudBg[1] * L * 0.75; f.bg[k + 2] = mudBg[2] * L * 0.75;
        }
      } else if (floodCells >= 1 && !obj && fl.dist[wi] <= floodCells) {
        // Crue : eau boueuse sur les rives.
        const wave = Math.sin(wx * 0.3 + t * 1.3 + Math.sin(wy * 0.5 + t * 0.7));
        f.ch[i] = wave > 0.55 ? 126 : wave > -0.1 ? 45 : wave > -0.6 ? 46 : 32; // ~ - .
        const kk = L * (1.7 + 0.4 * wave);
        f.fg[k] = fw[0] * kk; f.fg[k + 1] = fw[1] * kk; f.fg[k + 2] = fw[2] * kk;
        f.bg[k] = fw[0] * L * 0.75; f.bg[k + 1] = fw[1] * L * 0.75; f.bg[k + 2] = fw[2] * L * 0.75;
      } else {
        // Végétation jaunie (saison sèche) : couvert du sol, feuillage un peu moins.
        if (dry > 0.02 && obj !== 2 && (obj === 1 || terr === T.Grass)) {
          const a = dry * (obj ? 0.4 : 0.75);
          const lum = (f.fg[k] + f.fg[k + 1] + f.fg[k + 2]) / 3 * 1.2;
          f.fg[k] += (lum * 1.15 - f.fg[k]) * a; f.fg[k + 1] += (lum * 0.95 - f.fg[k + 1]) * a; f.fg[k + 2] += (lum * 0.45 - f.fg[k + 2]) * a;
        }
        // Flaques dans les creux du sol mouillé.
        if (!obj && fl.low[wi] > puddle) {
          const sh = 0.5 + 0.5 * Math.sin(wx * 0.4 + wy * 0.7 + t * 0.8);
          const c = P.waterShore;
          f.bg[k] += (c[0] * L * 0.55 - f.bg[k]) * 0.7; f.bg[k + 1] += (c[1] * L * 0.55 - f.bg[k + 1]) * 0.7; f.bg[k + 2] += (c[2] * L * 0.55 - f.bg[k + 2]) * 0.7;
          f.ch[i] = sh > 0.85 ? 126 : sh > 0.55 ? 45 : 32; // ~ - (reflet)
          const kk = L * (0.9 + 0.8 * sh);
          f.fg[k] = c[0] * kk; f.fg[k + 1] = c[1] * kk; f.fg[k + 2] = c[2] * kk;
        }
        // Neige : le sol blanchit par plaques (congères dans les creux), les cimes se couvrent.
        if (snowC > 0.01 && obj !== 2) {
          if (!obj) {
            const cov = snowC * 1.25 - 0.25 + (fl.low[wi] / 255 - 0.5) * 0.4;
            const h = hash2(wx, wy, 51);
            if (h < cov) {
              const kk = Math.min(1.15, 0.3 + L * 0.85);
              if (cov - h > 0.35) {
                f.ch[i] = hash2(wx, wy, 52) < 0.8 ? 32 : hash2(wx, wy, 53) < 0.5 ? 46 : 39; // blanc uni, . '
                f.fg[k] = SNOW[0] * kk * 0.85; f.fg[k + 1] = SNOW[1] * kk * 0.85; f.fg[k + 2] = SNOW[2] * kk * 0.9;
                f.bg[k] = SNOW[0] * kk * 0.78; f.bg[k + 1] = SNOW[1] * kk * 0.8; f.bg[k + 2] = SNOW[2] * kk * 0.84;
              } else {
                f.fg[k] += (SNOW[0] * kk - f.fg[k]) * 0.8; f.fg[k + 1] += (SNOW[1] * kk - f.fg[k + 1]) * 0.8; f.fg[k + 2] += (SNOW[2] * kk - f.fg[k + 2]) * 0.8;
                f.bg[k] += (SNOW[0] * kk * 0.7 - f.bg[k]) * 0.45; f.bg[k + 1] += (SNOW[1] * kk * 0.7 - f.bg[k + 1]) * 0.45; f.bg[k + 2] += (SNOW[2] * kk * 0.7 - f.bg[k + 2]) * 0.45;
              }
            }
          } else {
            // Décor : bonnet de neige sur le haut des formes, poudrage léger ailleurs.
            const cap = y > 0 && f.obj[i - cols] !== 1;
            const a = cap ? Math.min(1, snowC * 1.6) : snowC * 0.45;
            const kk = Math.min(1.15, 0.3 + L * 0.85);
            f.fg[k] += (SNOW[0] * kk - f.fg[k]) * a; f.fg[k + 1] += (SNOW[1] * kk - f.fg[k + 1]) * a; f.fg[k + 2] += (SNOW[2] * kk - f.fg[k + 2]) * a;
            if (cap && snowC > 0.4) {
              f.bg[k] += (SNOW[0] * kk * 0.6 - f.bg[k]) * 0.5; f.bg[k + 1] += (SNOW[1] * kk * 0.6 - f.bg[k + 1]) * 0.5; f.bg[k + 2] += (SNOW[2] * kk * 0.6 - f.bg[k + 2]) * 0.5;
            }
          }
        }
      }
      // Brouillard : voile pâle par nappes ; le sol se réduit à des . et : pâles.
      if (fog > 0.02) {
        const a = fog * (0.62 + 0.3 * Math.sin(wx * 0.021 + wy * 0.05 + t * 0.15));
        const kk = Math.min(1, 0.3 + L * 0.8);
        f.fg[k] += (mist[0] * kk - f.fg[k]) * a * 0.65; f.fg[k + 1] += (mist[1] * kk - f.fg[k + 1]) * a * 0.65; f.fg[k + 2] += (mist[2] * kk - f.fg[k + 2]) * a * 0.65;
        f.bg[k] += (mist[0] * kk * 0.75 - f.bg[k]) * a * 0.8; f.bg[k + 1] += (mist[1] * kk * 0.75 - f.bg[k + 1]) * a * 0.8; f.bg[k + 2] += (mist[2] * kk * 0.75 - f.bg[k + 2]) * a * 0.8;
        if (!obj && hash2(wx, wy, 61) < a * 0.9) f.ch[i] = hash2(wx, wy, 62) < 0.6 ? 46 : 58; // . :
      }
      // Ombres des nuages : grandes taches qui glissent (champ des creux, agrandi et décalé).
      if (cloud > 0.02) {
        const cx = ((wx + cox) >> 1) % w.cols, cy = ((wy + coy) >> 1) % w.rows;
        const m = 1 - smooth(120, 175, fl.low[cy * w.cols + cx]) * cloud * 0.32;
        if (m < 0.999) {
          f.fg[k] *= m; f.fg[k + 1] *= m; f.fg[k + 2] *= m;
          f.bg[k] *= m; f.bg[k + 1] *= m; f.bg[k + 2] *= m;
        }
      }
    }
  }
}

/** Chaleur : l'air tremble, certaines lignes du sol glissent d'une cellule. */
function shimmerPass(s: GameState, f: Frame, camY: number) {
  const heat = seen(s).heat * daylight(s.clock);
  if (heat < 0.2) return;
  const t = s.time, { cols, rows } = f;
  for (let y = 0; y < rows; y++) {
    const wy = camY + y;
    if (Math.sin(wy * 0.9 + t * 5) < 1 - heat * 0.25) continue;
    const row = y * cols;
    if (Math.sin(t * 3 + wy) > 0) {
      for (let x = 0; x < cols - 1; x++) if (!f.obj[row + x] && !f.obj[row + x + 1]) f.ch[row + x] = f.ch[row + x + 1];
    } else {
      for (let x = cols - 1; x > 0; x--) if (!f.obj[row + x] && !f.obj[row + x - 1]) f.ch[row + x] = f.ch[row + x - 1];
    }
  }
}

/**
 * Pluie : chaque goutte a un point d'impact dans le monde (tuiles de TW x TH cellules), tombe en
 * biais avec le vent pendant 82 % de son cycle puis éclabousse (`o ( )` sur l'eau, `. ,` au sol).
 * À chaque cycle, un nouveau point d'impact (hachage) : aucun état, aucune allocation.
 */
function rainPass(s: GameState, w: World, fl: { low: Uint8Array; dist: Uint8Array }, f: Frame, camX: number, camY: number) {
  const lv = seen(s);
  const I = Math.max(lv.rain, lv.storm * 0.8);
  if (I < 0.03) return;
  const t = s.time, g = gust(t);
  const TW = 40, TH = 30, FALL = 12;
  const n = Math.round(I * (22 + lv.storm * 18));
  const sl = (0.2 + 0.45 * g) * (1 + lv.storm * 0.6); // cellules vers la droite par ligne
  const streak = sl > 0.45 ? 92 : 124; // \ |
  const puddle = s.weather.wet > 0.05 ? 255 - s.weather.wet * 55 : 999;
  const flood = floodLevel(s.weather) * FLOOD_MAX;
  const tx0 = Math.floor(camX / TW), tx1 = Math.floor((camX + f.cols + FALL * sl) / TW);
  const ty0 = Math.floor(camY / TH), ty1 = Math.floor((camY + f.rows + FALL) / TH);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    for (let j = 0; j < n; j++) {
      const h0 = hash2(tx * 131 + j, ty, 71);
      const ph = t / (0.5 + h0 * 0.25) + hash2(tx, ty * 97 + j, 72);
      const cyc = Math.floor(ph), u = ph - cyc;
      const lx = tx * TW + Math.floor(hash2(tx * TW + j, ty + cyc * 13, 73) * TW);
      const ly = ty * TH + Math.floor(hash2(ty * TH + j, tx - cyc * 7, 74) * TH);
      const small = h0 < 0.3;
      if (u < 0.82) {
        const up = (1 - u / 0.82) * FALL;
        const hx = lx - camX - up * sl, hy = ly - camY - up;
        const len = small ? 1 : h0 > 0.7 ? 3 : 2;
        for (let r = 0; r < len; r++) {
          const x = Math.round(hx - r * sl), y = Math.round(hy - r);
          if (!inside(f, x, y)) continue;
          plot(f, x, y, small || r === len - 1 ? 39 : streak, RAIN, small ? 0.55 : 0.85);
        }
        continue;
      }
      if (small) continue;
      // Éclaboussure au point d'impact.
      const x = lx - camX, y = ly - camY;
      if (!inside(f, x, y) || lx < 0 || ly < 0 || lx >= w.cols || ly >= w.rows) continue;
      const wi = ly * w.cols + lx;
      const q = (u - 0.82) / 0.18;
      const wet = isWater(w.terrain[wi]) || fl.low[wi] > puddle || fl.dist[wi] <= flood;
      if (wet && !f.obj[y * f.cols + x]) {
        if (q < 0.45) plot(f, x, y, 111, RAIN, 0.8); // o
        else {
          if (inside(f, x - 1, y) && !f.obj[y * f.cols + x - 1]) plot(f, x - 1, y, 40, RAIN, 0.6); // (
          if (inside(f, x + 1, y) && !f.obj[y * f.cols + x + 1]) plot(f, x + 1, y, 41, RAIN, 0.6); // )
        }
      } else plot(f, x, y, q < 0.5 ? 46 : 44, RAIN, 0.6); // . ,
    }
  }
}

/** Neige : flocons `* . +` qui descendent en zigzag, poussés par le vent, et fondent au sol. */
function snowPass(s: GameState, f: Frame, camX: number, camY: number) {
  const I = seen(s).snow;
  if (I < 0.03) return;
  const t = s.time, g = gust(t);
  const TW = 40, TH = 30, FALL = 22;
  const n = Math.round(I * 26);
  const tx0 = Math.floor(camX / TW) - 1, tx1 = Math.floor((camX + f.cols) / TW) + 1;
  const ty0 = Math.floor(camY / TH), ty1 = Math.floor((camY + f.rows + FALL) / TH);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    for (let j = 0; j < n; j++) {
      const h0 = hash2(tx * 131 + j, ty, 91);
      const ph = t / (5 + h0 * 3) + hash2(tx, ty * 97 + j, 92);
      const cyc = Math.floor(ph), u = ph - cyc;
      if (u > 0.94) continue;
      const lx = tx * TW + hash2(tx * TW + j, ty + cyc * 13, 93) * TW;
      const ly = ty * TH + hash2(ty * TH + j, tx - cyc * 7, 94) * TH;
      const up = (1 - u) * FALL;
      const x = Math.round(lx - camX + Math.sin(t * 1.3 + h0 * 20) * 1.6 - up * 0.3 * g), y = Math.round(ly - camY - up);
      if (!inside(f, x, y)) continue;
      plot(f, x, y, h0 < 0.4 ? 46 : h0 < 0.78 ? 42 : 43, SNOW, 0.9); // . * +
    }
  }
}

/** Saison sèche et chaleur : poussière qui file au vent et tourbillons (`@ o .`). */
function dustPass(s: GameState, th: Theme, f: Frame, camX: number, camY: number) {
  const I = Math.max(seen(s).heat, dryness(s) * 0.6) * (1 - seen(s).rain);
  if (I < 0.1) return;
  const t = s.time, P = th.pal;
  const dust: RGB = [P.dirt[3][0] * 1.15, P.dirt[3][1] * 1.1, P.dirt[3][2] * 0.95];
  // Grains de poussière.
  const TW = 40, TH = 30, n = Math.round(I * 6);
  for (let ty = Math.floor(camY / TH); ty <= Math.floor((camY + f.rows) / TH); ty++) {
    for (let tx = Math.floor(camX / TW) - 1; tx <= Math.floor((camX + f.cols) / TW); tx++) {
      for (let j = 0; j < n; j++) {
        const h0 = hash2(tx * 131 + j, ty, 101);
        const ph = t / (3 + h0 * 2) + hash2(tx, ty * 97 + j, 102);
        const cyc = Math.floor(ph), u = ph - cyc;
        const x = Math.round(tx * TW + hash2(tx + j, ty + cyc, 103) * TW + u * 30 - camX);
        const y = Math.round(ty * TH + hash2(ty + j, tx - cyc, 104) * TH + Math.sin(u * 6 + h0 * 9) * 1.5 - camY);
        if (inside(f, x, y)) plot(f, x, y, h0 < 0.6 ? 46 : 44, dust, 0.6 * Math.sin(Math.PI * u));
      }
    }
  }
  // Tourbillons de poussière (dust devils) : une colonne qui tourne et avance.
  const DW = 150, DH = 80;
  for (let ty = Math.floor(camY / DH); ty <= Math.floor((camY + f.rows + 10) / DH); ty++) {
    for (let tx = Math.floor(camX / DW) - 1; tx <= Math.floor((camX + f.cols) / DW); tx++) {
      const ph = t / 18 + hash2(tx, ty, 111), cyc = Math.floor(ph), u = ph - cyc;
      if (hash2(tx + cyc * 31, ty, 112) > I * 0.6) continue;
      const env = Math.sin(Math.PI * u);
      const cx = tx * DW + hash2(tx, ty + cyc, 113) * (DW - 30) + u * 25 - camX;
      const cy = ty * DH + 10 + hash2(ty, tx + cyc, 114) * (DH - 10) + Math.sin(u * 3) * 4 - camY;
      for (let k = 0; k < 18; k++) {
        const fr = k / 18, ang = t * 7 + k * 0.9;
        const r = (0.8 + fr * 3.2) * env;
        const x = Math.round(cx + Math.cos(ang) * r * 1.75), y = Math.round(cy - fr * 7 + Math.sin(ang) * r * 0.3);
        if (inside(f, x, y)) plot(f, x, y, fr < 0.25 ? 64 : fr < 0.6 ? 111 : 46, dust, 0.8 * env); // @ o .
      }
    }
  }
}

/** Incendie : flammes `^ ' " *` qui gagnent l'arbre du pied à la cime, lueur au sol, fumée, braises. */
function firePass(s: GameState, w: World, f: Frame, camX: number, camY: number) {
  const st = s.weather;
  if (!st.fires.length) return;
  const t = s.time, g = gust(t), flick = Math.floor(t * 9);
  for (const fire of st.fires) {
    const tr = fire.tree;
    const bx = Math.floor(tr.x / CELL_W) - camX, by = Math.floor(tr.y / CELL_H) - camY;
    if (bx < -80 || bx > f.cols + 80 || by < -10 || by > f.rows + 90) continue;
    const p = Math.min(1, fire.t / BURN);
    const live = !fire.out && fire.t < BURN;
    let top = by;
    if (tr.state === "up") {
      // Hauteur de l'arbre, pour faire monter le front de flammes.
      for (const wi of tr.cells) { const yy = Math.floor(wi / w.cols) - camY; if (yy < top) top = yy; }
      const hgt = Math.max(1, by - top);
      for (const wi of tr.cells) {
        if (w.decorOwner[wi] !== tr.id) continue;
        const wx = wi % w.cols, wy = Math.floor(wi / w.cols);
        const x = wx - camX, y = wy - camY;
        if (!inside(f, x, y)) continue;
        const i = y * f.cols + x, k = i * 4;
        if (f.obj[i] !== 1) continue;
        // Bois noirci.
        const ch = 1 - p * 0.65;
        f.fg[k] *= ch; f.fg[k + 1] *= ch * 0.9; f.fg[k + 2] *= ch * 0.85;
        if (!live) continue;
        const front = (by - y) / hgt; // 0 au pied, 1 à la cime
        if (front > p * 1.4 + 0.15) continue;
        const h = hash2(wx, wy, flick);
        if (h > 0.25 + 0.5 * p) continue;
        const c = FLAME[Math.floor(hash2(wx, wy, flick + 1) * 3)];
        f.ch[i] = h < 0.12 ? 94 : h < 0.25 ? 39 : h < 0.4 ? 34 : 42; // ^ ' " *
        f.fg[k] = c[0]; f.fg[k + 1] = c[1]; f.fg[k + 2] = c[2];
        f.bg[k] += (c[0] * 0.5 - f.bg[k]) * 0.5; f.bg[k + 1] += (c[1] * 0.3 - f.bg[k + 1]) * 0.5; f.bg[k + 2] += (c[2] * 0.15 - f.bg[k + 2]) * 0.5;
      }
      // Lueur orangée au sol autour du pied.
      if (live) {
        const pulse = 0.75 + 0.25 * Math.sin(t * 13 + tr.id);
        for (let dy = -8; dy <= 4; dy++) for (let dx = -18; dx <= 18; dx++) {
          const x = bx + dx, y = by + dy;
          if (!inside(f, x, y)) continue;
          const d = (dx / 18) ** 2 + (dy / 8) ** 2;
          if (d >= 1) continue;
          const a = (1 - d) * 0.35 * pulse * Math.min(1, p * 3), k = (y * f.cols + x) * 4;
          f.bg[k] += (255 - f.bg[k]) * a * 0.5; f.bg[k + 1] += (130 - f.bg[k + 1]) * a * 0.5; f.bg[k + 2] += (40 - f.bg[k + 2]) * a * 0.3;
          f.fg[k] += (255 - f.fg[k]) * a * 0.4; f.fg[k + 1] += (150 - f.fg[k + 1]) * a * 0.3;
        }
      }
    } else if (fire.t < BURN + EMBERS) {
      // Arbre tombé : braises qui rougeoient sur le tronc couché.
      const dir = tr.dir;
      for (let n = 0; n < 14; n++) {
        const x = bx + dir * Math.floor(hash2(tr.id, n, 121) * 26), y = by - Math.floor(hash2(tr.id, n, 122) * 3);
        if (!inside(f, x, y) || hash2(n, tr.id, flick) > 0.6) continue;
        plot(f, x, y, hash2(n, tr.id, flick + 3) < 0.5 ? 46 : 42, FLAME[1 + (n & 1)], 0.9, 1);
      }
      top = by - 4;
    }
    // Fumée : bouffées qui montent et partent avec le vent.
    const amount = fire.out ? 0.5 : live ? Math.min(1, 0.3 + p) : 1 - (fire.t - BURN) / EMBERS;
    for (let n = 0; n < 14; n++) {
      const h0 = hash2(tr.id, n, 131);
      const u = (t / (3 + h0 * 2) + h0) % 1;
      if (h0 > amount) continue;
      const x = Math.round(bx + (h0 - 0.5) * 8 + u * u * 14 * g + Math.sin(t * 2 + n) * 1.2), y = Math.round(top - 1 - u * 20);
      if (!inside(f, x, y)) continue;
      plot(f, x, y, u < 0.3 ? 79 : u < 0.6 ? 111 : u < 0.85 ? 126 : 46, SMOKE, 0.75 * (1 - u)); // O o ~ .
    }
  }
}

/** Étoiles filantes : traînées dans le ciel (écran), seulement la nuit. */
function meteorPass(s: GameState, f: Frame) {
  if (s.weather.event !== "meteors") return;
  const night = 1 - daylight(s.clock);
  if (night < 0.2) return;
  const t = s.time;
  for (let n = 0; n < 7; n++) {
    const per = 3 + hash2(n, 1, 141) * 3;
    const ph = t / per + hash2(n, 2, 141), cyc = Math.floor(ph), u = ph - cyc;
    if (u > 0.22) continue;
    const v = u / 0.22;
    const sx = hash2(n, cyc, 142) * f.cols * 1.1, sy = hash2(cyc, n, 143) * f.rows * 0.6;
    const len = 40 + hash2(n, cyc, 144) * 40;
    const hx = sx - v * len * 2.2, hy = sy + v * len * 0.45;
    const fade = night * Math.sin(Math.PI * v);
    for (let k = 0; k < 14; k++) {
      const x = Math.round(hx + k * 2.2 * 0.6), y = Math.round(hy - k * 0.45 * 0.6);
      if (!inside(f, x, y)) continue;
      const a = fade * (1 - k / 14);
      plot(f, x, y, k === 0 ? 42 : k < 3 ? 61 : k < 8 ? 45 : 46, [255, 248, 215], a, 1, k === 0 ? a * 0.6 : 0); // * = - .
    }
  }
}

/** Éclair : tracé brisé `/ \ |` du haut de l'écran jusqu'à l'impact, puis éclair blanc sur tout l'écran. */
function boltPass(s: GameState, f: Frame, camX: number, camY: number) {
  const b = s.weather.bolt;
  if (!b) return;
  const age = s.time - b.t0;
  // Double scintillement : flash, creux, flash, puis décroissance.
  // Animations réduites : une seule lueur douce, sans scintillement.
  const flash = calm() ? Math.max(0, 0.12 - age * 0.3) : age < 0.08 ? 1 : age < 0.16 ? 0.25 : age < 0.26 ? 0.8 : Math.max(0, 0.5 - (age - 0.26) * 1.4);
  const tx = b.x - camX, ty = b.y - camY;
  if (age < 0.4 && !(age > 0.08 && age < 0.16)) {
    let x = tx + Math.round((hash2(b.seed, 1, 151) - 0.5) * 16);
    for (let y = 0; y <= ty; y++) {
      const left = ty - y;
      // Dérive vers l'impact, avec des zigzags.
      const want = Math.sign(tx - x);
      const j = hash2(b.seed, y, 152);
      const dx = Math.abs(tx - x) >= left ? want : j < 0.3 ? -1 : j > 0.7 ? 1 : 0;
      x += dx;
      if (!inside(f, x, y)) continue;
      plot(f, x, y, dx < 0 ? 47 : dx > 0 ? 92 : 124, BOLT, 1, 1.05, 0.55); // / \ |
      // Une branche qui part sur le côté.
      if (y === Math.floor(ty * 0.4)) {
        let bx = x;
        const side = hash2(b.seed, 3, 153) < 0.5 ? -1 : 1;
        for (let k = 1; k < 9; k++) {
          bx += hash2(b.seed, k, 154) < 0.7 ? side : 0;
          if (inside(f, bx, y + k)) plot(f, bx, y + k, side < 0 ? 47 : 92, BOLT, 0.8, 1, 0.3);
        }
      }
    }
    // Impact.
    if (inside(f, tx, ty)) plot(f, tx, ty, 42, [255, 250, 200], 1, 1.1, 0.7);
    for (const [ox, oy, c] of [[-1, 0, 45], [1, 0, 45], [-2, 1, 46], [2, 1, 46]] as const) if (inside(f, tx + ox, ty + oy)) plot(f, tx + ox, ty + oy, c, BOLT, 0.8, 1);
  }
  if (flash < 0.01) return;
  // Flash : tout l'écran s'éclaire d'un blanc bleuté.
  const a = flash * 0.55, n = f.cols * f.rows * 4;
  for (let k = 0; k < n; k += 4) {
    f.fg[k] += (245 - f.fg[k]) * a; f.fg[k + 1] += (248 - f.fg[k + 1]) * a; f.fg[k + 2] += (255 - f.fg[k + 2]) * a;
    f.bg[k] += (205 - f.bg[k]) * a * 0.7; f.bg[k + 1] += (215 - f.bg[k + 1]) * a * 0.7; f.bg[k + 2] += (235 - f.bg[k + 2]) * a * 0.7;
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** Libellé de la météo du moment (ciel courant, ou événement rare). */
export function weatherLabel(s: GameState): string {
  const st = s.weather;
  if (st.fires.some((f) => !f.out && f.t < BURN)) return "Incendie";
  if (st.floodT >= 0) return "Crue";
  if (st.event === "coldsnap") return "Coup de froid";
  if (st.event === "heatwave") return "Canicule";
  // Le ciel vu depuis le biome à l'écran : la pluie tombe en neige en Alaska, à peine au Gobi.
  const wet = st.kind === "rain" || st.kind === "storm";
  if (st.viewBiome === BIOME.Tundra && wet) return SKY_LABEL.snow;
  if (st.viewBiome === BIOME.Desert && wet) return SKY_LABEL.cloudy;
  return SKY_LABEL[st.kind];
}

/**
 * Lignes météo du panneau « Temps et météo » de la réserve (sans cadre) : saison + jour, frise de l'année
 * (pluies en ~, saison sèche en ., aujourd'hui en #), ciel + température, et en dev le forçage de test.
 * `compact` : une seule ligne (saison, ciel, température). Renvoie le nombre de lignes écrites.
 */
export function drawWeatherRows(s: GameState, th: Theme, ui: Frame, x: number, y: number, W: number, compact = false): number {
  const st = s.weather;
  if (!st.ready) return 0;
  const u = th.ui;
  const season = st.event === "coldsnap" ? "Hiver rigoureux" : SEASONS[seasonIndex(s)];
  const [icon, ic] = SKY_ICON[st.kind];
  const temp = temperature(s);
  const tl = `${temp} C`;
  const tcol: RGB = temp >= 33 ? u.bad : temp <= 5 ? [40, 100, 170] : u.text;
  if (DEV) region("weather:panel", x, y, W, compact ? 1 : 4, { tip: `Test : forcer la meteo (${st.force ? FORCE[st.force] : "auto"})` });
  if (compact) {
    text(ui, x, y, clipTo(`${icon} ${weatherLabel(s)}`, W - tl.length - 1), u.text, u.panel, u.alpha);
    text(ui, x + W - tl.length, y, tl, tcol, u.panel, u.alpha);
    return 1;
  }
  // Saison + jour de l'année.
  const doy = Math.floor(yearFrac(s) * YEAR_DAYS) + 1;
  const dl = `J${doy}/${YEAR_DAYS}`;
  text(ui, x, y, clipTo(season, W - dl.length - 1), u.hi, u.panel, u.alpha);
  text(ui, x + W - dl.length, y, dl, u.dim, u.panel, u.alpha);
  const track = W - 2, tx = x + 1, f = yearFrac(s);
  text(ui, tx - 1, y + 1, "[", u.border, u.panel, u.alpha);
  text(ui, tx + track, y + 1, "]", u.border, u.panel, u.alpha);
  for (let i = 0; i < track; i++) {
    const fi = (i + 0.5) / track;
    const wet = 0.5 + 0.5 * Math.cos(2 * Math.PI * (fi - 0.19));
    const now = Math.floor(f * track) === i;
    put(ui, tx + i, y + 1, now ? 35 : wet > 0.5 ? 126 : 46, now ? u.hi : wet > 0.5 ? [40, 110, 180] : [150, 100, 20], u.panel, u.alpha);
  }
  // Ciel (icône + mot : pas seulement la couleur) + température.
  text(ui, x, y + 2, icon, ic, u.border, u.alpha);
  text(ui, x + 4, y + 2, clipTo(weatherLabel(s), W - 5 - tl.length), u.text, u.panel, u.alpha);
  text(ui, x + W - tl.length, y + 2, tl, tcol, u.panel, u.alpha);
  // Ligne d'info : forçage de test (DEV) ou conseil.
  const info = DEV ? `clic : ${st.force ? `force ${FORCE[st.force]}` : "auto (tester)"}` : st.event === "meteors" ? "Regarde le ciel !" : "";
  if (info) text(ui, x, y + 3, clipTo(info, W), u.dim, u.panel, u.alpha);
  return info ? 4 : 3;
}

const clipTo = (t: string, w: number) => (t.length > w ? `${t.slice(0, Math.max(0, w - 1))}.` : t);

/** Tonnerre : « BOOM » un instant après l'éclair (immobile si les animations sont réduites). */
export function drawThunder(s: GameState, th: Theme, ui: Frame): void {
  const u = th.ui, since = s.time - s.weather.boomAt;
  if (!(since >= 0 && since < 1.1)) return;
  const label = since < 0.5 ? " B O O M ! " : " ...rrroum ";
  const jx = since < 0.4 && !calm() ? Math.round((hash2(Math.floor(s.time * 30), 1, 161) - 0.5) * 2) : 0;
  text(ui, Math.floor((ui.cols - label.length) / 2) + jx, Math.floor(ui.rows * 0.3), label, u.hi, u.panel, u.alpha * (1 - since * 0.6));
}

// ---------------------------------------------------------------------------
// Accesseurs pour l'IA de l'écosystème (à brancher par l'intégrateur)
// ---------------------------------------------------------------------------

/**
 * Multiplicateur de repousse de la nourriture végétale (Plant.food) : ~1.35 au cœur de la saison des
 * pluies, ~0.45 en saison sèche ; la pluie aide, la chaleur et la neige freinent. Toujours >= 0.1.
 */
export function plantGrowth(s: GameState): number {
  const lv = s.weather.lv;
  const base = 0.45 + 0.9 * seasonWet(s);
  return Math.max(0.1, base * (1 + 0.3 * lv.rain) * (1 - 0.6 * lv.heat) * (1 - 0.8 * lv.snow));
}

/** Multiplicateur de la soif des animaux : ~0.8 sous la pluie, jusqu'à ~2 en canicule de saison sèche. */
export function thirstRate(s: GameState): number {
  const lv = s.weather.lv;
  return Math.max(0.5, Math.min(2.2, 0.8 + 0.6 * (1 - seasonWet(s)) + 0.7 * lv.heat - 0.3 * lv.rain - 0.2 * lv.snow));
}

/** Nom de la saison (« Saison des pluies », « Saison sèche »...), « Hiver rigoureux » pendant un coup de froid. */
export function seasonName(s: GameState): string {
  return s.weather.event === "coldsnap" ? "Hiver rigoureux" : SEASONS[seasonIndex(s)];
}

/** Il pleut franchement (pluie ou orage) : les animaux peuvent s'abriter, moins besoin de boire. */
export function isRaining(s: GameState): boolean {
  return s.weather.lv.rain > 0.35;
}

/** Orage en cours (éclairs) : de quoi effrayer les troupeaux. */
export function isStorm(s: GameState): boolean {
  return s.weather.lv.storm > 0.5;
}

/** Il neige (coup de froid). */
export function isSnowing(s: GameState): boolean {
  return s.weather.lv.snow > 0.35;
}

/** Température de l'air (°C, entier, pour l'affichage) : saison, heure, ciel, événements. */
export function temperature(s: GameState): number {
  const st = s.weather, lv = seen(s);
  // Biome vu : l'Alaska du Crétacé est frais (pas glacial), le Gobi brûlant le jour et froid la nuit.
  const b = st.viewBiome;
  const base = 24 + 8 * (1 - seasonWet(s)) + (b === BIOME.Tundra ? -20 : b === BIOME.Desert ? 6 : 0);
  const day = (daylight(s.clock) * 6 - 3) * (b === BIOME.Desert ? 3 : 1);
  let c = base + day - lv.cloud * 2 - lv.rain * 3 - lv.storm * 1 + lv.heat * 6 - lv.fog * 2;
  c = lerp(c, -2 + day * 0.5, lv.snow);
  return Math.round(c);
}
