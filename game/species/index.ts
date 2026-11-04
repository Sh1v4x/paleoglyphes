import { ALAMOSAURUS } from "./alamosaurus";
import { ALLOSAURUS } from "./allosaurus";
import { ANKYLO } from "./ankylo";
import { ARCHELON } from "./archelon";
import { CITIPATI } from "./citipati";
import { DEINOSUCHUS } from "./deinosuchus";
import { EDMONTO } from "./edmonto";
import { ELASMOSAURUS } from "./elasmosaurus";
import { MOSA } from "./mosa";
import { NANUQ } from "./nanuq";
import { NYCTOSAURUS } from "./nyctosaurus";
import { ORNITHOMIMUS } from "./ornithomimus";
import { PACHY } from "./pachy";
import { PACHYRHINO } from "./pachyrhino";
import { PECTINODON } from "./pectinodon";
import { PINACOSAURUS } from "./pinacosaurus";
import { PROTOCERATOPS } from "./protoceratops";
import { PTERANODON } from "./pteranodon";
import { QUETZAL } from "./quetzal";
import { RAPTOR } from "./raptor";
import { SHUVUUIA } from "./shuvuuia";
import { THERIZINO } from "./therizino";
import { TREX } from "./trex";
import { TRIKE } from "./trike";
import { TROODON } from "./troodon";
import { VELOCIRAPTOR } from "./velociraptor";
import { XIPHACTINUS } from "./xiphactinus";
import type { Progress } from "../progress";
import { STRINGS } from "../strings";
import type { Species, SpeciesId } from "./types";

// Key order is SPECIES_LIST order: herbivores first, then carnivores.
export const SPECIES = {
  ankylo: ANKYLO, trike: TRIKE, edmonto: EDMONTO, pachy: PACHY, alamosaurus: ALAMOSAURUS, archelon: ARCHELON,
  pachyrhino: PACHYRHINO, protoceratops: PROTOCERATOPS, citipati: CITIPATI, ornithomimus: ORNITHOMIMUS,
  pinacosaurus: PINACOSAURUS, therizino: THERIZINO,
  raptor: RAPTOR, trex: TREX, quetzal: QUETZAL, mosa: MOSA, pectinodon: PECTINODON, allosaurus: ALLOSAURUS,
  pteranodon: PTERANODON, nyctosaurus: NYCTOSAURUS, xiphactinus: XIPHACTINUS, nanuq: NANUQ, velociraptor: VELOCIRAPTOR,
  deinosuchus: DEINOSUCHUS, troodon: TROODON, shuvuuia: SHUVUUIA, elasmosaurus: ELASMOSAURUS,
} satisfies Record<SpeciesId, Species>;

export const SPECIES_LIST: Species[] = Object.values(SPECIES);

export const isSpeciesId = (x: unknown): x is SpeciesId => typeof x === "string" && Object.hasOwn(SPECIES, x);

export function species(id: SpeciesId): Species {
  return SPECIES[id];
}

/**
 * Nom affiché d'une espèce : son vrai nom seulement une fois assemblée à l'atelier. Avant, c'est une
 * « espèce mystère » numérotée dans l'ordre où l'on a trouvé son premier os.
 */
export function shownName(p: Progress, id: SpeciesId): string {
  if (p.assembled.includes(id)) return SPECIES[id].name;
  const n = Object.keys(p.bones).indexOf(id);
  return n >= 0 ? STRINGS.mystery.numbered(n + 1) : STRINGS.mystery.name;
}

/** « d'Ankylosaure », « de l'espece mystere n1 ». */
export function ofName(p: Progress, id: SpeciesId): string {
  const n = shownName(p, id);
  if (!p.assembled.includes(id)) return `de l'${n.charAt(0).toLowerCase()}${n.slice(1)}`;
  // Voyelle (accentuée ou non) ou h muet : élision (« d'Édmontosaure »).
  return /^[aeiouyh]/i.test(n.normalize("NFD")) ? `d'${n}` : `de ${n}`;
}

/** Espèces dont on a au moins un os (ou déjà assemblées), dans l'ordre de découverte. */
export function discovered(p: Progress): Species[] {
  const withBones = Object.keys(p.bones).filter(isSpeciesId).filter((id) => (p.bones[id]?.length ?? 0) > 0);
  return [...new Set([...withBones, ...p.assembled])].map((id) => SPECIES[id]);
}
