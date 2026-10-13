/**
 * Simulation de la réserve sans affichage : mesure les blocages et les chevauchements.
 * Usage : npx tsx scripts/sim-park.ts [minutes de jeu=6] [graine=1]
 *
 * - « bloqué » : l'animal veut se déplacer (cible lointaine, fuite, chasse...) mais a parcouru
 *   moins de 6 px sur la dernière seconde.
 * - « chevauchement » : deux animaux vivants dont les corps se superposent nettement.
 */
import { SPECIES, SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { parkScene } from "../game/scenes/park";
import type { Animal } from "../game/scenes/park";
import type { Input } from "../game/input";
import { worldFor } from "../game/state";
import { activeTrees } from "../game/world/trees";

const minutes = Number(process.argv[2] ?? 6);
const seed = Number(process.argv[3] ?? 1);
let r = seed * 9301 + 49297;
Math.random = () => ((r = (r * 9301 + 49297) % 233280) / 233280);

const s = createState();
s.mode = "park";
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

const dt = 1 / 30;
const steps = Math.round((minutes * 60) / dt);
const last = new Map<number, { x: number; y: number; t: number }>();
const stuck = new Map<number, number>();
const why = new Map<string, number>();
let traced = 0;
const ov = new Map<string, number>();
let moving = 0, stuckTotal = 0, overlaps = 0, samples = 0;
const t0 = performance.now();

function wantsToMove(a: Animal): boolean {
  const t = (a as Animal & { task?: string }).task;
  if (t === "dead" || t === "rest" || t === "call" || t === "attack" || t === "stunned" || t === "defend") return false;
  if (t === "flee" || t === "chase" || t === "hunt" || t === "retreat") return true;
  if (a.action === "eat" || a.action === "drink") return false;
  // Suiveur de troupeau posé à sa place (a.vt = 0) : il ne veut pas bouger.
  if (t === "wander" && a.mood === "herd" && a.vt === 0 && a.action === "idle") return false;
  return Math.hypot(a.tx - a.x, a.ty - a.y) > 60 || a.action === "walk" || a.action === "run";
}

for (let k = 0; k < steps; k++) {
  s.time += dt;
  parkScene.update(s, input, dt);
  if (k % 30 !== 0) continue;
  // Une mesure par seconde.
  const live = s.park.animals.filter((a) => (a as Animal & { task?: string }).task !== "dead");
  for (const a of live) {
    const p = last.get(a.id);
    if (p && wantsToMove(a)) {
      moving++;
      if (Math.hypot(a.x - p.x, a.y - p.y) < 6) {
        stuckTotal++; stuck.set(a.id, (stuck.get(a.id) ?? 0) + 1);
        const key = `${(a as Animal & { task?: string }).task}/${a.action}`;
        why.set(key, (why.get(key) ?? 0) + 1);
        if (process.env.TRACE && `${a.sp}#${a.id} ${key}`.includes(process.env.TRACE) && traced++ < 25) {
          const A = a as Animal & Record<string, unknown>;
          const ld = s.park.animals.filter((o) => o.sp === a.sp).sort((x, y) => x.id - y.id)[0];
          console.log(`${a.sp}#${a.id} ${key} mood=${a.mood} pos=${a.x.toFixed(0)},${a.y.toFixed(0)} tgt=${a.tx.toFixed(0)},${a.ty.toFixed(0)} d=${Math.hypot(a.tx - a.x, a.ty - a.y).toFixed(0)} path=${(A.path as number[] | null)?.length ?? "-"} pi=${A.pi} blocked=${a.blocked.toFixed(1)} stuckT=${(A.stuckT as number).toFixed(1)} leader=${ld.id}@${ld.x.toFixed(0)},${ld.y.toFixed(0)} ldMoving=${ld.moving.toFixed(1)} facing=${ld.facing}`);
        }
      }
    }
    last.set(a.id, { x: a.x, y: a.y, t: s.time });
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const need = ((SPECIES[a.sp]?.halfLen ?? 30) + (SPECIES[b.sp]?.halfLen ?? 30)) * 0.3;
    if (Math.abs(a.x - b.x) < need && Math.abs(a.y - b.y) < 8) {
      overlaps++;
      const T = (x: Animal) => `${x.sp}:${(x as Animal & { task?: string }).task}`;
      const key = [T(a), T(b)].sort().join("+") + (a.targetId === b.id || b.targetId === a.id ? " (cible)" : "");
      ov.set(key, (ov.get(key) ?? 0) + 1);
    }
  }
  samples++;
}

const ms = performance.now() - t0;
const worst = [...stuck.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([id, n]) => { const a = s.park.animals.find((x) => x.id === id); return `${a?.sp ?? "?"}#${id}:${n}s`; });
console.log(`animaux : ${s.park.animals.length}  durée : ${minutes} min de jeu  (calcul ${(ms / 1000).toFixed(1)} s, ${(ms / steps).toFixed(2)} ms/pas)`);
console.log(`bloqué : ${((stuckTotal / Math.max(1, moving)) * 100).toFixed(1)} % du temps de déplacement (${stuckTotal} s sur ${moving} s)`);
console.log(`chevauchements : ${(overlaps / Math.max(1, samples)).toFixed(2)} paires en moyenne`);
console.log(`pires : ${worst.join("  ")}`);
console.log(`causes : ${[...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`paires : ${[...ov.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`arbres renversés en ce moment : ${[...activeTrees()].length} / ${worldFor(s).trees.length}`);
