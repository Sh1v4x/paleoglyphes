import { isDigSiteId, type DigSiteId } from "./scenes/dig-sites";
import { isSpeciesId } from "./species";
import type { SpeciesId } from "./species/types";
import { STORAGE_KEYS } from "./storage-keys";
import { isBiomeId, type BiomeId } from "./world/biomes";

/** Progression du joueur, sauvegardée dans le navigateur. */
export interface Progress {
  /** Os trouvés par espèce (ids de BoneDef, sans doublon). */
  bones: Partial<Record<SpeciesId, string[]>>;
  /** Espèces dont le squelette a été assemblé (la synthèse devient possible). */
  assembled: SpeciesId[];
  /** Individus synthétisés et envoyés dans la réserve. */
  population: Partial<Record<SpeciesId, number>>;
  /** Faits débloqués dans le carnet, sous la forme "espece:fait". */
  facts: string[];
  /** Fossiles bonus trouvés en fouille (ammonites, ambre...). */
  extras: string[];
  /** Sites de fouille terminés. */
  digs: number;
  /** Œufs fossiles trouvés en fouille, prêts à incuber à l'atelier (par espèce). */
  eggs: Partial<Record<SpeciesId, number>>;
  /** Indices de fouille gagnés au quiz du carnet (révèlent les fossiles cachés d'un site). Ancien format : absent. */
  hints?: number;
  /** Statistiques du quiz du carnet (bonnes réponses cumulées : un indice toutes les 3). */
  quiz?: { correct: number; answered: number; bestStreak: number };
  /** Espèces bien placées sur la frise du temps (une étoile chacune). */
  timeline?: SpeciesId[];
  /** Site de fouille choisi (ancien format : absent, Hell Creek). */
  digSite?: DigSiteId;
  /** Sites de fouille déjà annoncés comme ouverts. */
  digSites?: DigSiteId[];
  /** Biomes déjà visités dans la réserve (pages du carnet de voyage). Ancien format : absent. */
  biomes?: BiomeId[];
}

export function emptyProgress(): Progress {
  return { bones: {}, assembled: [], population: {}, facts: [], extras: [], digs: 0, eggs: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isQuiz = (v: unknown): v is NonNullable<Progress["quiz"]> => isRecord(v) && isNum(v.correct) && isNum(v.answered) && isNum(v.bestStreak);

function listOf<T>(v: unknown, ok: (x: unknown) => x is T): T[] | undefined {
  return Array.isArray(v) ? v.filter(ok) : undefined;
}

/** Entries keyed by a species that no longer exists are dropped (renamed or removed species). */
function bySpecies<T>(v: unknown, ok: (x: unknown) => x is T): Partial<Record<SpeciesId, T>> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Partial<Record<SpeciesId, T>> = {};
  for (const [k, x] of Object.entries(v)) if (isSpeciesId(k) && ok(x)) out[k] = x;
  return out;
}

/** Sauvegarde relue champ par champ : un champ illisible reprend sa valeur de départ, sans faire planter le reste. */
export function parseProgress(raw: string): Progress {
  const v: unknown = JSON.parse(raw);
  const e = emptyProgress();
  if (!isRecord(v)) return e;
  const p: Progress = {
    bones: bySpecies(v.bones, isStringList) ?? e.bones,
    assembled: listOf(v.assembled, isSpeciesId) ?? e.assembled,
    population: bySpecies(v.population, isNum) ?? e.population,
    facts: listOf(v.facts, isString) ?? e.facts,
    extras: listOf(v.extras, isString) ?? e.extras,
    digs: isNum(v.digs) ? v.digs : e.digs,
    eggs: bySpecies(v.eggs, isNum) ?? e.eggs,
  };
  if (isNum(v.hints)) p.hints = v.hints;
  if (isQuiz(v.quiz)) p.quiz = v.quiz;
  const timeline = listOf(v.timeline, isSpeciesId);
  if (timeline) p.timeline = timeline;
  if (isDigSiteId(v.digSite)) p.digSite = v.digSite;
  const digSites = listOf(v.digSites, isDigSiteId);
  if (digSites) p.digSites = digSites;
  const biomes = listOf(v.biomes, isBiomeId);
  if (biomes) p.biomes = biomes;
  return p;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.progress);
    if (raw) return parseProgress(raw);
  } catch {
    // Stockage indisponible (navigation privée...) : on repart de zéro.
  }
  return emptyProgress();
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(p));
  } catch {
    // Sans stockage, la partie reste jouable mais ne sera pas sauvegardée.
  }
}

/** Renvoie true si l'os est nouveau. */
export function addBone(p: Progress, sp: SpeciesId, bone: string): boolean {
  const list = (p.bones[sp] ??= []);
  if (list.includes(bone)) return false;
  list.push(bone);
  saveProgress(p);
  return true;
}

export const factKey = (sp: SpeciesId, fact: string) => `${sp}:${fact}`;

export function hasFact(p: Progress, sp: SpeciesId, fact: string): boolean {
  return p.facts.includes(factKey(sp, fact));
}
