import { BIOME } from "../world/biomes";
import { RAPTOR } from "./raptor";
import type { Species } from "./types";

/** PROVISOIRE : copie de RAPTOR en attendant le vrai modèle (voir velociraptor.mat.ts, matières 320-329). */
export const VELOCIRAPTOR: Species = { ...RAPTOR, id: "velociraptor", name: "Velociraptor", biomes: [BIOME.Desert] };
