/**
 * Aperçu du musée sans navigateur : texte (calque monde + interface) et image PPM.
 * Usage : npx tsx scripts/preview-museum.ts [full|empty] [salle 0..4] [dark|cartoon] [cols rows] [--ppm fichier.ppm] [--sel cle] [--cam colonne]
 * ex.   : npx tsx scripts/preview-museum.ts full 1 cartoon 360 128 --ppm /tmp/hall.ppm
 */
import { writeFileSync } from "node:fs";
import type { Input } from "../game/input";
import { THEMES, type Style } from "../game/palette";
import { emptyProgress } from "../game/progress";
import { createFrame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { EXTRAS } from "../game/scenes/dig-fossils";
import { museumScene } from "../game/scenes/museum";
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { beginUi } from "../game/ui/kit";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const full = (pos[0] ?? "full") === "full";
const roomIdx = Number(pos[1] ?? "1");
const style = (pos.find((a) => a === "dark" || a === "cartoon") ?? "cartoon") as Style;
const nums = pos.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const cols = nums[0] ?? 360, rows = nums[1] ?? 128;
const ucols = Math.ceil((cols * 4) / 8), urows = Math.ceil((rows * 7) / 15);
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols, urows });

const s = createState();
s.style = style;
s.progress = emptyProgress();
const p = s.progress;
if (full) {
  for (const sp of SPECIES_LIST) {
    p.bones[sp.id] = sp.bones.map((b) => b.id);
    p.assembled.push(sp.id);
    p.population[sp.id] = 3;
    for (const f of sp.facts) p.facts.push(`${sp.id}:${f.id}`);
    p.eggs[sp.id] = 1;
  }
  p.extras = EXTRAS.map((x) => x.id);
  p.digs = 12;
} else {
  // Presque vide : quelques os d'une espèce mystère.
  p.bones.trex = ["skull"];
}
s.mode = "museum";
const input = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [`museum:room:${roomIdx}`], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
museumScene.enter?.(s);
const t0 = Date.now();
museumScene.update(s, input(), 1 / 60);
const tBake = Date.now() - t0;
for (let k = 0; k < 120; k++) { s.time += 1 / 60; museumScene.update(s, { ...input(), ui: [] }, 1 / 60); }
const sel = flag("--sel");
if (sel) s.museum.sel = sel;
const camF = flag("--cam");
if (camF) { s.museum.camX = Number(camF); s.museum.target = null; }

const world = createFrame(cols, rows), ui = createFrame(ucols, urows);
const t1 = Date.now();
beginUi(ui, -1, -1);
museumScene.compose(s, THEMES[style], world, ui);
console.log(`cuisson ${tBake} ms, image ${Date.now() - t1} ms, camX ${s.museum.camX.toFixed(0)}`);

const out: string[] = [];
for (let y = 0; y < rows; y++) {
  let line = "";
  for (let x = 0; x < cols; x++) {
    const ux = Math.floor((x * 4) / 8), uy = Math.floor((y * 7) / 15);
    const uc = ui.ch[uy * ui.cols + ux];
    const ub = ui.bg[(uy * ui.cols + ux) * 4 + 3];
    if (uc > 32 && x % 2 === 0) line += String.fromCharCode(uc);
    else if (ub > 0 || uc > 32) line += " ";
    else line += String.fromCharCode(world.ch[y * cols + x] || 32);
  }
  out.push(line.replace(/\s+$/, ""));
}
console.log(out.join("\n"));

const ppm = flag("--ppm");
if (ppm) {
  // Une cellule monde = 4x7 px, glyphe approximé par un pavé ; l'interface est posée par-dessus.
  const W = cols * 4, H = rows * 7;
  const img = Buffer.alloc(W * H * 3);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, k = i * 4;
    const glyph = world.ch[i] > 32;
    for (let py = 0; py < 7; py++) for (let px = 0; px < 4; px++) {
      const X = x * 4 + px, Y = y * 7 + py;
      const ui_i = Math.floor(Y / 15) * ucols + Math.floor(X / 8), uk = ui_i * 4;
      const o = (Y * W + X) * 3;
      const ua = ui.bg[uk + 3] / 255;
      const on = glyph && px >= 1 && px <= 2 && py >= 2 && py <= 4;
      const src = on ? world.fg : world.bg;
      let r = src[k], g = src[k + 1], b = src[k + 2];
      if (ua > 0) { r = r * (1 - ua) + ui.bg[uk] * ua; g = g * (1 - ua) + ui.bg[uk + 1] * ua; b = b * (1 - ua) + ui.bg[uk + 2] * ua; }
      const uc = ui.ch[ui_i];
      if (uc > 32 && (X % 8) >= 2 && (X % 8) <= 5 && (Y % 15) >= 4 && (Y % 15) <= 10) { r = ui.fg[uk]; g = ui.fg[uk + 1]; b = ui.fg[uk + 2]; }
      img[o] = r; img[o + 1] = g; img[o + 2] = b;
    }
  }
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  console.log(`image : ${ppm}`);
}
