/**
 * Test de la sauvegarde de la réserve, sans navigateur (localStorage simulé).
 * Usage : npx tsx scripts/test-save.ts [minutes de jeu=2]
 *
 * 1. Simule la réserve (horloge x16 : jours, météo, saisons), renverse quelques arbres, sauvegarde.
 * 2. Recharge dans un état neuf (monde régénéré) : la sauvegarde relue doit être identique à l'originale,
 *    décor et collisions compris (arbres renversés retirés de la carte).
 * 3. Continue la simulation de la réserve rechargée, puis vérifie qu'une sauvegarde abîmée est ignorée.
 */
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

import { advanceClock } from "../game/daycycle";
import type { Input } from "../game/input";
import { clearSave, loadReserve, saveReserve, serializeReserve } from "../game/save";
import { prepareEcosystem } from "../game/scenes/ecosystem";
import { parkScene } from "../game/scenes/park";
import { SPECIES_LIST } from "../game/species";
import { createState, worldFor, type GameState } from "../game/state";
import { knockTree } from "../game/world/trees";

const KEY = "paleoglyphes:reserve";
const minutes = Number(process.argv[2] ?? 2);
let r = 12345;
Math.random = () => ((r = (r * 9301 + 49297) % 233280) / 233280);

const input: Input = {
  dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [],
  mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 },
};
const dt = 1 / 15;
function run(s: GameState, sec: number) {
  for (let k = 0; k < sec / dt; k++) {
    s.time += dt;
    advanceClock(s, dt);
    parkScene.update(s, input, dt);
  }
}

// 1. Une réserve qui vit.
const s1 = createState();
for (const spec of SPECIES_LIST) {
  s1.progress.population[spec.id] = 3;
  s1.progress.assembled.push(spec.id);
}
parkScene.enter?.(s1);
s1.clockSpeed = 16;
s1.park.hideMap = true;
s1.park.zoom = 3;
const w1 = worldFor(s1);
run(s1, minutes * 30);
// Quelques arbres renversés, à différents moments de leur vie.
for (const t of w1.trees.filter((t) => t.state === "up").slice(0, 40)) knockTree(w1, t, t.id % 2 ? 1 : -1);
run(s1, minutes * 30);
s1.park.selected = s1.park.animals[0]?.id;
// Un feu en cours (il vise un arbre debout : gardé par son id).
s1.weather.fires.push({ tree: w1.trees.find((t) => t.state === "up")!, t: 2.5, out: false });
assert.ok(saveReserve(s1), "sauvegarde écrite");
const json = store.get(KEY)!;
const down = w1.trees.filter((t) => t.state !== "up").length;
console.log(`réserve : ${s1.park.animals.length} animaux, ${s1.park.nests.length} nids, jour ${s1.weather.day + 1} (${s1.weather.kind}), ${down} arbres hors décor, ${s1.weather.fires.length} feux`);
const parts = JSON.parse(json) as Record<string, unknown>;
console.log(`taille de la sauvegarde : ${(json.length / 1024).toFixed(1)} Ko (${json.length} caractères) ;`,
  Object.entries(parts).map(([k, v]) => `${k} ${(JSON.stringify(v).length / 1024).toFixed(1)}`).join(", "));
assert.ok(json.length < 1_000_000, "sauvegarde sous 1 Mo");
assert.ok(down > 0, "des arbres sont renversés");

// 2. Rechargement dans un état neuf (comme Game.tsx : monde, écosystème, puis la sauvegarde).
const s2 = createState();
const w2 = worldFor(s2);
assert.notEqual(w1, w2, "monde régénéré");
prepareEcosystem(s2);
assert.ok(loadReserve(s2), "sauvegarde relue");
assert.equal(serializeReserve(s2), json, "la réserve relue est identique à l'originale");
assert.equal(s2.park.selected, undefined, "la sélection n'est pas gardée");
assert.equal(s2.park.hideMap, true);
assert.equal(s2.park.zoom, 3);
assert.ok(Math.abs(s2.clock - s1.clock) < 1e-3, "horloge");
// Décor : aucun arbre renversé n'y reste (même sous un voisin), collisions identiques.
let ghost = 0, solid = 0;
for (let i = 0; i < w2.decorMat.length; i++) {
  const o = w2.decorOwner[i];
  if (o >= 0 && w2.trees[o] && w2.trees[o].state !== "up") ghost++;
  if (w1.solid[i] !== w2.solid[i]) solid++;
}
console.log(`décor : ${ghost} cellules d'arbres renversés, ${solid} collisions différentes`);
assert.equal(ghost, 0, "arbres renversés retirés du décor");
assert.equal(solid, 0, "collisions identiques");

// 3. La réserve rechargée continue de vivre.
const pos = new Map(s2.park.animals.map((a) => [a.id, a.x + a.y]));
run(s2, 30);
const moved = s2.park.animals.filter((a) => pos.has(a.id) && pos.get(a.id) !== a.x + a.y).length;
console.log(`après rechargement : ${moved} animaux ont bougé en 30 s, jour ${s2.weather.day + 1}`);
assert.ok(moved > 0, "les animaux bougent");
for (const spec of SPECIES_LIST) {
  const live = s2.park.animals.filter((a) => a.sp === spec.id && a.task !== "dead").length;
  assert.equal(s2.progress.population[spec.id] ?? 0, live, `population ${spec.id}`);
}

// Sauvegardes abîmées ou d'une autre version : ignorées et effacées, sans erreur.
for (const bad of ["{", "null", "[]", '{"v":99}', json.replace('"v":1', '"v":2'), json.slice(0, json.length / 2), json.replace(/"veg":"[^"]*"/, '"veg":"AAAA"')]) {
  const s3 = createState();
  store.set(KEY, bad);
  assert.equal(loadReserve(s3), false, `rejetée : ${bad.slice(0, 20)}`);
  assert.equal(store.has(KEY), false, "sauvegarde abîmée effacée");
}
store.set(KEY, json);
clearSave();
assert.equal(store.has(KEY), false, "Tout recommencer efface la sauvegarde");
console.log("OK");
