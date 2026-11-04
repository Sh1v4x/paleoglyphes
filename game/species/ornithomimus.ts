import { BIOME } from "../world/biomes";
import { RAPTOR } from "./raptor";
import type { Species } from "./types";

/** PROVISOIRE : copie de RAPTOR en attendant le vrai modèle (voir ornithomimus.mat.ts, matières 350-359). */
export const ORNITHOMIMUS: Species = { ...RAPTOR, id: "ornithomimus", name: "Ornithomimus", biomes: [BIOME.HellCreek] };
