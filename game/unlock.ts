import { saveProgress } from "./progress";
import { SPECIES } from "./species";
import type { FactUnlock, SpeciesId } from "./species/types";
import type { GameState } from "./state";
import { toast } from "./ui/toast";

/** Débloque un fait du carnet. Renvoie true s'il est nouveau (et affiche une notification). */
export function unlockFact(s: GameState, sp: SpeciesId, factId: string): boolean {
  const key = `${sp}:${factId}`;
  if (s.progress.facts.includes(key)) return false;
  s.progress.facts.push(key);
  saveProgress(s.progress);
  const spec = SPECIES[sp];
  const fact = spec?.facts.find((f) => f.id === factId);
  toast(s, "Nouvelle entree au carnet !", `${spec?.name ?? sp} : ${fact?.title ?? factId}`);
  return true;
}

/** Débloque tous les faits d'une espèce liés à un déclencheur (clic pendant une action, assemblage...). */
export function unlockTrigger(s: GameState, sp: SpeciesId, trigger: FactUnlock): number {
  let n = 0;
  for (const f of SPECIES[sp]?.facts ?? []) if (f.unlock === trigger && unlockFact(s, sp, f.id)) n++;
  return n;
}
