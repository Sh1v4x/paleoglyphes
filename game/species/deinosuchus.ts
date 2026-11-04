import { BIOME } from "../world/biomes";
import { ANKYLO } from "./ankylo";
import type { Species } from "./types";

/** PROVISOIRE : copie de ANKYLO en attendant le vrai modèle (voir deinosuchus.mat.ts, matières 360-369). */
export const DEINOSUCHUS: Species = { ...ANKYLO, id: "deinosuchus", name: "Deinosuchus", biomes: [BIOME.Swamp] };
