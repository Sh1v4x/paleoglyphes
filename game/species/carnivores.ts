import { ALLOSAURUS } from "./allosaurus";
import { DEINOSUCHUS } from "./deinosuchus";
import { ELASMOSAURUS } from "./elasmosaurus";
import { MOSA } from "./mosa";
import { NANUQ } from "./nanuq";
import { NYCTOSAURUS } from "./nyctosaurus";
import { PECTINODON } from "./pectinodon";
import { PTERANODON } from "./pteranodon";
import { QUETZAL } from "./quetzal";
import { RAPTOR } from "./raptor";
import { SHUVUUIA } from "./shuvuuia";
import { TREX } from "./trex";
import { TROODON } from "./troodon";
import { VELOCIRAPTOR } from "./velociraptor";
import type { Species } from "./types";
import { XIPHACTINUS } from "./xiphactinus";

/** Carnivores de la réserve (dont le ptérosaure et le reptile marin). */
export const CARNIVORES: Species[] = [RAPTOR, TREX, QUETZAL, MOSA, PECTINODON, ALLOSAURUS, PTERANODON, NYCTOSAURUS, XIPHACTINUS, NANUQ, VELOCIRAPTOR,
  DEINOSUCHUS, TROODON, SHUVUUIA, ELASMOSAURUS];
