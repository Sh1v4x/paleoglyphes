// Vérifie les sites de fouille : espèces par site, roches et bonus, fenêtre de choix. Usage : npx tsx scripts/check-dig-sites.ts
import assert from "node:assert";
import { THEMES } from "../game/palette";
import { createFrame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { SCENES } from "../game/scenes";
import { generateSite } from "../game/scenes/dig-site";
import { DIG_SITES, sitesOf } from "../game/scenes/dig-sites";
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { beginUi } from "../game/ui/kit";

for (const sp of SPECIES_LIST) console.log(sp.id.padEnd(14), sitesOf(sp.id).join(","));
assert.deepEqual(sitesOf("edmonto"), ["hellcreek", "princecreek"]);
assert.deepEqual(sitesOf("quetzal"), ["hellcreek"]);
assert.deepEqual(sitesOf("archelon"), ["niobrara"]);
assert.deepEqual(sitesOf("citipati"), ["djadochta"]);
assert.deepEqual(sitesOf("allosaurus"), ["hellcreek"]);

// Chaque site, tout débloqué : seuls ses espèces et ses bonus sortent de la roche.
const s = createState();
s.progress.assembled = SPECIES_LIST.map((sp) => sp.id).slice(0, 8);
for (const def of DIG_SITES) {
  for (let seed = 1; seed < 30; seed++) {
    const { site, missed } = generateSite(s.progress, def.id, 200, 80, seed);
    if (missed) console.log(`${def.id} graine ${seed} : ${missed} os sans place`);
    for (const f of site.fossils) {
      if (f.sp) assert(sitesOf(f.sp).includes(def.id), `${f.sp} hors de ${def.id}`);
      if (f.kind === "extra") assert(def.extras.includes(f.id), `${f.id} hors de ${def.id}`);
    }
    assert(site.fossils.some((f) => f.kind === "bone"), `pas d'os a ${def.id}`);
  }
  const { site } = generateSite(s.progress, def.id, 200, 80, 7);
  console.log(site.name, "|", site.strata.map((st) => st.name).join(" / "), "|", site.fossils.map((f) => f.label).join(", "));
}

// Fenêtre de choix des sites (interface seule).
const cols = 400, rows = 128;
Object.assign(metrics, { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols, rows, ucols: 200, urows: 60 });
s.progress.assembled = s.progress.assembled.slice(0, 3);
s.mode = "dig";
s.dig.picker = true;
const input = { dx: 0, dy: 0, pressed: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 }, ui: [], worldClicks: [] };
SCENES.dig.update(s, input, 1 / 60);
const world = createFrame(cols, rows), ui = createFrame(200, 60);
beginUi(ui, -1, -1);
SCENES.dig.compose(s, THEMES.cartoon, world, ui);
for (let y = 0; y < ui.rows; y++) console.log(String.fromCharCode(...ui.ch.slice(y * ui.cols, (y + 1) * ui.cols)).replace(/\0/g, " ").trimEnd());
// Choisir Niobrara : nouvelle falaise sur ce site, sauvegardée.
SCENES.dig.update(s, { ...input, ui: ["dig:site:niobrara"] as never[] }, 1 / 60);
assert.equal(s.dig.site?.where, "niobrara");
assert.equal(s.progress.digSite, "niobrara");
assert(!s.dig.picker);
// Site fermé : refusé.
SCENES.dig.update(s, { ...input, ui: ["dig:sites"] as never[] }, 1 / 60);
SCENES.dig.update(s, { ...input, ui: ["dig:site:djadochta"] as never[] }, 1 / 60);
assert.equal(s.dig.site?.where, "niobrara");
console.log("ok", s.progress.digSites);
