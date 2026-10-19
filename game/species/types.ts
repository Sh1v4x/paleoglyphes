import type { BiomeId } from "../world/biomes";
import type { Material } from "../render/materials";
import type { Prim } from "../render/raster";

/** Espèces que l'on peut fouiller, assembler et lâcher dans la réserve. */
export type SpeciesId =
  | "ankylo" | "raptor" | "trike" | "edmonto" | "pachy" | "trex" | "quetzal" | "mosa"
  | "archelon" | "xiphactinus" | "pteranodon" | "nyctosaurus" | "pectinodon" | "allosaurus" | "alamosaurus"
  // Toundra (Alaska, Prince Creek) et désert (Gobi, Djadochta).
  | "nanuq" | "pachyrhino" | "velociraptor" | "protoceratops" | "citipati";

/**
 * Ce que fait un animal. Chaque modèle sait dessiner chaque action (au minimum « idle » et « walk »).
 * - eat : tête baissée vers le sol (ou vers les branches pour un brouteur haut)
 * - drink : tête au ras de l'eau
 * - rest : couché, respiration lente
 * - attack : coup (massue, cornes, coup de tête, morsure) ; actionT 0..1 = déroulé du coup
 * - defend : posture de défense (tête basse, queue armée…)
 * - call : cri, tête levée
 * - run : course (comme walk mais allure rapide)
 * - dead : couché sur le flanc, immobile
 * - fly : en vol (espèces "air") ; `walk` = phase des battements, `moving` 1 = bat des ailes, 0 = plane
 * - takeoff / land : envol et atterrissage (espèces "air"), actionT 0..1 = déroulé
 * Espèces "sea" : walk/run = nager (ondulation du corps et de la queue), idle = flotter, rest = dériver.
 */
export type Action = "idle" | "walk" | "run" | "eat" | "drink" | "rest" | "attack" | "defend" | "call" | "dead" | "fly" | "takeoff" | "land";

/** Où vit l'espèce : au sol, en mer (eau profonde uniquement), ou dans les airs (se pose au sol). */
export type Habitat = "land" | "sea" | "air";

export interface Pose {
  /** Phase de marche (radians), avance avec le déplacement. */
  walk: number;
  /** 0 = immobile, 1 = en mouvement (fondu entre les deux). */
  moving: number;
  /** Temps global (s) : respiration, balancement de queue. */
  time: number;
  action: Action;
  /** Avancement de l'action, 0..1 (boucle pour eat/drink/rest/call, déroulé pour attack). */
  actionT: number;
}

export interface BoneDef {
  /** Identifiant utilisé dans les primitives du squelette (`prim.bone`). */
  id: string;
  /** Nom affiché (français). */
  name: string;
}

/** Comment un fait du carnet se débloque. */
export type FactUnlock =
  | "discover" // premier clic sur l'animal dans la réserve
  | "assemble" // squelette complété à l'atelier
  | "eat" | "drink" | "rest" | "attack" | "defend" | "call" // cliquer l'animal pendant cette action
  | "herd" // cliquer l'animal quand il est en troupeau
  | "hunt" // cliquer un prédateur en chasse
  | "flee" // cliquer une proie qui fuit
  | "scavenge" // cliquer un animal qui mange une carcasse
  | "nest" // cliquer un nid (ou un parent qui couve)
  | "migrate" // cliquer un animal pendant une migration
  | "baby"; // cliquer un bébé ou un juvénile

export interface Fact {
  id: string;
  title: string;
  text: string;
  unlock: FactUnlock;
}

export interface Behavior {
  diet: "herbivore" | "carnivore" | "omnivore";
  /** Taille des troupeaux (1 = solitaire). */
  herd: readonly [number, number];
  /** Hauteur de broutage : plantes basses ou hautes. */
  browse: "low" | "high" | "both" | null;
  /** Proies chassées (carnivores). */
  prey: SpeciesId[];
  /** Défense face à un prédateur. */
  defense: "club" | "horns" | "headbutt" | "flee" | "bite";
  /** Distance de vue (px monde). */
  sight: number;
  /** Mange les carcasses. */
  scavenger: boolean;
}

export interface Species {
  id: SpeciesId;
  name: string;
  latin: string;
  /** Période et âge, ex. « Crétacé supérieur, 68-66 Ma ». */
  period: string;
  /** Lieu de découverte des fossiles. */
  place: string;
  lengthM: number;
  massKg: number;
  /** Faits du carnet. Le premier devrait se débloquer par « discover » ou « assemble ». */
  facts: Fact[];
  /** Os à trouver pour assembler l'espèce (6 à 9). Les primitives du squelette portent ces `id`. */
  bones: BoneDef[];
  /** Modèle en chair, px locaux, regard à droite, origine au sol sous le centre du corps. */
  model: (pose: Pose) => Prim[];
  /** Squelette, même repère que le modèle. Chaque primitive porte `bone`. Matière : M.Bone. */
  skeleton: (pose: Pose) => Prim[];
  /** Px locaux (regard à droite) : centre du corps, œil, pieds (x), demi-longueur du corps. */
  center: { x: number; y: number };
  eye: { x: number; y: number };
  feet: number[];
  halfLen: number;
  /** Rayon de l'ombre au sol, en fraction de halfLen. */
  shadow: number;
  /** Vitesses (px/s) et cadence de foulée (rad/s). */
  walkSpeed: number;
  runSpeed: number;
  stride: number;
  behavior: Behavior;
  /** Milieu de vie (défaut : "land"). */
  habitat?: Habitat;
  /**
   * Biomes d'origine des espèces terrestres (défaut : forêts de Hell Creek et marais). L'animal y naît
   * et y fait ses promenades ; il peut en sortir pour boire, chasser ou fuir.
   */
  biomes?: BiomeId[];
  /**
   * Migration saisonnière (facultatif) : biomes où vit le troupeau pendant l'été polaire, puis pendant
   * l'hiver (voir polarSummer). Ils doivent faire partie de `biomes`. Sans migration : sédentaire.
   */
  migration?: { summer: BiomeId[]; winter: BiomeId[] };
  /**
   * Reproduction (défaut : "eggs") : "eggs" = nid, couvée, éclosion ; "live" = gestation puis
   * naissance d'un petit à côté de la mère (pas de nid, pas d'œuf fossile).
   */
  birth?: "eggs" | "live";
}

/** Matières propres à un groupe d'espèces (ou à la flore), déclinées pour chaque style. */
export interface MaterialSet {
  dark: Record<number, Material>;
  cartoon: Record<number, Material>;
}
