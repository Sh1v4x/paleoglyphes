/**
 * Simulation du mode documentaire sans affichage : fait tourner la réserve et affiche les moments
 * détectés (avec leur narration), puis allume le documentaire et liste les plans choisis.
 * Usage : npx tsx scripts/sim-docu.ts [minutes de jeu=6] [graine=1] [vitesse horloge=4]
 */
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { parkScene } from "../game/scenes/park";
import type { Input } from "../game/input";
import { advanceClock, clockLabel } from "../game/daycycle";
import { metrics } from "../game/render/metrics";

const minutes = Number(process.argv[2] ?? 6);
const seed = Number(process.argv[3] ?? 1);
let r = seed * 9301 + 49297;
Math.random = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
// Écran fictif (cellules monde) pour savoir ce qui est « à l'écran ».
metrics.cols = 320; metrics.rows = 110; metrics.ucols = 160; metrics.urows = 51;

const s = createState();
s.mode = "park";
s.clockSpeed = Number(process.argv[4] ?? 4);
for (const spec of SPECIES_LIST) {
  const [a, b] = spec.behavior.herd;
  s.progress.population[spec.id] = Math.max(2, Math.round((a + b) / 2) + 1);
  if (!s.progress.assembled.includes(spec.id)) s.progress.assembled.push(spec.id);
}
parkScene.enter?.(s);

const input: Input = {
  dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [],
  mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 },
};
const kinds = new Map<string, number>();
let shots = 0;
s.docu.debug = (what, m, text) => {
  const at = `J${s.docu.day} ${clockLabel(s.clock)}`;
  if (what === "moment" && m) {
    kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
    console.log(`  [${at}] ${m.kind.padEnd(9)} ${String(m.score).padStart(2)} ${m.seen ? "vu " : "   "} ${text}`);
  } else {
    shots++;
    console.log(`>> PLAN [${at}] ${m ? m.kind : "visite"} : ${text.slice(0, 110)}${text.length > 110 ? "..." : ""}`);
  }
};

const dt = 1 / 30;
const steps = Math.round((minutes * 60) / dt);
const t0 = performance.now();
let worst = 0;
for (let k = 0; k < steps; k++) {
  s.time += dt;
  s.clock = advanceClock(s.clock, dt, s.clockSpeed);
  // Seconde moitié : documentaire allumé (touche V).
  input.pressed = k === Math.floor(steps / 2) ? ["KeyV"] : [];
  if (input.pressed.length) console.log("=== Documentaire allumé ===");
  const ts = performance.now();
  parkScene.update(s, input, dt);
  worst = Math.max(worst, performance.now() - ts);
}
console.log(`\nmoments : ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`journal des manqués : ${s.docu.log.length} (non vus ${s.docu.log.filter((m) => !m.seen).length})  plans filmés : ${shots}  documentaire actif : ${s.docu.on}`);
console.log(`calcul ${((performance.now() - t0) / 1000).toFixed(1)} s, pas le plus lent ${worst.toFixed(1)} ms`);
