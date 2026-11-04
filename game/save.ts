import type { Field } from "./features/lenia";
import { saveProgress } from "./progress";
import { prepareEcosystem } from "./scenes/ecosystem";
import type { Bug } from "./scenes/eco-fauna";
import { syncPopulation, type ParkState } from "./scenes/park";
import { isSpeciesId, SPECIES_LIST } from "./species";
import { worldFor, type GameState } from "./state";
import { STORAGE_KEYS } from "./storage-keys";
import { toast } from "./ui/toast";
import { knockTree, type TreeState } from "./world/trees";

/**
 * Sauvegarde de la réserve (la progression a la sienne, progress.ts) : animaux, nids, caméra, champs
 * Lenia (végétation, plancton), petite faune, météo, horloge et arbres renversés.
 * Le monde lui-même est régénéré à l'identique depuis sa graine : on ne garde que ce qui change.
 * Les données simples de `s.park` et `s.weather` sont copiées telles quelles (les champs ajoutés plus
 * tard suivent sans rien faire) ; seuls les états passagers de l'interface et les caches sont écartés.
 * Format versionné : une sauvegarde illisible ou d'une autre version est ignorée, sans erreur.
 */

const KEY = STORAGE_KEYS.reserve;
const VERSION = 1;
/** Sauvegarde automatique toutes les ... s (temps réel). */
const EVERY = 20;

/** Champs de la réserve qu'on ne garde pas : sélection, survol, fenêtres ouvertes, caches. */
const PARK_SKIP = new Set(["eco", "trample", "selected", "hover", "bug", "bugHover", "nestSel", "nestHover", "follow",
  "confirmRetire", "wheel", "zoomAcc", "roster", "rosterScroll", "debugNav"]);
/** Météo : l'éclair et le tonnerre en cours suivent le temps réel de la session (et les feux visent des arbres). */
const WEATHER_SKIP = new Set(["fires", "bolt", "nextBolt", "boomAt"]);

interface SaveData {
  v: number;
  clock: number;
  clockSpeed: number;
  park: Partial<ParkState>;
  weather: Record<string, unknown>;
  fires: [tree: number, t: number, out: boolean][];
  /** Arbres hors de l'état « debout » : id, état, temps dans l'état, sens de la chute. */
  trees: [id: number, state: TreeState, t: number, dir: 1 | -1][];
  /** Champs Lenia et nourriture restante des plantes (même ordre que eco.plants), voir `pack`. */
  veg: string;
  plankton: string;
  food: string;
  fauna: Bug[];
}

/** JSON : nombres arrondis (la sauvegarde reste petite), infinis gardés, tableaux typés écartés. */
function replacer(_k: string, v: unknown) {
  if (typeof v === "number") return Number.isFinite(v) ? (Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4) : String(v);
  if (ArrayBuffer.isView(v)) return undefined;
  return v;
}
function reviver(_k: string, v: unknown) {
  return v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : v === "NaN" ? NaN : v;
}

const plain = (o: object, skip: Set<string>) => Object.fromEntries(Object.entries(o).filter(([k]) => !skip.has(k)));

/** Valeurs 0..1 (cases d'un champ Lenia, nourriture des plantes) -> octets (0..255) en base64. */
function pack(v: ArrayLike<number>): string {
  const b = new Uint8Array(v.length);
  for (let i = 0; i < b.length; i++) b[i] = Math.round(Math.max(0, Math.min(1, v[i])) * 255);
  let str = "";
  for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(str);
}
/** Inverse de `pack` ; null si la longueur ne correspond pas (autre carte). */
function unpack(data: unknown, n: number): Float32Array | null {
  if (typeof data !== "string") return null;
  const str = atob(data);
  if (str.length !== n) return null;
  return Float32Array.from(str, (c) => c.charCodeAt(0) / 255);
}
/** Champ Lenia restauré : rien hors du masque. */
function unpackField(data: unknown, f: Field): Float32Array | null {
  const A = unpack(data, f.A.length);
  if (A) for (let i = 0; i < A.length; i++) if (!f.mask[i]) A[i] = 0;
  return A;
}

/** Texte de la sauvegarde de la réserve (null si elle n'a pas encore commencé). */
export function serializeReserve(s: GameState): string | null {
  const p = s.park, eco = p.eco;
  if (!p.started || !eco) return null;
  const w = worldFor(s);
  const data: SaveData = {
    v: VERSION, clock: s.clock, clockSpeed: s.clockSpeed,
    park: plain(p, PARK_SKIP),
    weather: plain(s.weather, WEATHER_SKIP),
    fires: s.weather.fires.map((f) => [f.tree.id, f.t, f.out]),
    trees: w.trees.filter((t) => t.state !== "up").map((t) => [t.id, t.state, t.t, t.dir]),
    veg: pack(eco.veg.A), plankton: pack(eco.plankton.A),
    food: pack(eco.plants.map((q) => q.food)),
    fauna: eco.fauna,
  };
  return JSON.stringify(data, replacer);
}

let timer = 0;
let told = false;

/** Écrit la sauvegarde. Pas pendant la météorite : « Tout recommencer » l'efface, rien ne doit la réécrire. */
export function saveReserve(s: GameState): boolean {
  if (s.mode === "meteor") return false;
  try {
    const json = serializeReserve(s);
    if (!json) return false;
    localStorage.setItem(KEY, json);
    // Animaux et progression vont ensemble (population) : on les écrit au même instant.
    saveProgress(s.progress);
    return true;
  } catch {
    // Stockage plein ou indisponible : la partie continue sans sauvegarde.
    return false;
  }
}

/** À appeler à chaque pas (temps réel) : sauvegarde périodique, annoncée une seule fois par visite. */
export function autosave(s: GameState, dt: number): void {
  timer += dt;
  if (timer < EVERY) return;
  timer = 0;
  if (saveReserve(s) && !told) {
    told = true;
    toast(s, "Partie sauvegardee", "La reserve est gardee dans ce navigateur, elle t'attendra.");
  }
}

/** Efface la sauvegarde de la réserve (« Tout recommencer »). */
export function clearSave(): void {
  timer = 0;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const STATES: readonly TreeState[] = ["falling", "down", "stump", "growing"];

/**
 * Restaure la réserve depuis le texte d'une sauvegarde, après la génération du monde. Tout est vérifié
 * avant de toucher à l'état : en cas de doute, la réserve neuve est gardée. Renvoie true si restaurée.
 */
export function restoreReserve(s: GameState, json: string): boolean {
  let d: SaveData;
  try {
    d = JSON.parse(json, reviver) as SaveData;
  } catch {
    return false;
  }
  if (!isObj(d) || d.v !== VERSION || !num(d.clock) || !num(d.clockSpeed) || !isObj(d.park) || !isObj(d.weather)) return false;
  const park = d.park as Record<string, unknown>;
  if (!Array.isArray(park.animals) || !Array.isArray(park.nests) || !isObj(park.cam) || !num(park.nextId) || !num(park.nextNest)) return false;
  if (!Array.isArray(d.trees) || !Array.isArray(d.fires) || !Array.isArray(d.fauna)) return false;
  prepareEcosystem(s);
  const eco = s.park.eco!, w = worldFor(s);
  let veg: Float32Array | null, plankton: Float32Array | null, food: Float32Array | null;
  try {
    veg = unpackField(d.veg, eco.veg);
    plankton = unpackField(d.plankton, eco.plankton);
    food = unpack(d.food, eco.plants.length);
  } catch {
    return false;
  }
  // Autre carte (taille des champs ou nombre de plantes différents) : sauvegarde incompatible.
  if (!veg || !plankton || !food) return false;
  // Espèces disparues du jeu, ou animal mal formé : écarté.
  const ok = (a: unknown) => isObj(a) && num(a.id) && num(a.x) && num(a.y) && typeof a.sp === "string" && isSpeciesId(a.sp);
  park.animals = (park.animals as unknown[]).filter(ok);
  park.nests = (park.nests as unknown[]).filter(ok);
  const trees = d.trees.filter(([id, st, t, dir]) => w.trees[id]?.state === "up" && STATES.includes(st) && num(t) && (dir === 1 || dir === -1));
  const fires = d.fires.filter(([id, t]) => w.trees[id] && num(t));

  // Tout est valide : on applique.
  s.clock = d.clock;
  s.clockSpeed = d.clockSpeed;
  Object.assign(s.park, park);
  const p = s.park;
  p.trample = new Uint16Array(w.cols * w.rows);
  p.started = true;
  Object.assign(s.weather, d.weather);
  s.weather.fires = fires.map(([id, t, out]) => ({ tree: w.trees[id], t, out: !!out }));
  eco.veg.A = veg; eco.veg.B = new Float32Array(veg.length); eco.veg.acc = 0;
  eco.plankton.A = plankton; eco.plankton.B = new Float32Array(plankton.length); eco.plankton.acc = 0;
  eco.plants.forEach((q, i) => { q.food = food[i]; });
  eco.fauna = d.fauna.filter((b) => isObj(b) && num(b.uid) && num(b.x) && num(b.y));
  // Arbres renversés : retirés du décor (comme une vraie chute), puis remis dans leur état. Du dernier
  // posé au premier : un arbre retiré rend ce qu'il recouvrait, y compris un voisin qu'on retirera ensuite.
  for (const [id, st, t, dir] of trees.sort((a, b) => b[0] - a[0])) {
    const tree = w.trees[id];
    knockTree(w, tree, dir);
    tree.state = st;
    tree.t = t;
  }
  // Progression et réserve écrites ensemble ; si la page s'est fermée brutalement entre deux, on garde
  // le plus grand des deux (un individu synthétisé juste avant n'est pas perdu), puis on complète.
  for (const spec of SPECIES_LIST) {
    const live = p.animals.filter((a) => a.sp === spec.id && a.task !== "dead").length;
    if (live > (s.progress.population[spec.id] ?? 0)) s.progress.population[spec.id] = live;
  }
  syncPopulation(s);
  return true;
}

/** Chargement au démarrage (écran de chargement). Renvoie true si une réserve a été retrouvée. */
export function loadReserve(s: GameState): boolean {
  let json: string | null = null;
  try {
    json = localStorage.getItem(KEY);
  } catch {
    // Stockage indisponible : réserve neuve.
  }
  if (!json) return false;
  let ok = false;
  try {
    ok = restoreReserve(s, json);
  } catch {
    // Sauvegarde incohérente malgré les vérifications : on l'oublie.
  }
  if (!ok) clearSave();
  else toast(s, "Retour dans la reserve", `Jour ${s.weather.day + 1} : les dinosaures t'attendaient.`);
  return ok;
}
