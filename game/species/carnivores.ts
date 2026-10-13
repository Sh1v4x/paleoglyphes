import { MOSA } from "./mosa";
import { QUETZAL } from "./quetzal";
import { RAPTOR } from "./raptor";
import { TREX } from "./trex";
import type { Species } from "./types";

/** Carnivores de la réserve (dont le ptérosaure et le reptile marin). */
export const CARNIVORES: Species[] = [RAPTOR, TREX, QUETZAL, MOSA];
