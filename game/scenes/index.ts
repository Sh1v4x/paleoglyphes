import { DEV } from "../config";
import type { Input } from "../input";
import { advanceClock } from "../daycycle";
import { THEMES } from "../palette";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { SPECIES_LIST } from "../species";
import type { GameState } from "../state";
import { beginUi, button, fill, hitAt, resetUi, text } from "../ui/kit";
import { drawMenu } from "../ui/menu";
import { drawToasts, toast } from "../ui/toast";
import { digScene } from "./dig";
import { journalScene } from "./journal";
import { labScene } from "./lab";
import { meteorScene } from "./meteor";
import { parkScene, syncPopulation } from "./park";
import { HEADER_ROWS, type Mode, type Scene } from "./types";

export const SCENES: Record<Mode, Scene> = { dig: digScene, lab: labScene, park: parkScene, journal: journalScene, meteor: meteorScene };
const TABS: { mode: Mode; label: string; key: string }[] = [
  { mode: "dig", label: "1  Fouille", key: "Digit1" },
  { mode: "lab", label: "2  Atelier", key: "Digit2" },
  { mode: "park", label: "3  Reserve", key: "Digit3" },
  { mode: "journal", label: "4  Carnet", key: "Digit4" },
];
// Style dark fantasy mis de côté pour l'instant : seul le cartoon est proposé.
// const STYLES: Style[] = ["dark", "cartoon"];
/** Lignes du menu Échap : 0 mode test, 1 tout recommencer, 2 reprendre. */
export const MENU_ROWS = 3;

export function setMode(s: GameState, m: Mode) {
  if (s.mode === m) return;
  s.mode = m;
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

function activateMenu(s: GameState) {
  const m = s.menu;
  // Ligne « Style » désactivée (dark fantasy de côté) :
  // s.style = STYLES[(STYLES.indexOf(s.style) + 1) % STYLES.length]; worldFor(s);
  if (m.index === 0) unlockAll(s);
  else if (m.index === 1) {
    // Tout recommencer : une confirmation, puis la météorite.
    if (!m.confirm) { m.confirm = true; return; }
    m.confirm = false;
    m.open = false;
    setMode(s, "meteor");
  } else m.open = false;
}

function updateMenu(s: GameState, input: Input) {
  const m = s.menu;
  for (const k of input.pressed) {
    if (k === "Escape") { m.open = false; m.confirm = false; return; }
    if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ") { m.index = (m.index + MENU_ROWS - 1) % MENU_ROWS; m.confirm = false; }
    if (k === "ArrowDown" || k === "KeyS") { m.index = (m.index + 1) % MENU_ROWS; m.confirm = false; }
    if (k === "Enter" || k === "Space" || k === "ArrowRight" || k === "KeyD") activateMenu(s);
    if (!m.open) return;
  }
  // La souris : survoler choisit, cliquer valide.
  const hover = hitAt(input.mouse.x, input.mouse.y);
  if (hover?.startsWith("menurow:") && Number(hover.slice(8)) !== m.index) { m.index = Number(hover.slice(8)); m.confirm = false; }
  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id?.startsWith("menurow:")) { m.index = Number(id.slice(8)); activateMenu(s); }
    else m.open = false; // clic hors du panneau : on referme
    if (!m.open) return;
  }
}

/** Logique globale : menu Échap, onglets, routage des clics, puis la scène courante. */
export function updateGame(s: GameState, input: Input, dt: number) {
  s.time += dt;
  s.clock = advanceClock(s.clock, dt, s.clockSpeed);
  s.mouse.x = input.mouse.x;
  s.mouse.y = input.mouse.y;
  // Cinématique : elle a la main (pas de menu ni d'onglets ; Échap la passe).
  if (s.mode === "meteor") { SCENES.meteor.update(s, input, dt); return; }
  if (s.menu.open) {
    updateMenu(s, input);
    return;
  }
  if (input.pressed.includes("Escape")) { s.menu.open = true; s.menu.index = 0; return; }
  for (const t of TABS) if (input.pressed.includes(t.key)) setMode(s, t.mode);
  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id?.startsWith("tab:")) setMode(s, id.slice(4) as Mode);
    else if (id === "menu:open") { s.menu.open = true; s.menu.index = 0; return; }
    else if (id) input.ui.push(id);
    else input.worldClicks.push(c);
  }
  SCENES[s.mode].update(s, input, dt);
}

/**
 * En-tête : une bande de 3 lignes (marge, contenu, filet) détachée du bord de la fenêtre.
 * Titre à gauche, onglets bien espacés, état de la collection et bouton Menu à droite.
 */
function drawHeader(s: GameState, th: Theme, ui: Frame) {
  const u = th.ui;
  fill(ui, 0, 0, ui.cols, HEADER_ROWS, u.panel, u.alpha);
  for (let x = 0; x < ui.cols; x++) text(ui, x, HEADER_ROWS - 1, "-", u.border, u.panel, u.alpha);
  const y = 1;
  const bones = Object.values(s.progress.bones).reduce((n, l) => n + (l?.length ?? 0), 0);
  const status = `Os ${bones}   Especes ${s.progress.assembled.length}/${SPECIES_LIST.length}   Faits ${s.progress.facts.length}`;
  const menuW = 16;
  const tabW = 14, gap = 2;
  const tabsW = TABS.length * tabW + (TABS.length - 1) * gap;
  // Le titre s'efface si la fenêtre est trop étroite.
  const showTitle = ui.cols >= 16 + tabsW + status.length + menuW + 10;
  let x = 2;
  if (showTitle) x += text(ui, x, y, "PALEOGLYPHES", u.hi, u.panel, u.alpha) + 4;
  for (const t of TABS) x += button(ui, th, `tab:${t.mode}`, x, y, t.label, { w: tabW, active: s.mode === t.mode }) + gap;
  const mx = ui.cols - menuW - 2;
  button(ui, th, "menu:open", mx, y, "Menu  Echap", { w: menuW });
  if (mx - status.length - 3 > x) text(ui, mx - status.length - 3, y, status, u.dim, u.panel, u.alpha);
}

/** Dessine la scène courante, puis les onglets, les notifications et le menu. */
export function composeGame(s: GameState, world: Frame, ui: Frame, fps: number) {
  const th = THEMES[s.style];
  beginUi(ui, s.mouse.x, s.mouse.y);
  SCENES[s.mode].compose(s, th, world, ui);

  if (s.mode !== "meteor") drawHeader(s, th, ui);
  if (DEV) text(ui, ui.cols - 9, ui.rows - 1, `FPS ${fps.toFixed(0).padStart(3)}`, th.ui.dim, th.ui.panel, 0.6);

  drawToasts(s, th, ui);
  if (s.menu.open) {
    resetUi(ui);
    drawMenu(s, th, world);
  }
}
