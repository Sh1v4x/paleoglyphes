/**
 * Vérifie le carnet de voyage sans navigateur : visite d'un biome (ancienne sauvegarde sans `biomes`),
 * pas de doublon, navigation clavier et souris entre les pages.
 * Usage : npx tsx scripts/check-travel.ts
 */
import assert from "node:assert/strict";
import type { Input } from "../game/input";
import { journalScene } from "../game/scenes/journal";
import { recordVisit } from "../game/scenes/journal-travel";
import { createState } from "../game/state";
import { BIOME } from "../game/world/biomes";

const s = createState();
assert.equal(s.progress.biomes, undefined); // ancien format : champ absent
s.weather.viewBiome = BIOME.Tundra;
recordVisit(s);
recordVisit(s);
assert.deepEqual(s.progress.biomes, [BIOME.Tundra]);
assert.equal(s.toasts.length, 1);

const input = (o: Partial<Input> = {}): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [],
  mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 }, ...o });
s.mode = "journal";
journalScene.update(s, input({ ui: ["journal:tab:travel"] }), 1 / 60);
assert.equal(s.journal.tab, "travel");
const t = s.journal.travel;
assert.equal(t.biome, BIOME.HellCreek);
journalScene.update(s, input({ pressed: ["ArrowRight"] }), 1 / 60);
assert.equal(t.biome, BIOME.Swamp);
journalScene.update(s, input({ pressed: ["ArrowLeft", "ArrowLeft"] }), 1 / 60);
assert.equal(t.biome, BIOME.Sea); // boucle
journalScene.update(s, input({ ui: [`journal:tv:${BIOME.Desert}`] }), 1 / 60);
assert.equal(t.biome, BIOME.Desert);
journalScene.update(s, input({ pressed: ["ArrowDown"] }), 1 / 60);
assert.equal(t.scroll, 2);
journalScene.update(s, input({ ui: ["journal:tv:next"] }), 1 / 60);
assert.deepEqual([t.biome, t.scroll], [BIOME.Sea, 0]);
assert.equal(journalScene.back?.(s), true);
assert.equal(s.journal.tab, "species");
console.log("carnet de voyage : OK");
