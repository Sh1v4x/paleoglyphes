/**
 * Aperçu de la météo de la réserve (sans navigateur) : une image par ciel / événement forcé, et le coût
 * de drawWeather par image.
 * Usage : npx tsx scripts/preview-weather.ts [dossier] [heure]
 * Produit des PPM (une cellule = 4x7 px, glyphe approximé par un pavé de sa couleur) et affiche un extrait texte.
 */
import { writeFileSync } from "node:fs";
import { metrics } from "../game/render/metrics";
import { createFrame } from "../game/render/frame";
import { composeGame, setMode, updateGame } from "../game/scenes";
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { THEMES } from "../game/palette";
import { drawWeather, forceWeather, seasonName, temperature, weatherLabel } from "../game/features/weather";
import type { Input } from "../game/input";

const [dir = ".", hour = "11"] = process.argv.slice(2);
// ~46k cellules : la taille d'un grand écran.
const cols = 360, rows = 129;
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols: 180, urows: 60 });
const world = createFrame(cols, rows), ui = createFrame(180, 60);
const input = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });

function ppm(name: string) {
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
  writeFileSync(`${dir}/weather-${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
}

// « seche » : ciel clair en pleine saison sèche (végétation jaunie, mares basses, poussière).
const KINDS = ["clear", "seche", "cloudy", "rain", "storm", "snow", "fog", "heat", "incendie", "crue", "etoiles"] as const;
for (const name of KINDS) {
  const kind = name === "seche" ? "clear" : name;
  const s = createState();
  for (const spec of SPECIES_LIST) { s.progress.population[spec.id] = 2; s.progress.assembled.push(spec.id); }
  setMode(s, "park");
  s.clock = Number(hour);
  if (name === "seche") s.weather.day = 3;
  for (let k = 0; k < 30; k++) updateGame(s, input(), 1 / 60);
  forceWeather(s, kind);
  // x16 : les niveaux convergent et la neige s'accumule en ~2 s de jeu.
  s.clockSpeed = 16;
  const frames = kind === "incendie" ? 100 : 150;
  for (let k = 0; k < frames; k++) updateGame(s, input(), 1 / 60);
  // Orage : un éclair au milieu de l'écran, 0,3 s après son départ (tracé visible, flash qui retombe).
  if (kind === "storm") { s.weather.bolt = { x: Math.floor(s.park.cam.x / 4) + 150, y: Math.floor(s.park.cam.y / 7) + 58, t0: s.time - 0.3, seed: 5 }; s.weather.boomAt = s.time; }
  if (kind === "etoiles") s.clock = 23;
  composeGame(s, world, ui, 60);
  ppm(name);
  const crop: string[] = [];
  for (let y = 50; y < 62; y++) {
    let line = "";
    for (let x = 100; x < 200; x++) line += String.fromCharCode(world.ch[y * cols + x] || 32);
    crop.push(line);
  }
  // Coût : drawWeather répété sur la même image (les effets se cumulent, seul le temps compte).
  const th = THEMES[s.style];
  const camX = Math.floor(s.park.cam.x / 4), camY = Math.floor(s.park.cam.y / 7);
  let best = Infinity;
  for (let r = 0; r < 12; r++) {
    const t0 = performance.now();
    drawWeather(s, th, world, camX, camY);
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`--- ${name}: ${weatherLabel(s)} | ${seasonName(s)} | ${temperature(s)} C | lv=${JSON.stringify(s.weather.lv, (_, v) => typeof v === "number" ? +v.toFixed(2) : v)} snow=${s.weather.snowCover.toFixed(2)} fires=${s.weather.fires.length} | drawWeather ${best.toFixed(2)} ms`);
  console.log(crop.join("\n"));
}
