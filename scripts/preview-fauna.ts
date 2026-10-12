/**
 * Aperçu terminal de la petite faune (ou d'une espèce, toutes actions d'un coup).
 * Usage : npx tsx scripts/preview-fauna.ts <faune|espece> [action|all] [actionT] [walk] [zoom] [skeleton]
 * ex.   : npx tsx scripts/preview-fauna.ts pterosaur idle 0 1.5
 *         npx tsx scripts/preview-fauna.ts trex all 0.5 0 1
 */
import { DARK } from "../game/palette";
import { rasterize, scalePrim, type Prim } from "../game/render/raster";
import { SPECIES } from "../game/species";
import { FAUNA, type FaunaId } from "../game/species/fauna";
import type { Action, Pose, SpeciesId } from "../game/species/types";

const [id = "didelphodon", act = "idle", at = "0", walk = "0", zoom = "1", ...rest] = process.argv.slice(2);
const fauna = FAUNA[id as FaunaId];
const spec = SPECIES[id as SpeciesId];
if (!fauna && !spec) {
  console.error(`Inconnu : ${id}. Faune : ${Object.keys(FAUNA).join(", ")} ; espèces : ${Object.keys(SPECIES).join(", ")}`);
  process.exit(1);
}
const ACTIONS: Action[] = ["idle", "walk", "run", "eat", "drink", "rest", "attack", "defend", "call", "dead"];
for (const action of act === "all" ? ACTIONS : [act as Action]) {
  const pose: Pose = { walk: Number(walk), moving: action === "walk" || action === "run" ? 1 : 0, time: 0.4, action, actionT: Number(at) };
  const raw: Prim[] = fauna ? fauna.model(pose) : rest.includes("skeleton") ? spec!.skeleton(pose) : spec!.model(pose);
  const prims = raw.map((p) => scalePrim(p, Number(zoom)));
  const r = rasterize(prims, 0, 0, rest.includes("flip"));
  const lines: string[] = [];
  for (let j = 0; j < r.h; j++) {
    let row = "";
    for (let i = 0; i < r.w; i++) {
      const k = j * r.w + i;
      const m = r.mat[k];
      if (!m) { row += " "; continue; }
      if (r.glyph[k]) { row += String.fromCharCode(r.glyph[k]); continue; }
      const ramp = DARK.mats[m]?.ramp ?? "?";
      row += ramp[Math.min(ramp.length - 1, Math.floor(r.lum[k] * ramp.length))];
    }
    lines.push(row.replace(/\s+$/, ""));
  }
  console.log(lines.join("\n"));
  console.log(`--- ${id} ${action} t=${at} : ${r.w}x${r.h} cellules, ${prims.length} primitives\n`);
}
