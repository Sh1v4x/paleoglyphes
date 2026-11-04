import { BIOME } from "../world/biomes";
import { CITIPATI } from "./citipati";
import type { Species } from "./types";

/** PROVISOIRE : copie de CITIPATI en attendant le vrai modèle (voir therizino.mat.ts, matières 410-419). */
export const THERIZINO: Species = { ...CITIPATI, id: "therizino", name: "Therizinosaure", biomes: [BIOME.Desert] };
