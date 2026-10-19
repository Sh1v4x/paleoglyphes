import { BIOME } from "../world/biomes";
import { TREX } from "./trex";
import type { Species } from "./types";

/** PROVISOIRE : copie de TREX en attendant le vrai modèle (voir nanuq.mat.ts, matières 300-309). */
export const NANUQ: Species = { ...TREX, id: "nanuq", name: "Nanuqsaurus", biomes: [BIOME.Tundra] };
