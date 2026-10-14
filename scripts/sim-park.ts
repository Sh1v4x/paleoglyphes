/**
 * Simulation de la réserve sans affichage : mesure les blocages et les chevauchements.
 * Usage : npx tsx scripts/sim-park.ts [minutes de jeu=6] [graine=1]
 *
 * - « bloqué » : l'animal veut se déplacer (cible lointaine, fuite, chasse...) mais a parcouru
 *   moins de 6 px sur la dernière seconde.
 * - « chevauchement » : deux animaux vivants dont les corps se superposent nettement.
 * - cycle de vie : naissances, morts (vieillesse / prédation), nids, œufs volés, population max par espèce,
 *   et cohérence de progress.population avec les animaux vivants (écarts comptés à chaque mesure).
 * - comportements propres : Pectinodon actif la nuit / caché le jour, plongeons des pêcheurs, pontes
 *   de la tortue sur la plage (et temps hors de l'eau), bonds du Xiphactinus, chasses du mosasaure.
 * L'horloge avance comme en jeu (9 h au départ ; la nuit tombe vers 3 min 30 de jeu).
 * Pas de temps : DT=1/15 (variable d'environnement) pour simuler plus vite les longues durées.
 */
import { SPECIES, SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { parkScene } from "../game/scenes/park";
import type { Animal } from "../game/scenes/park";
import type { Input } from "../game/input";
import { worldFor } from "../game/state";
import { activeTrees } from "../game/world/trees";
import { lifeStats } from "../game/scenes/eco-nest";
import { specialStats } from "../game/scenes/eco-special";
import { deepSea } from "../game/scenes/nav";
import { stageOf } from "../game/species/life";
import { advanceClock, isNight } from "../game/daycycle";

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

const dt = process.env.DT ? eval(process.env.DT) as number : 1 / 30;
const per = Math.max(1, Math.round(1 / dt));
const steps = Math.round((minutes * 60) / dt);
const last = new Map<number, { x: number; y: number; t: number }>();
const stuck = new Map<number, number>();
const why = new Map<string, number>();
let altMax = 0, seaBad = 0, landed = 0;
let traced = 0;
const maxPop = new Map<string, number>();
let mismatch = 0, maxNests = 0, maxAll = 0;
const mis = new Set<string>();
const ov = new Map<string, number>();
let moving = 0, stuckTotal = 0, overlaps = 0, samples = 0;
/** Par espèce : secondes à vouloir bouger, secondes bloqué. */
const movSp = new Map<string, number>(), stuckSp = new Map<string, number>();
/** Tortues et nageurs hors de l'eau profonde : temps continu par animal, record. */
const dry = new Map<number, number>();
let dryMax = 0, dryMaxSp = "";
let stepMax = 0;
/** Nids vus, par espèce. */
const nestSeen = new Set<number>(), nestBy = new Map<string, number>();
const t0 = performance.now();

function wantsToMove(a: Animal): boolean {
  const t = (a as Animal & { task?: string }).task;
  if (t === "dead" || t === "rest" || t === "call" || t === "attack" || t === "stunned" || t === "defend") return false;
  // Envol, atterrissage (sur place) et ponte de la tortue (elle creuse).
  if (a.action === "takeoff" || (a.action === "land" && SPECIES[a.sp]?.habitat === "air")) return false;
  if (t === "flee" || t === "chase" || t === "hunt" || t === "retreat") return true;
  if (a.action === "eat" || a.action === "drink") return false;
  // Cycle de vie : gardien posé près du nid, petit posé près du parent, parade sur place.
  if ((a.mood === "nest" || a.mood === "young" || a.mood === "court") && (a.action === "idle" || a.action === "rest" || a.action === "call")) return false;
  // Suiveur de troupeau posé à sa place (a.vt = 0) : il ne veut pas bouger.
  if (t === "wander" && a.mood === "herd" && a.vt === 0 && a.action === "idle") return false;
  return Math.hypot(a.tx - a.x, a.ty - a.y) > 60 || a.action === "walk" || a.action === "run";
}

for (let k = 0; k < steps; k++) {
  s.time += dt;
  s.clock = advanceClock(s.clock, dt, s.clockSpeed);
  const ts = performance.now();
  parkScene.update(s, input, dt);
  if (k > per * 5) stepMax = Math.max(stepMax, performance.now() - ts);
  if (k % per !== 0) continue;
  // Une mesure par seconde.
  const live = s.park.animals.filter((a) => (a as Animal & { task?: string }).task !== "dead");
  for (const a of live) {
    const p = last.get(a.id);
    if (p && wantsToMove(a)) {
      moving++;
      movSp.set(a.sp, (movSp.get(a.sp) ?? 0) + 1);
      if (Math.hypot(a.x - p.x, a.y - p.y) < 6) {
        stuckTotal++; stuck.set(a.id, (stuck.get(a.id) ?? 0) + 1);
        stuckSp.set(a.sp, (stuckSp.get(a.sp) ?? 0) + 1);
        const key = `${(a as Animal & { task?: string }).task}/${a.action}`;
        why.set(key, (why.get(key) ?? 0) + 1);
        if (process.env.TRACE && `${a.sp}#${a.id} ${key}`.includes(process.env.TRACE) && traced++ < Number(process.env.TN ?? 25)) {
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
    // Les petits ont un corps réduit (growth) : ils peuvent se serrer contre leur parent.
    // Sauropode : seul le tronc compte (cou et queue passent au-dessus des voisins, comme dans ecosystem.ts).
    const need = (Math.min(250, SPECIES[a.sp]?.halfLen ?? 30) * a.growth + Math.min(250, SPECIES[b.sp]?.halfLen ?? 30) * b.growth) * 0.3;
    if (Math.abs(a.x - b.x) < need && Math.abs(a.y - b.y) < 8) {
      overlaps++;
      const T = (x: Animal) => `${x.sp}:${(x as Animal & { task?: string }).task}`;
      const key = [T(a), T(b)].sort().join("+") + (a.targetId === b.id || b.targetId === a.id ? " (cible)" : "");
      ov.set(key, (ov.get(key) ?? 0) + 1);
    }
  }
  for (const a of live) {
    altMax = Math.max(altMax, a.alt);
    if (a.sp === "quetzal" && a.alt === 0 && a.mood !== "fly") landed++;
    const w = worldFor(s);
    const sea = SPECIES[a.sp]?.habitat === "sea";
    if (sea && a.sp !== "archelon" && w.terrain[Math.floor(a.y / 7) * w.cols + Math.floor(a.x / 4)] !== 3) seaBad++;
    if (sea) {
      const t = deepSea(w, a.sp, a.x, a.y) ? 0 : (dry.get(a.id) ?? 0) + 1;
      dry.set(a.id, t);
      if (t > dryMax) { dryMax = t; dryMaxSp = `${a.sp}#${a.id}`; }
    }
    if (a.sp === "pectinodon" && !a.parentId) {
      const active = a.task !== "rest";
      if (isNight(s.clock)) { if (active) specialStats.nightActive++; else specialStats.nightRest++; }
      else if (active) specialStats.dayActive++; else specialStats.dayRest++;
    }
  }
  samples++;
  // Cycle de vie : population par espèce, cohérence avec la progression.
  const by = new Map<string, number>();
  for (const a of live) by.set(a.sp, (by.get(a.sp) ?? 0) + 1);
  for (const spec of SPECIES_LIST) {
    const n = by.get(spec.id) ?? 0;
    maxPop.set(spec.id, Math.max(maxPop.get(spec.id) ?? 0, n));
    if ((s.progress.population[spec.id] ?? 0) !== n) { mismatch++; mis.add(spec.id); }
  }
  maxNests = Math.max(maxNests, s.park.nests.length);
  for (const n of s.park.nests) if (!nestSeen.has(n.id)) { nestSeen.add(n.id); nestBy.set(n.sp, (nestBy.get(n.sp) ?? 0) + 1); }
  maxAll = Math.max(maxAll, live.length);
  if (process.env.LIFE && k % (per * 300) === 0) {
    console.log(`t=${(s.time / 60).toFixed(0)} min  ${SPECIES_LIST.map((sp) => `${sp.id}:${by.get(sp.id) ?? 0}`).join(" ")}  nids:${s.park.nests.length}  ${JSON.stringify(lifeStats)}`);
  }
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
const live = s.park.animals.filter((a) => a.task !== "dead");
const stages = new Map<string, number>();
for (const a of live) { const st = stageOf(SPECIES[a.sp]!, a.life); stages.set(st, (stages.get(st) ?? 0) + 1); }
console.log(`cycle de vie : naissances ${lifeStats.births} (dont ${lifeStats.liveBirths} en mer)  nids ${lifeStats.nests} (éclos ${lifeStats.hatched}, max simultanés ${maxNests})  œufs volés ${lifeStats.stolen}`);
console.log(`nids par espèce : ${[...nestBy.entries()].map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`morts : vieillesse ${lifeStats.oldAge}  prédation ${lifeStats.predation}  retirés ${lifeStats.retired}   vivants max ${maxAll}`);
console.log(`population max : ${SPECIES_LIST.map((sp) => `${sp.id}=${maxPop.get(sp.id) ?? 0}`).join("  ")}`);
console.log(`population finale : ${SPECIES_LIST.map((sp) => `${sp.id}=${live.filter((a) => a.sp === sp.id).length}`).join("  ")}   stades : ${[...stages.entries()].map(([k, n]) => `${k}=${n}`).join(" ")}`);
console.log(`progress.population incohérente : ${mismatch} mesures${mis.size ? ` (${[...mis].join(", ")})` : ""}`);
console.log(`quetzal : altitude max ${altMax.toFixed(0)} px, mesures posé ${landed}   nageurs (hors tortue) hors eau profonde : ${seaBad}   pas le plus lent : ${stepMax.toFixed(1)} ms`);
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(0)} %`;
console.log(`bloqué par espèce : ${[...movSp.entries()].sort((a, b) => (stuckSp.get(b[0]) ?? 0) / b[1] - (stuckSp.get(a[0]) ?? 0) / a[1]).map(([sp, n]) => `${sp}=${(((stuckSp.get(sp) ?? 0) / n) * 100).toFixed(1)}%`).join("  ")}`);
const S = specialStats;
console.log(`pectinodon : actif la nuit ${pct(S.nightActive, S.nightActive + S.nightRest)}, au repos le jour ${pct(S.dayRest, S.dayRest + S.dayActive)}`);
console.log(`pêcheurs : plongeons ${S.dives} (prises ${S.catches}), posés sur la plage ${S.beachLandings}`);
console.log(`archelon : voyages de ponte ${S.beachTrips}, nids sur la plage ${S.turtleNests}, retours au large ${S.turtleHome}, petits arrivés en mer ${S.hatchlingsHome}, remis à l'eau ${S.teleports}, plus long séjour hors de l'eau ${dryMax} s (${dryMaxSp})`);
console.log(`mer : bonds de xiphactinus ${S.leaps}, poursuites du mosasaure ${S.seaChases} (prises ${S.seaKills})`);
