/**
 * Essais du son sans navigateur : parties pures (limiteur, atténuation, voix des espèces), recettes jouées
 * dans un faux AudioContext qui vérifie chaque valeur programmée, puis une partie entière sans Web Audio
 * (le moteur doit rester muet et ne rien casser) et avec le faux contexte (observateur et ambiance).
 * Usage : npx tsx scripts/test-sound.ts
 */
import assert from "node:assert/strict";
import { createLimiter, play, SFX_NAMES, spatial, unlockAudio } from "../game/features/sound";
import { pitchOf, voiceOf } from "../game/features/sound-watch";
import { SPECIES, SPECIES_LIST } from "../game/species";
import type { SpeciesId } from "../game/species/types";
import { createState } from "../game/state";
import { setMode, updateGame } from "../game/scenes";
import type { Input } from "../game/input";

// Limiteur : 2 voix au plus, même son espacé de 0,5 s.
const lim = createLimiter(2);
assert.equal(lim("a", 0, 0.5, 1), true);
assert.equal(lim("a", 0.2, 0.5, 1), false, "même son trop tôt");
assert.equal(lim("b", 0.2, 0.5, 1), true);
assert.equal(lim("c", 0.3, 0, 1), false, "plus de 2 voix");
assert.equal(lim("c", 1.05, 0, 1), true, "une voix s'est terminée");
// Un troupeau de 60 cris en 0,6 s (5 espèces) : un seul cri par espèce passe.
const herd = createLimiter(12);
let n = 0;
for (let i = 0; i < 60; i++) if (herd(`sp${i % 5}`, i * 0.01, 1.2, 1.5)) n++;
assert.equal(n, 5);

// Atténuation et panoramique.
assert.deepEqual(spatial(100, 100, 100, 100, 50, 50), { gain: 1, pan: 0 });
const edge = spatial(150, 100, 100, 100, 50, 50);
assert.ok(Math.abs(edge.gain - 0.25) < 1e-9 && edge.pan === 0.8, "bord droit : un quart, à droite");
assert.equal(spatial(300, 100, 100, 100, 50, 50).gain, 0, "loin : silence");
assert.ok(spatial(60, 100, 100, 100, 50, 50).pan < 0, "à gauche");

// Voix des espèces.
const sp = (id: SpeciesId) => SPECIES[id]!;
const voices: [SpeciesId, string][] = [["edmonto", "trumpet"], ["trex", "growl"], ["velociraptor", "chirp"], ["trike", "honk"], ["alamosaurus", "rumble"], ["pteranodon", "cry"], ["mosa", "splash"]];
for (const [id, v] of voices) assert.equal(voiceOf(sp(id)), v, id);
assert.ok(pitchOf(sp("trex")) < pitchOf(sp("velociraptor")), "le T. rex est plus grave");
assert.ok(pitchOf(sp("trex"), 0.4) > pitchOf(sp("trex")), "un petit est plus aigu");
console.log("voix :", SPECIES_LIST.map((s) => `${s.id}=${voiceOf(s)}@${pitchOf(s).toFixed(0)}Hz`).join(" "));

// Sans Web Audio : une partie entière tourne, muette.
const blank = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
const s = createState();
// Une réserve peuplée, comme scripts/sim-park.ts.
for (const spec of SPECIES_LIST) {
  const [a, b] = spec.behavior.herd;
  s.progress.population[spec.id] = Math.max(2, Math.round((a + b) / 2) + 1);
  if (!s.progress.assembled.includes(spec.id)) s.progress.assembled.push(spec.id);
}
// Faux contexte audio (plus bas) : son horloge avance avec la partie.
const fakes: { currentTime: number }[] = [];
const tour = () => {
  for (const m of ["park", "dig", "lab", "journal", "park"] as const) {
    setMode(s, m);
    for (let i = 0; i < 120; i++) { if (fakes[0]) fakes[0].currentTime += 1 / 60; updateGame(s, blank(), 1 / 60); }
  }
  updateGame(s, { ...blank(), pressed: ["KeyB"] }, 1 / 60);
  updateGame(s, { ...blank(), pressed: ["KeyB"] }, 1 / 60);
};
unlockAudio();
tour();
console.log("partie sans Web Audio : ok,", s.park.animals.length, "animaux");

// Faux AudioContext : chaque valeur programmée doit être finie, une rampe exponentielle jamais <= 0.
let checked = 0, nodes = 0;
const param = (name: string) => {
  const check = (x: number, exp = false) => {
    assert.ok(Number.isFinite(x), `${name} : valeur ${x}`);
    if (exp) assert.ok(x > 0, `${name} : rampe exponentielle vers ${x}`);
    checked++;
  };
  return {
    set value(x: number) { check(x); },
    get value() { return 0; },
    setValueAtTime: (x: number, t: number) => { check(x); check(t); },
    linearRampToValueAtTime: (x: number, t: number) => { check(x); check(t); },
    exponentialRampToValueAtTime: (x: number, t: number) => { check(x, true); check(t); },
    setTargetAtTime: (x: number, t: number, c: number) => { check(x); check(t); check(c, true); },
  };
};
const node = () => {
  nodes++;
  return {
    gain: param("gain"), frequency: param("frequency"), Q: param("Q"), pan: param("pan"),
    threshold: param("threshold"), knee: param("knee"), ratio: param("ratio"), attack: param("attack"), release: param("release"),
    connect: (d: unknown) => { assert.ok(d, "connect vers rien"); return d; },
    disconnect: () => {},
    start: (t = 0) => assert.ok(Number.isFinite(t)),
    stop: (t = 0) => assert.ok(Number.isFinite(t)),
  };
};
class FakeContext {
  constructor() { fakes.push(this); }
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  destination = node();
  createGain = node; createBiquadFilter = node; createOscillator = node; createBufferSource = node;
  createStereoPanner = node; createDynamicsCompressor = node;
  createBuffer(ch: number, len: number) {
    const d = Array.from({ length: ch }, () => new Float32Array(len));
    return { getChannelData: (i: number) => d[i] };
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}
const g = globalThis as unknown as { AudioContext: unknown; setTimeout: unknown };
const realTimeout = g.setTimeout;
g.AudioContext = FakeContext;
g.setTimeout = () => 0;
unlockAudio();
const before = nodes;
// Chaque son 10 s après le précédent : le limiteur les laisse tous passer.
for (const name of SFX_NAMES) { fakes[0].currentTime += 10; play(name, { gain: 0.5, pan: -0.3, p: name === "approach" ? 4 : 90 }); }
const played = nodes - before;
console.log(`${SFX_NAMES.length} recettes jouées : ${played} noeuds`);
assert.ok(played > SFX_NAMES.length * 3, "chaque recette crée ses noeuds");
// Avec le faux contexte, l'observateur et l'ambiance tournent sur une vraie partie.
tour();
g.setTimeout = realTimeout;
console.log(`partie avec le faux contexte : ok (${nodes} noeuds, ${checked} valeurs vérifiées)`);
console.log("tous les essais du son passent");
