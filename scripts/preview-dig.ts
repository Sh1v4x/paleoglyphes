/**
 * Aperçu terminal de la fouille ou de l'atelier (calque monde + interface en texte brut).
 * Usage : npx tsx scripts/preview-dig.ts [dig|lab|labsynth] [dark|cartoon] [dug 0..1] [cols] [rows] [synthT 0..1] [espece]
 *   dug : part du sédiment retirée partout (pour voir les fossiles), ex. 1.
 */
import { THEMES, type Style } from "../game/palette";
import { createFrame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { SCENES } from "../game/scenes";
import { SPECIES } from "../game/species";
import { createState } from "../game/state";
import { beginUi } from "../game/ui/kit";

const [mode = "dig", style = "cartoon", dug = "0", c = "400", r = "128"] = process.argv.slice(2);
const cols = Number(c), rows = Number(r);
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols: Math.ceil((cols * 4) / 8), urows: Math.ceil((rows * 7) / 15) });
const s = createState();
s.style = style as Style;
s.mode = mode === "dig" ? "dig" : "lab";
const world = createFrame(cols, rows), ui = createFrame(metrics.ucols, metrics.urows);
const input = { dx: 0, dy: 0, pressed: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 }, ui: [], worldClicks: [] };
const synthAt = mode === "labsynth" ? Number(process.argv[7] ?? "0.5") : -1;
if (mode.startsWith("lab")) {
  const sp = (process.argv[8] ?? "ankylo") as "ankylo";
  const spec = SPECIES[sp]!;
  s.mode = "lab";
  s.progress.bones[sp] = synthAt >= 0 ? spec.bones.map((b) => b.id) : spec.bones.slice(0, 4).map((b) => b.id);
  if (synthAt >= 0) s.lab.placed[sp] = spec.bones.map((b) => b.id);
  s.lab.species = sp;
}
SCENES[s.mode].enter?.(s);
SCENES[s.mode].update(s, input, 1 / 60);
if (mode === "dig" && s.dig.site) {
  const site = s.dig.site;
  for (let k = 0; k < site.cover.length; k++) {
    site.cover[k] = Math.max(0, site.cover[k] - Number(dug) * site.cover0[k]);
    if (site.cover[k] < 0.05) { site.cover[k] = 0; if (site.owner[k] >= 0) site.fossils[site.owner[k]].exposed++; }
  }
  console.log(site.name, site.fossils.map((f) => `${f.label}${f.dup ? " (doublon)" : ""}`).join(", "));
}
s.time = 10;
if (synthAt >= 0 && s.lab.species) s.lab.synth = { sp: s.lab.species, t0: s.time - synthAt * 2.5 };
beginUi(ui, -1, -1);
SCENES[s.mode].compose(s, THEMES[s.style], world, ui);
// Superpose l'interface (approximativement : 1 cellule UI = 2 x ~2 cellules monde).
const out: string[] = [];
for (let y = 0; y < rows; y++) {
  let line = "";
  for (let x = 0; x < cols; x++) {
    const ux = Math.floor((x * 4) / 8), uy = Math.floor((y * 7) / 15);
    const uc = ui.ch[uy * ui.cols + ux];
    const ub = ui.bg[(uy * ui.cols + ux) * 4 + 3];
    if (uc > 32 && x % 2 === 0) line += String.fromCharCode(uc);
    else if (ub > 0 || (uc > 32)) line += " ";
    else line += String.fromCharCode(world.ch[y * cols + x] || 32);
  }
  out.push(line.replace(/\s+$/, ""));
}
console.log(out.join("\n"));
