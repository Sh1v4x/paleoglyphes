import { CARNIVORES } from "./carnivores";
import { HERBIVORES } from "./herbivores";
import type { Species, SpeciesId } from "./types";

export const SPECIES_LIST: Species[] = [...HERBIVORES, ...CARNIVORES];
export const SPECIES = Object.fromEntries(SPECIES_LIST.map((s) => [s.id, s])) as Partial<Record<SpeciesId, Species>>;

export function species(id: SpeciesId): Species | undefined {
  return SPECIES[id];
}
