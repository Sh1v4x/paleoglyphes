/**
 * Vérification de l'interface sans navigateur : rend chaque écran à plusieurs tailles de fenêtre,
 * écrit une image PNG (monde + calque d'interface, un glyphe = un pavé de sa couleur) et un vidage
 * texte du calque d'interface, puis contrôle la mise en page :
 * - aucun panneau fixe ne chevauche un autre (les superpositions voulues sont marquées `overlay`) ;
 * - aucun bouton ne chevauche un autre bouton, ni ne déborde d'un panneau qu'il touche ;
 * - rien ne sort de l'écran, rien n'empiète sur l'en-tête ni sur la ligne d'aide du bas ;
 * - aucun texte coupé par le bord de l'écran.
 * Usage : npx tsx scripts/ui-snap.ts [dossier=/tmp/ui-snap] [filtre d'écran] [filtre de taille]
 * Code de sortie 1 s'il reste des problèmes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { Input } from "../game/input";
import { createFrame, type Frame } from "../game/render/frame";
import { metrics } from "../game/render/metrics";
import { composeGame, setMode, updateGame } from "../game/scenes";
import { HEADER_ROWS } from "../game/scenes/types";
import { settings, type UiScale } from "../game/settings";
import { SPECIES_LIST } from "../game/species";
import { createState, type GameState } from "../game/state";
import { album } from "../game/features/photo-store";
import type { Moment } from "../game/features/documentary";
import { moveFocus, setFocus, uiLog, type UiRect } from "../game/ui/kit";
import { toast } from "../game/ui/toast";

const [dir = "/tmp/ui-snap", only = "", sizeOnly = ""] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });

const SIZES: { name: string; w: number; h: number; k: UiScale }[] = [
  { name: "1024x640", w: 1024, h: 640, k: 1 },
  { name: "1280x720", w: 1280, h: 720, k: 1 },
  { name: "1440x900", w: 1440, h: 900, k: 1 },
  { name: "1920x1080", w: 1920, h: 1080, k: 1 },
  { name: "1920x1080@1.5", w: 1920, h: 1080, k: 1.5 },
  { name: "1280x720@1.25", w: 1280, h: 720, k: 1.25 },
];

const blank = (): Input => ({ dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 } });
const step = (s: GameState, n = 1, inp?: Partial<Input>) => { for (let i = 0; i < n; i++) updateGame(s, { ...blank(), ...inp }, 1 / 60); };

// --- État de départ : tout débloqué, réserve peuplée -------------------------------------------
const s = createState();
for (const spec of SPECIES_LIST) {
  s.progress.bones[spec.id] = spec.bones.map((b) => b.id);
  if (!s.progress.assembled.includes(spec.id)) s.progress.assembled.push(spec.id);
  s.progress.population[spec.id] = 2;
  for (const f of spec.facts.slice(0, 3)) s.progress.facts.push(`${spec.id}:${f.id}`);
}
s.progress.extras = ["fauna:dragonfly"];
s.progress.hints = 2;
metrics.cols = 320; metrics.rows = 103;
setMode(s, "dig");
setMode(s, "park");
step(s, 90);
// Une photo factice pour l'album.
const ph = { cols: 120, rows: 60 };
album.loaded = true;
album.photos.push({
  id: "test", day: 3, clock: 14.5, real: Date.UTC(2026, 3, 2), title: "Tricératops au bord de l'eau", stars: 3, species: ["trike"], notes: ["Sujet net", "Belle lumière"],
  ...ph, ch: new Uint8Array(ph.cols * ph.rows).fill(35), fg: new Uint8Array(ph.cols * ph.rows * 3).fill(120), bg: new Uint8Array(ph.cols * ph.rows * 3).fill(40),
});
// Quelques moments manqués pour le journal du documentaire.
for (let i = 0; i < 4; i++) {
  s.docu.log.push({ id: 900 + i, kind: "fight" as Moment["kind"], sp: "trex", text: `Un T. rex attaque un troupeau de Tricératops au bord du lac (${i}).`, x: 2000, y: 1500, subject: 0, score: 5, t: 0, day: 1, clock: 10 + i, seen: false, shown: false });
}

/** Préparations d'écran : partent toujours de la réserve calme. */
function reset() {
  s.menu.open = false; s.menu.page = "main"; s.menu.confirm = false; s.help = false;
  s.park.selected = undefined; s.park.roster = false; s.park.nestSel = undefined; s.park.bug = undefined; s.park.confirmRetire = undefined;
  s.docu.on = false; s.docu.listOpen = false; s.photo.aiming = false;
  s.journal.species = undefined; s.journal.extras = false; s.journal.tab = "species";
  s.museum.sel = null; s.photos.view = -1; s.photos.confirm = false;
  s.toasts = [];
  s.mouse = { x: -1, y: -1 };
  setFocus(undefined);
}
const firstAnimal = () => s.park.animals.find((a) => a.task !== "dead")!;

/** `post` : appelé après une première image (zones connues), avant l'image finale. */
const SCREENS: { name: string; setup: () => void; post?: () => void }[] = [
  { name: "park", setup: () => setMode(s, "park") },
  { name: "park-sel", setup: () => { setMode(s, "park"); s.park.selected = firstAnimal().id; s.park.roster = true; toast(s, "Nouvelle entree au carnet !", "Le Tricératops mange : un fait de plus."); } },
  { name: "park-log", setup: () => { setMode(s, "park"); s.docu.listOpen = true; } },
  { name: "park-docu", setup: () => { setMode(s, "park"); s.docu.on = true; s.docu.since = s.time - 10; } },
  { name: "park-photo", setup: () => { setMode(s, "park"); s.photo.aiming = true; } },
  { name: "park-help", setup: () => { setMode(s, "park"); s.help = true; } },
  // Focus clavier (3 x Tab) et infobulle au survol du premier bouton de la barre d'outils.
  { name: "park-focus", setup: () => setMode(s, "park"), post: () => { moveFocus(1); moveFocus(1); moveFocus(1); } },
  { name: "park-tip", setup: () => { setMode(s, "park"); s.mouse = { x: 40 * metrics.uiW, y: 4.5 * metrics.uiH }; } },
  { name: "dig", setup: () => setMode(s, "dig") },
  { name: "lab", setup: () => setMode(s, "lab") },
  { name: "journal", setup: () => setMode(s, "journal") },
  { name: "journal-species", setup: () => { setMode(s, "journal"); s.journal.species = "trike"; } },
  { name: "journal-extras", setup: () => { setMode(s, "journal"); s.journal.extras = true; } },
  { name: "journal-timeline", setup: () => { setMode(s, "journal"); s.journal.tab = "timeline"; } },
  { name: "journal-quiz", setup: () => { setMode(s, "journal"); s.journal.tab = "quiz"; step(s, 1); } },
  { name: "journal-sizes", setup: () => { setMode(s, "journal"); s.journal.tab = "sizes"; } },
  { name: "museum", setup: () => setMode(s, "museum") },
  { name: "photos", setup: () => setMode(s, "photos") },
  { name: "photos-view", setup: () => { setMode(s, "photos"); s.photos.view = 0; } },
  { name: "menu", setup: () => { setMode(s, "park"); s.menu.open = true; s.menu.index = 0; } },
  { name: "settings", setup: () => { setMode(s, "park"); s.menu.open = true; s.menu.page = "settings"; } },
];

// --- PNG minimal ---------------------------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b: Buffer) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgb: Buffer) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function image(world: Frame, ui: Frame, W: number, H: number, uw: number, uh: number) {
  const img = Buffer.alloc(W * H * 3);
  for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
    const i = y * world.cols + x, k = i * 4, glyph = world.ch[i] > 32;
    for (let py = 0; py < 7; py++) for (let px = 0; px < 4; px++) {
      const X = x * 4 + px, Y = y * 7 + py;
      if (X >= W || Y >= H) continue;
      const src = glyph && px >= 1 && px <= 2 && py >= 2 && py <= 4 ? world.fg : world.bg;
      const o = (Y * W + X) * 3;
      img[o] = src[k]; img[o + 1] = src[k + 1]; img[o + 2] = src[k + 2];
    }
  }
  for (let y = 0; y < ui.rows; y++) for (let x = 0; x < ui.cols; x++) {
    const i = y * ui.cols + x, k = i * 4, a = ui.bg[k + 3] / 255, glyph = ui.ch[i] > 32;
    for (let py = 0; py < uh; py++) for (let px = 0; px < uw; px++) {
      const X = Math.floor(x * uw + px), Y = Math.floor(y * uh + py);
      if (X >= W || Y >= H) continue;
      const o = (Y * W + X) * 3;
      for (let c = 0; c < 3; c++) img[o + c] = img[o + c] * (1 - a) + ui.bg[k + c] * a;
      const on = glyph && px >= 2 && px < uw - 2 && py >= 4 && py < uh - 4 && (px + py) % 2 === 0;
      if (on) for (let c = 0; c < 3; c++) img[o + c] = ui.fg[k + c];
    }
  }
  return png(W, H, img);
}

function dump(ui: Frame) {
  const lines: string[] = [];
  for (let y = 0; y < ui.rows; y++) {
    let l = "";
    for (let x = 0; x < ui.cols; x++) { const c = ui.ch[y * ui.cols + x]; l += c >= 32 && c < 127 ? String.fromCharCode(c) : " "; }
    lines.push(l.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

// --- Contrôles ------------------------------------------------------------------------------------
const inter = (a: UiRect, b: UiRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: UiRect, b: UiRect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const fmt = (r: UiRect) => `${r.kind}:${r.id || "?"}@${r.x},${r.y} ${r.w}x${r.h}`;

function check(ui: Frame, rects: UiRect[], clipped: typeof uiLog.clipped, header: boolean): string[] {
  const out: string[] = [];
  const fixed = rects.filter((r) => r.kind !== "overlay" && !r.id.startsWith("tab:") && !["menu:open", "help:open"].includes(r.id));
  const panels = fixed.filter((r) => r.kind === "panel"), buttons = fixed.filter((r) => r.kind === "button");
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) if (inter(panels[i], panels[j])) out.push(`panneaux qui se chevauchent : ${fmt(panels[i])} / ${fmt(panels[j])}`);
  for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) if (inter(buttons[i], buttons[j]) && buttons[i].id !== buttons[j].id) out.push(`boutons qui se chevauchent : ${fmt(buttons[i])} / ${fmt(buttons[j])}`);
  for (const b of buttons) for (const p of panels) if (inter(b, p) && !inside(b, p)) out.push(`bouton à cheval sur un panneau : ${fmt(b)} / ${fmt(p)}`);
  for (const r of rects) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > ui.cols || r.y + r.h > ui.rows) out.push(`hors de l'écran : ${fmt(r)}`);
    if (r.kind === "overlay") continue;
    if (header && r.y < HEADER_ROWS && !r.id.startsWith("tab:") && !["menu:open", "help:open"].includes(r.id)) out.push(`sur l'en-tête : ${fmt(r)}`);
    if (header && r.y + r.h > ui.rows - 1) out.push(`sur la ligne d'aide : ${fmt(r)}`);
  }
  for (const c of clipped) out.push(`texte coupé (${c.x},${c.y}) : "${c.t.slice(0, 50)}"`);
  return [...new Set(out)];
}

// --- Rendu ---------------------------------------------------------------------------------------
uiLog.enabled = true;
let problems = 0;
for (const size of SIZES) {
  if (sizeOnly && !size.name.includes(sizeOnly)) continue;
  settings.uiScale = size.k;
  const uw = 8 * size.k, uh = 15 * size.k;
  const cols = Math.ceil(size.w / 4), rows = Math.ceil(size.h / 7);
  const ucols = Math.floor(size.w / uw), urows = Math.floor(size.h / uh);
  Object.assign(metrics, { cellW: 4, cellH: 7, uiW: uw, uiH: uh, cols, rows, ucols, urows });
  const world = createFrame(cols, rows), ui = createFrame(ucols, urows);
  for (const sc of SCREENS) {
    if (only && !sc.name.startsWith(only)) continue;
    reset();
    sc.setup();
    s.time += 1; // notifications posées, infobulles prêtes
    // Deux images : la seconde voit les zones de la première (survols, focus).
    composeGame(s, world, ui, 60);
    sc.post?.();
    s.time += 1;
    composeGame(s, world, ui, 60);
    const name = `${sc.name}-${size.name}`;
    writeFileSync(`${dir}/${name}.png`, image(world, ui, size.w, size.h, uw, uh));
    writeFileSync(`${dir}/${name}.txt`, dump(ui));
    const issues = check(ui, uiLog.rects, uiLog.clipped, s.mode !== "meteor" && !s.menu.open);
    problems += issues.length;
    console.log(`${issues.length ? "!!" : "ok"} ${name}${issues.length ? "" : ""}`);
    for (const i of issues) console.log(`     - ${i}`);
  }
}
console.log(problems ? `\n${problems} problème(s).` : "\nAucun problème.");
process.exit(problems ? 1 : 0);
