/**
 * Aperçu terminal d'un modèle : rastérise une espèce (ou son squelette) et l'affiche en ASCII.
 * Usage : npx tsx scripts/preview-sprite.ts <espece> [action] [actionT 0..1] [walk rad] [skeleton] [flip]
 * ex.   : npx tsx scripts/preview-sprite.ts ankylo walk 0 1.2
 *         npx tsx scripts/preview-sprite.ts trex attack 0.5
 *         npx tsx scripts/preview-sprite.ts trike idle 0 0 skeleton
 */
import { DARK } from "../game/palette";
import { rasterize } from "../game/render/raster";
import { SPECIES } from "../game/species";
import type { Action, SpeciesId } from "../game/species/types";

const [id = "ankylo", action = "idle", at = "0", walk = "0", ...rest] = process.argv.slice(2);
const spec = SPECIES[id as SpeciesId];
if (!spec) {
  console.error(`Espece inconnue : ${id}. Dispo : ${Object.keys(SPECIES).join(", ")}`);
  process.exit(1);
}
const pose = { walk: Number(walk), moving: action === "walk" || action === "run" ? 1 : 0, time: 0.4, action: action as Action, actionT: Number(at) };
const prims = rest.includes("skeleton") ? spec.skeleton(pose) : spec.model(pose);
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
console.log(`\n${spec.name} — ${action} t=${at} : ${r.w}x${r.h} cellules, ${prims.length} primitives`);
