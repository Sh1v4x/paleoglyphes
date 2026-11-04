/**
 * Aperçu des saisons par biome (sans navigateur) : pour chaque biome, une image en saison des pluies /
 * été polaire et une en saison sèche / hiver, plus la nuit polaire (aurore), le soleil de minuit, une
 * tempête de sable et le désert après la pluie. Affiche le coût de drawWeather par image.
 * Usage : npx tsx scripts/preview-seasons.ts [dossier] [dark|cartoon]
 * Produit des PNG (une cellule = 4x7 px, glyphe approximé par un pavé de sa couleur).
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { CELL_H, CELL_W } from "../game/config";
import { stepField } from "../game/features/lenia";
import { drawWeather, plantGrowth, seenDaylight, seenPeriod, temperature, weatherLabel, YEAR_DAYS } from "../game/features/weather";
import type { Input } from "../game/input";
import { THEMES, type Style } from "../game/palette";
import { createFrame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { composeGame, setMode, updateGame } from "../game/scenes";
import { createState, worldFor } from "../game/state";
import { BIOME } from "../game/world/biomes";
import { T } from "../game/world/tiles";

const [dir = ".", style = "dark"] = process.argv.slice(2);
const cols = 240, rows = 90;
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols: 120, urows: 42 });
const world = createFrame(cols, rows), ui = createFrame(120, 42);
const input = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });

function png(name: string) {
  const W = cols * 4, H = rows * 7, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const k = (y * cols + x) * 4, glyph = world.ch[y * cols + x] > 32;
    for (let py = 0; py < 7; py++) for (let px = 0; px < 4; px++) {
      const src = glyph && px >= 1 && px <= 2 && py >= 2 && py <= 4 ? world.fg : world.bg;
      const o = (y * 7 + py) * (W * 3 + 1) + 1 + (x * 4 + px) * 3;
      raw[o] = src[k]; raw[o + 1] = src[k + 1]; raw[o + 2] = src[k + 2];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(W, 0); hdr.writeUInt32BE(H, 4); hdr[8] = 8; hdr[9] = 2;
  writeFileSync(`${dir}/season-${style}-${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", hdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** Une case d'eau du biome (au milieu de la liste), pour cadrer rive et végétation ensemble. */
function spot(b: number): { x: number; y: number } {
  const w = worldFor(s0);
  const hits: number[] = [];
  for (let i = 0; i < w.terrain.length; i += 7) if (w.biome[i] === b && w.terrain[i] === T.Shallow) hits.push(i);
  const i = hits[Math.floor(hits.length * 0.5)];
  return { x: i % w.cols, y: Math.floor(i / w.cols) };
}

const s0 = createState();
s0.style = style as Style;
type Shot = { name: string; biome: number; frac: number; hour: number; sand?: boolean; bloom?: number };
const SHOTS: Shot[] = [
  { name: "hellcreek-pluies", biome: BIOME.HellCreek, frac: 0.2, hour: 11 },
  { name: "hellcreek-seche", biome: BIOME.HellCreek, frac: 0.7, hour: 11 },
  { name: "marais-pluies", biome: BIOME.Swamp, frac: 0.2, hour: 11 },
  { name: "marais-seche", biome: BIOME.Swamp, frac: 0.7, hour: 11 },
  { name: "alaska-ete-midi", biome: BIOME.Tundra, frac: 0.25, hour: 12 },
  { name: "alaska-ete-minuit", biome: BIOME.Tundra, frac: 0.25, hour: 0.5 },
  { name: "alaska-hiver-midi", biome: BIOME.Tundra, frac: 0.75, hour: 12 },
  { name: "alaska-hiver-nuit", biome: BIOME.Tundra, frac: 0.75, hour: 22 },
  { name: "gobi-seche", biome: BIOME.Desert, frac: 0.7, hour: 13 },
  { name: "gobi-tempete", biome: BIOME.Desert, frac: 0.7, hour: 13, sand: true },
  { name: "gobi-apres-pluie", biome: BIOME.Desert, frac: 0.2, hour: 11, bloom: 1 },
];
for (const sh of SHOTS) {
  const s = createState();
  s.style = style as Style;
  setMode(s, "park");
  // Jour de l'année : YEAR_START = 0,06, une année = YEAR_DAYS jours.
  const days = ((sh.frac - 0.06 + 1) % 1) * YEAR_DAYS;
  for (let k = 0; k < 5; k++) updateGame(s, input(), 1 / 60);
  const at = spot(sh.biome);
  s.park.cam.x = at.x * CELL_W - (cols * 4) / 2; s.park.cam.y = at.y * CELL_H - (rows * 7) / 2;
  s.weather.day = Math.floor(days); s.clock = sh.hour; s.weather.prevClock = sh.hour;
  // Les vues locales (biome, toundra, neige) rejoignent leur cible : quelques secondes de jeu à x16.
  s.clockSpeed = 16;
  for (let k = 0; k < 120; k++) { updateGame(s, input(), 1 / 60); s.clock = sh.hour; s.weather.prevClock = sh.hour; }
  if (sh.sand) s.weather.sand = 1;
  if (sh.bloom !== undefined) s.weather.bloom = sh.bloom;
  // Végétation Lenia : on la laisse s'installer selon la saison (comme ecosystem.ts).
  const veg = s.park.eco?.veg;
  if (veg) { veg.sigma = Math.max(0.5, Math.min(2, 0.5 + 0.8 * plantGrowth(s))); for (let k = 0; k < 60; k++) stepField(veg); }
  composeGame(s, world, ui, 60);
  png(sh.name);
  const th = THEMES[s.style], camX = Math.floor(s.park.cam.x / 4), camY = Math.floor(s.park.cam.y / 7);
  // Coût : médiane de drawWeather répété sur la même image (une fois le code chaud).
  const times: number[] = [];
  for (let r = 0; r < 80; r++) { const t0 = performance.now(); drawWeather(s, th, world, camX, camY); times.push(performance.now() - t0); }
  const best = times.sort((a, b) => a - b)[40];
  const st = s.weather;
  console.log(`--- ${sh.name}: ${weatherLabel(s)} | ${seenPeriod(s)} | lumiere ${seenDaylight(s).toFixed(2)} | ${temperature(s)} C | polar ${st.viewPolar.toFixed(2)} neige ${st.viewSnow.toFixed(2)} sable ${st.sand.toFixed(2)} | toasts: ${s.toasts.map((t) => t.title).join(" / ")} | drawWeather ${best.toFixed(2)} ms`);
}
