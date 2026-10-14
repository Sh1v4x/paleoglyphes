import type { SpeciesId } from "./species/types";

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
}

const KEY = "ascii-dino-progress-v1";

export function emptyProgress(): Progress {
  return { bones: {}, assembled: [], population: {}, facts: [], extras: [], digs: 0, eggs: {} };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyProgress(), ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    // Stockage indisponible (navigation privée...) : on repart de zéro.
  }
  return emptyProgress();
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Sans stockage, la partie reste jouable mais ne sera pas sauvegardée.
  }
}

/** Ajoute un os. Renvoie true s'il est nouveau. */
export function addBone(p: Progress, sp: SpeciesId, bone: string): boolean {
  const list = (p.bones[sp] ??= []);
  if (list.includes(bone)) return false;
  list.push(bone);
  saveProgress(p);
  return true;
}

export function hasFact(p: Progress, sp: SpeciesId, fact: string): boolean {
  return p.facts.includes(`${sp}:${fact}`);
}
