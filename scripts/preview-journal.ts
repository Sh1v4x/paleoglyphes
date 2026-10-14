/**
 * Aperçu terminal du carnet (sans navigateur) : compose une page et l'affiche en ASCII.
 * Le calque d'interface est posé sur le calque monde (échantillonné à la résolution de l'interface),
 * ou le calque monde seul en pleine résolution avec « world ».
 * Usage : npx tsx scripts/preview-journal.ts [summary|extras|timeline|quiz|sizes|<espece>] [dark|cartoon] [skeleton] [world] [cols rows]
 *         options : « game » (frise : mini-jeu), « answer » (quiz : répond A), « nofacts » (quiz sans faits),
 *                   « sizes:<espece> » et « ref:<cat|elephant|giraffe|bus|whale|none> » (tailles)
 * ex.   : npx tsx scripts/preview-journal.ts trike cartoon
 *         npx tsx scripts/preview-journal.ts ankylo dark skeleton world
 */
import type { Input } from "../game/input";
import { THEMES, type Style } from "../game/palette";
import { createFrame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { journalScene } from "../game/scenes/journal";
import { SPECIES, SPECIES_LIST } from "../game/species";
import type { SpeciesId } from "../game/species/types";
import { createState } from "../game/state";
import { beginUi } from "../game/ui/kit";

const args = process.argv.slice(2);
const page = args[0] ?? "summary";
const style = (args.find((a) => a === "dark" || a === "cartoon") ?? "cartoon") as Style;
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const ucols = nums[0] ?? 160, urows = nums[1] ?? 48;
const cols = ucols * 2, rows = Math.round((urows * 15) / 7);
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols, urows });

const s = createState();
s.style = style;
// Progression de démonstration : quelques os, un squelette assemblé, des faits débloqués.
const p = s.progress;
SPECIES_LIST.forEach((sp, i) => {
  if (i === SPECIES_LIST.length - 1) return; // la dernière espèce reste inconnue
  p.bones[sp.id] = sp.bones.slice(0, Math.max(1, sp.bones.length - i)).map((b) => b.id);
  if (i % 2 === 0) p.assembled.push(sp.id);
  p.population[sp.id] = i + 1;
  sp.facts.slice(0, 2 + (i % 3)).forEach((f) => p.facts.push(`${sp.id}:${f.id}`));
});
p.extras.push("fauna:pterosaur", "fauna:dragonfly", "ambre-moustique");
if (args.includes("nofacts")) p.facts = [];
s.journal.species = SPECIES[page as SpeciesId] ? (page as SpeciesId) : undefined;
if (page === "timeline" || page === "quiz" || page === "sizes") s.journal.tab = page;
const opt = (k: string) => args.find((a) => a.startsWith(`${k}:`))?.slice(k.length + 1);
if (opt("sizes")) s.journal.sizes.sp = opt("sizes") as SpeciesId;
if (opt("ref")) s.journal.sizes.ref = opt("ref") as typeof s.journal.sizes.ref;
s.journal.extras = page === "extras";
s.journal.skeleton = args.includes("skeleton");
s.mode = "journal";
s.time = 0.4;

const world = createFrame(cols, rows), ui = createFrame(ucols, urows);
beginUi(ui, -1, -1);
journalScene.enter?.(s);
// Un pas de logique sans entrée (le quiz tire sa première question), puis les clics simulés.
const input = (ui: string[] = []): Input => ({ dx: 0, dy: 0, pressed: [], ui, worldClicks: [],
  mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
journalScene.update(s, input(), 1 / 60);
if (args.includes("game")) journalScene.update(s, input(["journal:tl:game"]), 1 / 60);
if (args.includes("answer")) journalScene.update(s, input(["journal:q:opt:0"]), 1 / 60);
journalScene.compose(s, THEMES[style], world, ui);

const out: string[] = [];
if (args.includes("world")) {
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) line += String.fromCharCode(world.ch[y * cols + x] || 32);
    out.push(line.replace(/\s+$/, ""));
  }
} else {
  for (let y = 0; y < urows; y++) {
    let line = "";
    for (let x = 0; x < ucols; x++) {
      const c = ui.ch[y * ucols + x];
      if (c && c !== 32) { line += String.fromCharCode(c); continue; }
      // Pas d'interface ici : on échantillonne le calque monde (cellule la plus remplie du bloc 2x2).
      const wx = Math.floor((x * 8) / 4), wy = Math.floor((y * 15) / 7);
      let ch = 32;
      for (let j = 0; j < 2 && ch === 32; j++) for (let i = 0; i < 2 && ch === 32; i++) {
        const k = (wy + j) * cols + wx + i;
        const w = world.ch[k];
        if (w && w !== 32 && w !== 95) ch = w;
      }
      line += String.fromCharCode(c === 32 && ui.bg[(y * ucols + x) * 4 + 3] > 0 ? 32 : ch);
    }
    out.push(line.replace(/\s+$/, ""));
  }
}
console.log(out.join("\n"));
