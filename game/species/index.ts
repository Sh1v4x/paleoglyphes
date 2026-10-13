import { CARNIVORES } from "./carnivores";
import { HERBIVORES } from "./herbivores";
import type { Progress } from "../progress";
import type { Species, SpeciesId } from "./types";

export const SPECIES_LIST: Species[] = [...HERBIVORES, ...CARNIVORES];
export const SPECIES = Object.fromEntries(SPECIES_LIST.map((s) => [s.id, s])) as Partial<Record<SpeciesId, Species>>;

export function species(id: SpeciesId): Species | undefined {
  return SPECIES[id];
}

/**
 * Nom affiché d'une espèce : son vrai nom seulement une fois assemblée à l'atelier. Avant, c'est une
 * « espèce mystère » numérotée dans l'ordre où l'on a trouvé son premier os.
 */
export function shownName(p: Progress, id: SpeciesId): string {
  if (p.assembled.includes(id)) return SPECIES[id]?.name ?? id;
  const n = Object.keys(p.bones).indexOf(id);
  return n >= 0 ? `Espece mystere n${n + 1}` : "Espece mystere";
}

/** « d'Ankylosaure », « de l'espece mystere n1 ». */
export function ofName(p: Progress, id: SpeciesId): string {
  const n = shownName(p, id);
  if (!p.assembled.includes(id)) return `de l'${n.charAt(0).toLowerCase()}${n.slice(1)}`;
  return /^[aeiouyhAEIOUYH]/.test(n) ? `d'${n}` : `de ${n}`;
}

/** Espèces dont on a au moins un os (ou déjà assemblées), dans l'ordre de découverte. */
export function discovered(p: Progress): Species[] {
  const ids = [...Object.keys(p.bones).filter((k) => (p.bones[k as SpeciesId]?.length ?? 0) > 0), ...p.assembled];
  return [...new Set(ids)].map((id) => SPECIES[id as SpeciesId]).filter((s): s is Species => !!s);
}
