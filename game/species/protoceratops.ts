import { BIOME } from "../world/biomes";
import { PACHY } from "./pachy";
import type { Species } from "./types";

/** PROVISOIRE : copie de PACHY en attendant le vrai modèle (voir protoceratops.mat.ts, matières 330-339). */
export const PROTOCERATOPS: Species = { ...PACHY, id: "protoceratops", name: "Protoceratops", biomes: [BIOME.Desert] };
