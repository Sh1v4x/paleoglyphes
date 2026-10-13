/**
 * Images fixes de la cinématique de la météorite (sans navigateur), pour régler les effets.
 * Usage : npx tsx scripts/snap-meteor.ts <dossier> <t1,t2,...>   (t en s depuis le début de la cinématique)
 * Produit des PPM (une cellule = 4x7 px, glyphe approximé par un pavé de sa couleur).
 */
import { writeFileSync } from "node:fs";
import { metrics } from "../game/render/metrics";
import { createFrame } from "../game/render/frame";
import { composeGame, setMode, updateGame } from "../game/scenes";
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import type { Input } from "../game/input";

const [dir = ".", list = "8,9.5,11,13,15,18"] = process.argv.slice(2);
const times = list.split(",").map(Number);
const cols = 360, rows = 129;
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols: 180, urows: 60 });
const world = createFrame(cols, rows), ui = createFrame(180, 60);
const s = createState();
for (const spec of SPECIES_LIST) { s.progress.population[spec.id] = 3; s.progress.assembled.push(spec.id); }
setMode(s, "park");
const input = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
for (let k = 0; k < 120; k++) updateGame(s, input(), 1 / 60);
setMode(s, "meteor");
let t = 0;
for (const target of times) {
  while (t < target) { updateGame(s, input(), 1 / 60); t += 1 / 60; }
  composeGame(s, world, ui, 60);
  const W = cols * 4, H = rows * 7;
  const img = Buffer.alloc(W * H * 3);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, k = i * 4;
    const glyph = world.ch[i] > 32;
    for (let py = 0; py < 7; py++) for (let px = 0; px < 4; px++) {
      const on = glyph && px >= 1 && px <= 2 && py >= 2 && py <= 4;
      const src = on ? world.fg : world.bg;
      const o = ((y * 7 + py) * W + x * 4 + px) * 3;
      img[o] = src[k]; img[o + 1] = src[k + 1]; img[o + 2] = src[k + 2];
    }
  }
  writeFileSync(`${dir}/meteor-${target}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  console.log(`t=${target} mode=${s.mode} animaux=${s.park.animals.length} (morts ${s.park.animals.filter((a) => a.task === "dead").length})`);
}
