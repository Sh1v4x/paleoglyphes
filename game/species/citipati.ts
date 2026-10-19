import { BIOME } from "../world/biomes";
import { PECTINODON } from "./pectinodon";
import type { Species } from "./types";

/** PROVISOIRE : copie de PECTINODON en attendant le vrai modèle (voir citipati.mat.ts, matières 340-349). */
export const CITIPATI: Species = { ...PECTINODON, id: "citipati", name: "Citipati", biomes: [BIOME.Desert] };
