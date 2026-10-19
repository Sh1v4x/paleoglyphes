/**
 * Migration des édmontosaures sans affichage : le troupeau naît dans une saison, puis l'autre arrive.
 * Usage : npx tsx scripts/sim-migration.ts [sud|nord=sud] [minutes de jeu=15]
 * - sud  : né pendant l'été polaire (toundra), l'hiver arrive : il doit descendre vers Hell Creek / le marais.
 * - nord : né pendant l'hiver, l'été arrive : il doit remonter en toundra.
 * Affiche chaque minute le biome de chaque membre (T toundra, H Hell Creek, S marais) et ce que fait le chef ;
 * se termine en erreur si le troupeau n'est pas arrivé dans sa zone de saison.
 */
import { createState, worldFor } from "../game/state";
import { parkScene } from "../game/scenes/park";
import type { Input } from "../game/input";
import { activity } from "../game/scenes/ecosystem";
import { BIOME } from "../game/world/biomes";
import { CELL_H, CELL_W } from "../game/config";

const dir = process.argv[2] === "nord" ? "nord" : "sud";
const minutes = Number(process.argv[3] ?? 15);
// Jours de l'année (voir weather.ts) : 0,5 = été polaire, 3,2 = hiver.
const [born, then] = dir === "sud" ? [0.5, 3.2] : [3.2, 0.5];
const s = createState();
s.mode = "park";
s.progress.population.edmonto = 5;
s.progress.assembled.push("edmonto");
s.weather.day = born;
parkScene.enter?.(s);
const input: Input = { dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } };
const w = worldFor(s);
const LETTER = ["H", "S", "T", "D", "M"];
const herd = () => s.park.animals.filter((a) => a.sp === "edmonto" && a.task !== "dead");
const biomeOf = (a: { x: number; y: number }) => w.biome[Math.floor(a.y / CELL_H) * w.cols + Math.floor(a.x / CELL_W)];
const report = (t: number) => {
  const ed = herd(), ld = ed.reduce((m, a) => (a.id < m.id ? a : m), ed[0]);
  console.log(`${String(t).padStart(4)} s  ${ed.map((a) => LETTER[biomeOf(a)]).join("").padEnd(12)} chef y=${(ld.y / (w.rows * CELL_H)).toFixed(2)}  « ${activity(ld)} »`);
};
const dt = 1 / 15;
report(0);
for (let k = 1; k <= minutes * 60 * 15; k++) {
  s.weather.day = then;
  parkScene.update(s, input, dt);
  if (k % (60 * 15) === 0) report(k / 15);
}
const goal = dir === "sud" ? (b: number) => b === BIOME.HellCreek || b === BIOME.Swamp : (b: number) => b === BIOME.Tundra;
const inGoal = herd().filter((a) => goal(biomeOf(a))).length / herd().length;
console.log(`${Math.round(inGoal * 100)} % du troupeau dans sa zone de saison`);
if (inGoal < 0.8) process.exit(1);
