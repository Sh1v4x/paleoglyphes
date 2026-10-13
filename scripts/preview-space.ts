/**
 * Aperçu terminal de la cinématique spatiale (météorite de Chicxulub).
 * Usage : npx tsx scripts/preview-space.ts [cols] [rows] [t,t,...] [color|ppm]
 * ex.   : npx tsx scripts/preview-space.ts 200 70 0.5,2,4,5.2,6.8 color
 *   ppm : écrit space-<t>.ppm (1 cellule = bloc 4x7, couleur fg/bg mêlée selon la densité du glyphe).
 */
import { writeFileSync } from "node:fs";
import { createFrame } from "../game/render/frame";
import { drawSpace } from "../game/scenes/meteor-space";

const [c = "200", r = "70", ts = "0.5,2,4,5.2,6.8", mode = ""] = process.argv.slice(2);
const cols = Number(c), rows = Number(r);
const f = createFrame(cols, rows);
const DENSE = " .'`,-:;~=+*x%#&@";
const cover = (ch: number) => {
  const j = DENSE.indexOf(String.fromCharCode(ch));
  return j < 0 ? 0.45 : (j / (DENSE.length - 1)) * 0.6;
};
for (const t of ts.split(",").map(Number)) {
  const t0 = performance.now();
  drawSpace(f, t);
  const ms = performance.now() - t0;
  if (mode === "ppm") {
    const W = cols * 4, H = rows * 7, px = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = Math.floor(y / 7) * cols + Math.floor(x / 4), k = i * 4, a = cover(f.ch[i]);
      // Le glyphe occupe le centre de la cellule.
      const inG = x % 4 >= 1 && x % 4 <= 2 && y % 7 >= 1 && y % 7 <= 5 ? Math.min(1, a * 2.2) : a * 0.3;
      for (let q = 0; q < 3; q++) px[(y * W + x) * 3 + q] = f.bg[k + q] + (f.fg[k + q] - f.bg[k + q]) * inG;
    }
    writeFileSync(`space-${t}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), px]));
    console.log(`t=${t} ${ms.toFixed(1)} ms`);
    continue;
  }
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, k = i * 4;
      const ch = String.fromCharCode(f.ch[i] || 32);
      line += mode === "color"
        ? `\x1b[38;2;${f.fg[k]};${f.fg[k + 1]};${f.fg[k + 2]}m\x1b[48;2;${f.bg[k]};${f.bg[k + 1]};${f.bg[k + 2]}m${ch}`
        : ch;
    }
    out.push(mode === "color" ? line + "\x1b[0m" : line.replace(/\s+$/, ""));
  }
  console.log(`--- t=${t} (${ms.toFixed(1)} ms) ---\n${out.join("\n")}`);
}
