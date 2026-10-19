import { BIOME } from "../world/biomes";
import { TRIKE } from "./trike";
import type { Species } from "./types";

/** PROVISOIRE : copie de TRIKE en attendant le vrai modèle (voir pachyrhino.mat.ts, matières 310-319). */
export const PACHYRHINO: Species = { ...TRIKE, id: "pachyrhino", name: "Pachyrhinosaure", biomes: [BIOME.Tundra] };
