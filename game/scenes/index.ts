import { DEV } from "../config";
import type { Input } from "../input";
import { advanceClock } from "../daycycle";
import { THEMES } from "../palette";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { saveSettings, settings, UI_SCALES, type UiScale } from "../settings";
import { SPECIES_LIST } from "../species";
import type { GameState } from "../state";
import {
  actions, ascii, beginUi, overlay, button, drawFocus, drawTooltip, fill, focusedId, hintLine, hitAt, keyChip, moveFocus, over,
  panel, put, region, resetUi, setFocus, SP, text, wrap, type Hint,
} from "../ui/kit";
import { drawMenu, drawSettings, MENU_ITEMS } from "../ui/menu";
import { drawToasts, toast } from "../ui/toast";
import { digScene } from "./dig";
import { journalScene } from "./journal";
import { labScene } from "./lab";
import { meteorScene } from "./meteor";
import { museumScene } from "./museum";
import { photosScene } from "./photos";
import { parkScene, syncPopulation } from "./park";
import { HEADER_ROWS, type Mode, type Scene } from "./types";

export const SCENES: Record<Mode, Scene> = { dig: digScene, lab: labScene, park: parkScene, journal: journalScene, museum: museumScene, photos: photosScene, meteor: meteorScene };

/** Onglets : touche, icône ASCII (un caractère) et libellé. */
const TABS: { mode: Mode; label: string; icon: string; key: string; tip: string }[] = [
  { mode: "park", label: "Reserve", icon: "Y", key: "1", tip: "Reserve : observer les dinosaures vivants" },
  { mode: "dig", label: "Fouille", icon: "T", key: "2", tip: "Fouille : degager des fossiles" },
  { mode: "lab", label: "Atelier", icon: "+", key: "3", tip: "Atelier : assembler les squelettes" },
  { mode: "journal", label: "Carnet", icon: "=", key: "4", tip: "Carnet : fiches, frise, quiz, tailles" },
  { mode: "museum", label: "Musee", icon: "^", key: "5", tip: "Musee : ta collection exposee" },
  { mode: "photos", label: "Photos", icon: "@", key: "6", tip: "Photos : l'album du photo-safari" },
];
const TAB_NAME: Record<Mode, string> = { park: "Reserve", dig: "Fouille", lab: "Atelier", journal: "Carnet", museum: "Musee", photos: "Photos", meteor: "Cinematique" };
// Style dark fantasy mis de côté pour l'instant : seul le cartoon est proposé.
// const STYLES: Style[] = ["dark", "cartoon"];
/** Nombre de lignes du menu Échap (voir MENU_ITEMS). */
export const MENU_ROWS = MENU_ITEMS.length;

/** Commandes valables partout (fenêtre d'aide). */
const GLOBAL_HELP: Hint[] = [
  ["1 a 6", "changer d'ecran"],
  ["Tab", "bouton suivant (Maj+Tab : precedent)"],
  ["Entree", "activer le bouton choisi (ou Espace)"],
  ["Echap", "fermer / revenir, puis menu"],
  ["H", "ouvrir / fermer cette aide"],
];

export function setMode(s: GameState, m: Mode) {
  if (s.mode === m) return;
  s.mode = m;
  s.help = false;
  setFocus(undefined);
  SCENES[m].enter?.(s);
}

/** Mode test : tout débloquer pour essayer la réserve et l'atelier sans fouiller. */
function unlockAll(s: GameState) {
  const p = s.progress;
  for (const spec of SPECIES_LIST) {
    p.bones[spec.id] = spec.bones.map((b) => b.id);
    if (!p.assembled.includes(spec.id)) p.assembled.push(spec.id);
    // Comme un vrai assemblage : les faits « assemble » rejoignent le carnet (sans notification).
    for (const f of spec.facts) if (f.unlock === "assemble" && !p.facts.includes(`${spec.id}:${f.id}`)) p.facts.push(`${spec.id}:${f.id}`);
    const [a, b] = spec.behavior.herd;
    p.population[spec.id] = Math.max(p.population[spec.id] ?? 0, Math.round((a + b) / 2));
  }
  saveProgress(p);
  syncPopulation(s);
  toast(s, "Mode test", "Tous les os, squelettes et dinosaures sont debloques.");
}

function openMenu(s: GameState) {
  s.menu.open = true;
  s.menu.index = 0;
  s.menu.confirm = false;
  s.menu.page = "main";
  s.help = false;
}

function closeMenu(s: GameState) {
  s.menu.open = false;
  s.menu.confirm = false;
  s.menu.page = "main";
  setFocus(undefined);
}

function activateMenu(s: GameState, byKey: boolean) {
  const m = s.menu;
  // Ligne « Style » désactivée (dark fantasy de côté) :
  // s.style = STYLES[(STYLES.indexOf(s.style) + 1) % STYLES.length]; worldFor(s);
  const item = MENU_ITEMS[m.index];
  if (item === "resume") closeMenu(s);
  else if (item === "settings") { m.page = "settings"; m.confirm = false; setFocus(`set:scale:${settings.uiScale}`, byKey); }
  else if (item === "unlock") { unlockAll(s); m.confirm = false; }
  else if (item === "restart") {
    // Tout recommencer : une confirmation, puis la météorite.
    if (!m.confirm) { m.confirm = true; return; }
    closeMenu(s);
    setMode(s, "meteor");
  }
}

/** Action d'un bouton des réglages. */
function settingsAction(s: GameState, id: string) {
  if (id === "set:back") { s.menu.page = "main"; setFocus(undefined); return; }
  if (id.startsWith("set:scale:")) {
    const k = Number(id.slice(10)) as UiScale;
    if (UI_SCALES.includes(k)) settings.uiScale = k;
  } else if (id === "set:motion") settings.reduceMotion = !settings.reduceMotion;
  else if (id === "set:fps") settings.showFps = !settings.showFps;
  saveSettings();
}

function updateMenu(s: GameState, input: Input) {
  const m = s.menu;
  if (m.page === "settings") {
    for (const k of input.pressed) {
      if (k === "Escape" || k === "Backspace") { settingsAction(s, "set:back"); return; }
      if (k === "Tab" || k === "ArrowDown" || k === "ArrowRight") moveFocus(1);
      if (k === "ShiftTab" || k === "ArrowUp" || k === "ArrowLeft") moveFocus(-1);
      if (k === "Enter" || k === "Space") {
        const id = focusedId();
        if (id) settingsAction(s, id);
        if (m.page !== "settings") return;
      }
    }
    for (const c of input.mouse.clicks) {
      const id = hitAt(c.x, c.y);
      if (id?.startsWith("set:")) settingsAction(s, id);
      if (m.page !== "settings") return;
    }
    return;
  }
  for (const k of input.pressed) {
    if (k === "Escape" || k === "Backspace") {
      // Échap annule d'abord la confirmation, puis ferme le menu.
      if (m.confirm) m.confirm = false;
      else closeMenu(s);
      return;
    }
    if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ" || k === "ShiftTab") { m.index = (m.index + MENU_ROWS - 1) % MENU_ROWS; m.confirm = false; }
    if (k === "ArrowDown" || k === "KeyS" || k === "Tab") { m.index = (m.index + 1) % MENU_ROWS; m.confirm = false; }
    if (k === "Enter" || k === "Space" || k === "ArrowRight" || k === "KeyD") activateMenu(s, true);
    if (!m.open || m.page !== "main") return;
  }
  // La souris : survoler choisit, cliquer valide.
  const hover = hitAt(input.mouse.x, input.mouse.y);
  if (hover?.startsWith("menurow:") && Number(hover.slice(8)) !== m.index) { m.index = Number(hover.slice(8)); m.confirm = false; }
  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id?.startsWith("menurow:")) { m.index = Number(id.slice(8)); activateMenu(s, false); }
    else closeMenu(s); // clic hors du panneau : on referme
    if (!m.open || m.page !== "main") return;
  }
}

/** Fenêtre d'aide : H, Échap ou un clic la referment. */
function updateHelp(s: GameState, input: Input) {
  for (const k of input.pressed) if (k === "Escape" || k === "KeyH" || k === "Backspace" || k === "Enter") { s.help = false; return; }
  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id === "help:close" || !id) { s.help = false; return; }
  }
}

/** Logique globale : menu Échap, aide, onglets, focus clavier, routage des clics, puis la scène courante. */
export function updateGame(s: GameState, input: Input, dt: number) {
  s.time += dt;
  s.clock = advanceClock(s.clock, dt, s.clockSpeed);
  s.mouse.x = input.mouse.x;
  s.mouse.y = input.mouse.y;
  // Cinématique : elle a la main (pas de menu ni d'onglets ; Échap la passe).
  if (s.mode === "meteor") { SCENES.meteor.update(s, input, dt); return; }
  if (s.menu.open) { updateMenu(s, input); return; }
  if (s.help) { updateHelp(s, input); return; }
  const scene = SCENES[s.mode];

  // Touches du cœur : elles sont retirées de `pressed` une fois utilisées (la scène ne les voit pas).
  const keep: string[] = [];
  for (const k of input.pressed) {
    if (k === "Tab" || k === "ShiftTab") { moveFocus(k === "Tab" ? 1 : -1); continue; }
    if (k === "Enter" || k === "Space") {
      // Un bouton a le focus clavier : Entrée / Espace l'activent (sinon : raccourci de la scène).
      const id = focusedId();
      if (id) { input.ui.push(id); continue; }
    }
    if (k === "Escape" || k === "Backspace") {
      if (!scene.back?.(s) && k === "Escape") { openMenu(s); return; }
      continue;
    }
    if (k === "KeyH") { s.help = true; return; }
    const tab = TABS.find((t) => k === `Digit${t.key}`);
    if (tab) { setMode(s, tab.mode); continue; }
    keep.push(k);
  }
  input.pressed = keep;

  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id) input.ui.push(id);
    else input.worldClicks.push(c);
  }
  // Boutons du cœur (clic ou clavier) : onglets, menu, aide.
  const rest: string[] = [];
  for (const id of input.ui) {
    if (id.startsWith("tab:")) setMode(s, id.slice(4) as Mode);
    else if (id === "menu:open") { openMenu(s); return; }
    else if (id === "help:open") { s.help = true; return; }
    else if (!id.startsWith("status:")) rest.push(id);
  }
  input.ui = rest;
  SCENES[s.mode].update(s, input, dt);
}

// ---------------------------------------------------------------------------
// En-tête
// ---------------------------------------------------------------------------

type TabStyle = "full" | "label" | "icon";
const tabW = (t: (typeof TABS)[number], st: TabStyle) => 3 + (st === "icon" ? 3 : st === "label" ? t.label.length + 2 : t.label.length + 4);

/**
 * En-tête : une bande de 3 lignes (marge, contenu, filet) détachée du bord de la fenêtre.
 * Titre à gauche, onglets (touche, icône, libellé), état de la collection, Aide et Menu à droite.
 * Fenêtre étroite : le titre disparaît, puis l'état se résume, puis les onglets passent en icônes.
 */
function drawHeader(s: GameState, th: Theme, ui: Frame, fps: number) {
  const u = th.ui;
  fill(ui, 0, 0, ui.cols, HEADER_ROWS, u.panel, u.alpha);
  for (let x = 0; x < ui.cols; x++) put(ui, x, HEADER_ROWS - 1, 45, u.border, u.panel, u.alpha);
  const y = 1;
  const bones = Object.values(s.progress.bones).reduce((n, l) => n + (l?.length ?? 0), 0);
  const chips: { id: string; long: string; short: string; tip: string }[] = [
    { id: "os", long: `Os ${bones}`, short: `Os ${bones}`, tip: "Os trouves en fouille" },
    { id: "sp", long: `Especes ${s.progress.assembled.length}/${SPECIES_LIST.length}`, short: `Esp ${s.progress.assembled.length}/${SPECIES_LIST.length}`, tip: "Especes assemblees a l'atelier" },
    { id: "facts", long: `Faits ${s.progress.facts.length}`, short: `F ${s.progress.facts.length}`, tip: "Faits decouverts dans le carnet" },
  ];
  const fpsT = DEV && settings.showFps ? `FPS ${fps.toFixed(0).padStart(3)}` : "";
  const statusW = (k: "long" | "short" | "none") => (k === "none" ? 0 : chips.reduce((n, c) => n + c[k].length + 2, 0) + 1);
  const helpW = 11, menuW = 15; // « [ Aide  H ] », « [ Menu  Echap ] »
  const right = helpW + SP.gap + menuW + 2 + (fpsT ? fpsT.length + 2 : 0);
  const tabsW = (st: TabStyle) => TABS.reduce((n, t) => n + tabW(t, st), 0) + (TABS.length - 1) * SP.gap;
  const options: [boolean, TabStyle, "long" | "short" | "none"][] = [
    [true, "full", "long"], [false, "full", "long"], [false, "full", "short"], [false, "label", "short"],
    [false, "label", "none"], [false, "icon", "short"], [false, "icon", "none"],
  ];
  const fit = options.find(([t, st, k]) => 2 + (t ? 16 : 0) + tabsW(st) + 2 + statusW(k) + right <= ui.cols) ?? options[options.length - 1];
  const [showTitle, tabStyle, statusKind] = fit;

  let x = 2;
  if (showTitle) x += text(ui, x, y, "PALEOGLYPHES", u.hi, u.panel, u.alpha) + 4;
  for (const t of TABS) {
    const on = s.mode === t.mode;
    const w = tabW(t, tabStyle);
    const hov = over(x, y, w, 1);
    const bg = on ? u.hi : hov ? u.panelAlt : u.panel, fg = on ? u.panel : hov ? u.hi : u.text;
    fill(ui, x, y, w, 1, bg, u.alpha);
    keyChip(ui, th, x, y, t.key);
    const lab = tabStyle === "icon" ? t.icon : tabStyle === "label" ? t.label : `${t.icon} ${t.label}`;
    text(ui, x + 4, y, lab, fg, bg, u.alpha);
    // Onglet courant : souligné sur le filet (forme, pas seulement couleur).
    if (on) for (let i = 0; i < w; i++) put(ui, x + i, HEADER_ROWS - 1, 61, u.hi, u.panel, u.alpha);
    region(`tab:${t.mode}`, x, y, w, 1, { focus: true, tip: `${t.tip}  (touche ${t.key})` });
    x += w + SP.gap;
  }
  let rx = ui.cols - 2 - menuW;
  button(ui, th, "menu:open", rx, y, "Menu", { key: "Echap", w: menuW, tip: "Pause : reglages, mode test, recommencer" });
  rx -= helpW + SP.gap;
  button(ui, th, "help:open", rx, y, "Aide", { key: "H", w: helpW, tip: "Toutes les commandes de cet ecran" });
  if (fpsT) { rx -= fpsT.length + 2; text(ui, rx, y, fpsT, u.dim, u.panel, u.alpha); }
  if (statusKind !== "none") {
    let sx = rx - statusW(statusKind) - 1;
    if (sx > x) {
      for (const c of chips) {
        const t = c[statusKind];
        text(ui, sx, y, t, u.text, u.panel, u.alpha);
        region(`status:${c.id}`, sx, y, t.length, 1, { tip: c.tip });
        sx += t.length + 2;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fenêtre d'aide
// ---------------------------------------------------------------------------

function drawHelp(s: GameState, th: Theme, ui: Frame) {
  const u = th.ui;
  const scene = SCENES[s.mode];
  const local = scene.help?.(s) ?? scene.hints?.(s) ?? [];
  const W = Math.min(76, ui.cols - 2 * SP.margin), iw = W - 2 * SP.pad;
  const keyW = Math.min(18, Math.max(...[...GLOBAL_HELP, ...local].map(([k]) => ascii(k).length + 2)));
  const rowsOf = (list: readonly Hint[]) => list.map(([k, l]) => ({ k, lines: wrap(l, iw - keyW - 2) }));
  const g = rowsOf(GLOBAL_HELP), l = rowsOf(local);
  const count = (r: { lines: string[] }[]) => r.reduce((n, q) => n + q.lines.length, 0);
  const H = Math.min(ui.rows - 2, 3 + count(g) + (l.length ? 2 + count(l) : 0) + 3);
  const x = Math.floor((ui.cols - W) / 2), y = Math.max(HEADER_ROWS, Math.floor((ui.rows - H) / 2));
  panel(ui, th, x, y, W, H, `Aide - ${TAB_NAME[s.mode]}`, { close: "help:close", overlay: true });
  let yy = y + 2;
  const block = (title: string, rows: { k: string; lines: string[] }[]) => {
    text(ui, x + SP.pad, yy++, title, u.hi, u.panel, u.alpha);
    for (const r of rows) {
      if (yy >= y + H - 3) return;
      keyChip(ui, th, x + SP.pad, yy, r.k);
      r.lines.forEach((t, i) => { if (yy + i < y + H - 3) text(ui, x + SP.pad + keyW + 1, yy + i, t, u.text, u.panel, u.alpha); });
      yy += r.lines.length;
    }
  };
  block("Partout", g);
  if (l.length) { yy++; block(`Dans cet ecran (${TAB_NAME[s.mode]})`, l); }
  actions(ui, th, x + SP.pad, y + H - 2, iw, [{ id: "help:close", label: "Fermer", key: "H", variant: "primary" }]);
}

/** Dessine la scène courante, puis l'en-tête, la ligne d'aide, les notifications, l'aide et le menu. */
export function composeGame(s: GameState, world: Frame, ui: Frame, fps: number) {
  const th = THEMES[s.style];
  beginUi(ui, s.mouse.x, s.mouse.y, s.time);
  const scene = SCENES[s.mode];
  scene.compose(s, th, world, ui);

  if (s.mode !== "meteor") {
    drawHeader(s, th, ui, fps);
    const hints = scene.hints?.(s);
    if (hints) hintLine(ui, th, hints, [["H", "aide"]]);
  }
  drawToasts(s, th, ui);
  if (s.help && s.mode !== "meteor") overlay(() => drawHelp(s, th, ui));
  if (s.menu.open) {
    resetUi(ui);
    drawMenu(s, th, world);
    if (s.menu.page === "settings") overlay(() => drawSettings(s, th, ui));
  }
  drawTooltip(ui, th);
  drawFocus(ui, th);
}
