import { ALLOSAURUS } from "./allosaurus";
import { MOSA } from "./mosa";
import { NYCTOSAURUS } from "./nyctosaurus";
import { PECTINODON } from "./pectinodon";
import { PTERANODON } from "./pteranodon";
import { QUETZAL } from "./quetzal";
import { RAPTOR } from "./raptor";
import { TREX } from "./trex";
import type { Species } from "./types";
import { XIPHACTINUS } from "./xiphactinus";

/** Carnivores de la réserve (dont le ptérosaure et le reptile marin). */
export const CARNIVORES: Species[] = [RAPTOR, TREX, QUETZAL, MOSA, PECTINODON, ALLOSAURUS, PTERANODON, NYCTOSAURUS, XIPHACTINUS];
