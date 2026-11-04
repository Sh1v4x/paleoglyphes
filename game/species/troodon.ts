import { BIOME } from "../world/biomes";
import { PECTINODON } from "./pectinodon";
import type { Species } from "./types";

/** PROVISOIRE : copie de PECTINODON en attendant le vrai modèle (voir troodon.mat.ts, matières 370-379). */
export const TROODON: Species = { ...PECTINODON, id: "troodon", name: "Troodontide d'Alaska", biomes: [BIOME.Tundra] };
