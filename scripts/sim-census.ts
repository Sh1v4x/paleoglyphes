/**
 * Graphique des populations sans affichage : simule la réserve en x16, puis dessine l'onglet
 * « Graphique » du recensement (vues Tout, Biome, Espèce) dans un calque d'interface, en texte.
 * Usage : npx tsx scripts/sim-census.ts [jours de réserve=6] [graine=1] [colonnes=200] [lignes=60]
 * Vérifie aussi l'historique : borné, colonnes alignées, sérialisable (JSON aller-retour).
 */
import { CENSUS_MAX, census } from "../game/features/census";
import type { Input } from "../game/input";
import { createFrame, type Frame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { composeGame, setMode, updateGame } from "../game/scenes";
import { SPECIES_LIST } from "../game/species";
import { createState } from "../game/state";
import { BIOME } from "../game/world/biomes";

const [days = 6, seed = 1, cols = 200, rows = 60] = process.argv.slice(2).map(Number);
let r = seed * 9301 + 49297;
Math.random = () => ((r = (r * 9301 + 49297) % 233280) / 233280);

const s = createState();
for (const spec of SPECIES_LIST) {
  const [a, b] = spec.behavior.herd;
  s.progress.population[spec.id] = Math.max(2, Math.round((a + b) / 2) + 1);
  if (!s.progress.assembled.includes(spec.id)) s.progress.assembled.push(spec.id);
}
// Calque monde : cellules de 4 x 7 px ; interface : 8 x 15 px.
Object.assign(metrics, { cols: cols * 2, rows: Math.round((rows * 15) / 7), ucols: cols, urows: rows });
setMode(s, "dig");
setMode(s, "park");
s.clockSpeed = 16;
const blank = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
const dt = 1 / 15;
const t0 = performance.now();
while (s.weather.day + s.clock / 24 < days) updateGame(s, blank(), dt);
const c = census(s);
console.log(`${days} jours simulés en ${((performance.now() - t0) / 1000).toFixed(1)} s ; ${c.t.length} relevés, ${Object.keys(c.n).length} séries`);

// Contrôles de l'historique.
const bad: string[] = [];
if (c.t.length > CENSUS_MAX) bad.push(`historique trop long : ${c.t.length}`);
for (const [k, v] of Object.entries(c.n)) if (v.length !== c.t.length) bad.push(`série ${k} désalignée (${v.length}/${c.t.length})`);
for (let i = 1; i < c.t.length; i++) if (c.t[i] <= c.t[i - 1]) bad.push(`temps non croissant au relevé ${i}`);
if (JSON.stringify(JSON.parse(JSON.stringify(c))) !== JSON.stringify(c)) bad.push("JSON aller-retour différent");
console.log(`taille JSON de l'historique : ${JSON.stringify({ t: c.t, n: c.n }).length} octets`);

const ui: Frame = createFrame(cols, rows), world: Frame = createFrame(metrics.cols, metrics.rows);
const click = (...ids: string[]) => { for (const id of ids) updateGame(s, { ...blank(), ui: [id] }, 0); };
/** Dessine l'écran et imprime le panneau du recensement (repéré par son titre). */
function show(label: string, f: Frame = ui) {
  s.toasts.length = 0; // les notifications couvriraient le panneau
  composeGame(s, world, f, 60);
  const lines: string[] = [];
  for (let y = 0; y < f.rows; y++) {
    let l = "";
    for (let x = 0; x < f.cols; x++) { const ch = f.ch[y * f.cols + x]; l += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " "; }
    lines.push(l);
  }
  const y0 = lines.findIndex((l) => l.includes(" Recensement "));
  if (y0 < 0) { console.log(lines.join("\n")); bad.push(`${label} : panneau introuvable (scène ${s.mode})`); return; }
  const x0 = lines[y0].lastIndexOf("+", lines[y0].indexOf(" Recensement "));
  const x1 = lines[y0].indexOf("+", x0 + 1);
  let y1 = y0 + 1;
  while (y1 < f.rows && lines[y1][x0] !== "+") y1++;
  console.log(`\n=== ${label} ===`);
  for (let y = y0; y <= y1; y++) console.log(lines[y].slice(x0, x1 + 1));
}

s.park.roster = true;
click("park:census:chart");
show("Tout");
click("park:census:biome");
show("Biome : Hell Creek");
c.biome = BIOME.Tundra;
show("Biome : toundra (migration)");
click("park:census:species");
c.sp = "trex"; c.selSeen = s.park.selected;
show("Espèce : Tyrannosaure");
c.sp = "edmonto";
show("Espèce : Édmontosaure");
click("park:census:all");
// Petit panneau : la légende et l'explication cèdent la place.
metrics.urows = 26;
const small = createFrame(cols, 26);
show("Tout, petit écran (26 lignes)", small);
if (bad.length) { console.log(`\nPROBLÈMES :\n- ${bad.join("\n- ")}`); process.exit(1); }
console.log("\nOK");
