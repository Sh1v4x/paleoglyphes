import { BIOME } from "../world/biomes";
import { PECTINODON } from "./pectinodon";
import type { Species } from "./types";

/** PROVISOIRE : copie de PECTINODON en attendant le vrai modèle (voir shuvuuia.mat.ts, matières 380-389). */
export const SHUVUUIA: Species = { ...PECTINODON, id: "shuvuuia", name: "Shuvuuia", biomes: [BIOME.Desert] };
