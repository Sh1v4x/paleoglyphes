/**
 * Aperçu terminal des nids et des œufs.
 * Usage : npx tsx scripts/preview-eggs.ts [espece] [oeufs] [cartoon]
 * ex.   : npx tsx scripts/preview-eggs.ts edmonto 4
 */
import { CARTOON, DARK } from "../game/palette";
import { rasterize, type Prim } from "../game/render/raster";
import { eggModel, nestModel } from "../game/species/eggs";
import type { SpeciesId } from "../game/species/types";

const [id = "edmonto", n = "4", style, json] = process.argv.slice(2);
/** Mode « json » : grilles colorées pour un rendu image externe. */
const grids: { title: string; rows: [string, number[]][][] }[] = [];
const sp = id as SpeciesId;
const theme = style === "cartoon" ? CARTOON : DARK;

function show(title: string, prims: Prim[]) {
  const r = rasterize(prims, 0, 0);
  const lines: string[] = [];
  const rows: [string, number[]][][] = [];
  for (let j = 0; j < r.h; j++) {
    let row = "";
    const cells: [string, number[]][] = [];
    for (let i = 0; i < r.w; i++) {
      const k = j * r.w + i;
      const m = r.mat[k];
      if (!m) { row += " "; cells.push([" ", [0, 0, 0]]); continue; }
      const mt = theme.mats[m];
      const ramp = mt?.ramp ?? "?";
      const ch = r.glyph[k] ? String.fromCharCode(r.glyph[k]) : ramp[Math.min(ramp.length - 1, Math.floor(r.lum[k] * ramp.length))];
      row += ch;
      const l = mt?.emissive ? 1 : 0.35 + 0.65 * r.lum[k];
      cells.push([ch, (mt?.color ?? [255, 0, 255]).map((c) => Math.round(c * l))]);
    }
    lines.push(row.replace(/\s+$/, ""));
    rows.push(cells);
  }
  if (json) { grids.push({ title, rows }); return; }
  console.log(`-- ${title} (${r.w}x${r.h})\n${lines.join("\n")}\n`);
}

for (const c of [0, 0.5, 0.9]) show(`nid ${sp} crack=${c}`, nestModel(sp, Number(n), c, false));
show(`nid ${sp} eclos`, nestModel(sp, Number(n), 1, true));
for (const c of [0, 0.4, 0.8, 1]) show(`oeuf ${sp} crack=${c}`, eggModel(sp, c));
if (json) console.log(JSON.stringify(grids));
