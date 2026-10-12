/**
 * Aperçu terminal de la réserve (sans navigateur).
 * Usage : npx tsx scripts/preview-world.ts model <nom> [dark|cartoon] [graine]
 *         npx tsx scripts/preview-world.ts world [dark|cartoon] [col] [lig] [larg] [haut]   (composeWorld complet)
 *         npx tsx scripts/preview-world.ts map [dark|cartoon]                                (carte réduite + stats)
 */
import { createFrame } from "../game/render/frame";
import { composeWorld } from "../game/render/compose";
import { rasterize, type Prim } from "../game/render/raster";
import { THEMES, type Style } from "../game/palette";
import { mulberry32 } from "../game/rng";
import * as D from "../game/sprites/decor";
import { generateWorld } from "../game/world/generate";
import { T } from "../game/world/tiles";

const [mode = "model", a1 = "sequoia", a2, a3, a4, a5, a6] = process.argv.slice(2);

function printRaster(prims: Prim[], style: Style) {
  const th = THEMES[style];
  const r = rasterize(prims, 0, 0, false);
  const out: string[] = [];
  for (let j = 0; j < r.h; j++) {
    let row = "";
    for (let i = 0; i < r.w; i++) {
      const k = j * r.w + i, m = r.mat[k];
      if (!m) { row += " "; continue; }
      if (r.glyph[k]) { row += String.fromCharCode(r.glyph[k]); continue; }
      const ramp = th.mats[m].ramp;
      const l = th.cel ? (r.lum[k] < 0.42 ? 0.32 : r.lum[k] < 0.7 ? 0.62 : 0.95) : r.lum[k];
      row += ramp[Math.min(ramp.length - 1, Math.floor(l * ramp.length))];
    }
    out.push(row.replace(/\s+$/, ""));
  }
  console.log(out.join("\n"));
  console.log(`\n${r.w}x${r.h} cellules, ${prims.length} primitives`);
}

if (mode === "model") {
  const style = (a2 ?? "dark") as Style;
  const rng = mulberry32(Number(a3 ?? 1));
  const dark = style === "dark";
  const models: Record<string, () => Prim[]> = {
    sequoia: () => D.sequoia(rng, dark), araucaria: () => D.araucaria(rng, dark), cycad: () => D.cycad(rng, dark),
    palm: () => D.palm(rng, dark), treeFern: () => D.treeFern(rng, dark), magnolia: () => D.magnolia(rng, dark),
    ginkgo: () => D.ginkgo(rng, dark), horsetails: () => D.horsetails(rng), fern: () => D.fernClump(rng, dark),
    herbs: () => D.herbs(rng), rock: () => D.rock(rng), outcrop: () => D.fossilOutcrop(rng), dead: () => D.deadTree(rng),
    bones: () => D.bones(rng),
  };
  const f = models[a1];
  if (!f) { console.error(`Modèle inconnu. Dispo : ${Object.keys(models).join(", ")}`); process.exit(1); }
  printRaster(f(), style);
} else {
  const style = (a1 === "cartoon" ? "cartoon" : "dark") as Style;
  const t0 = performance.now();
  const w = generateWorld(style);
  const dt = performance.now() - t0;
  if (mode === "map") {
    // 1 caractère = 6x6 cellules.
    const sx = 6, sy = 6, out: string[] = [];
    for (let y = 0; y < w.rows; y += sy) {
      let row = "";
      for (let x = 0; x < w.cols; x += sx) {
        const i = y * w.cols + x;
        const t = w.terrain[i];
        row += t === T.Deep ? "~" : t === T.Shallow ? "-" : w.solid[i] ? "T" : w.decorMat[i] ? "^" : t === T.Grass ? " .:+o"[w.cover[i]] : "_";
      }
      out.push(row);
    }
    console.log(out.join("\n"));
    const low = w.plants.filter((p) => p.level === "low").length;
    console.log(`\n${w.cols}x${w.rows}, génération ${dt.toFixed(0)} ms, plantes ${w.plants.length} (basses ${low}), points d'eau ${w.waterPoints.length}`);
    const kinds: Record<string, number> = {};
    for (const p of w.plants) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    console.log(kinds);
  } else {
    const cols = Number(a4 ?? 160), rows = Number(a5 ?? 60);
    const camX = Number(a2 ?? 300), camY = Number(a3 ?? 200);
    const f = createFrame(cols, rows);
    composeWorld(THEMES[style], f, {
      world: w, time: Number(a6 ?? 3), camX, camY, glowX: (camX + cols / 2) * 4, glowY: (camY + rows / 2) * 7,
      actors: [], critters: [],
    });
    const out: string[] = [];
    for (let y = 0; y < rows; y++) out.push(String.fromCharCode(...f.ch.subarray(y * cols, (y + 1) * cols)));
    console.log(out.join("\n"));
    console.log(`\ngénération ${dt.toFixed(0)} ms`);
  }
}
