import { BIOME } from "../world/biomes";
import { ANKYLO } from "./ankylo";
import type { Species } from "./types";

/** PROVISOIRE : copie de ANKYLO en attendant le vrai modèle (voir pinacosaurus.mat.ts, matières 390-399). */
export const PINACOSAURUS: Species = { ...ANKYLO, id: "pinacosaurus", name: "Pinacosaure", biomes: [BIOME.Desert] };
