import { DEV } from "../config";
import type { Input } from "../input";
import { THEMES, type Style } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { SPECIES_LIST } from "../species";
import { worldFor, type GameState } from "../state";
import { beginUi, button, fill, hitAt, text } from "../ui/kit";
import { drawMenu } from "../ui/menu";
import { drawToasts, toast } from "../ui/toast";
import { digScene } from "./dig";
import { journalScene } from "./journal";
import { labScene } from "./lab";
import { parkScene, syncPopulation } from "./park";
import type { Mode, Scene } from "./types";

export const SCENES: Record<Mode, Scene> = { dig: digScene, lab: labScene, park: parkScene, journal: journalScene };
const TABS: { mode: Mode; label: string; key: string }[] = [
  { mode: "dig", label: "1 Fouille", key: "Digit1" },
  { mode: "lab", label: "2 Atelier", key: "Digit2" },
  { mode: "park", label: "3 Reserve", key: "Digit3" },
  { mode: "journal", label: "4 Carnet", key: "Digit4" },
];
const STYLES: Style[] = ["dark", "cartoon"];
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

function updateMenu(s: GameState, input: Input) {
  const m = s.menu;
  for (const k of input.pressed) {
    if (k === "Escape") { m.open = false; return; }
    if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ") m.index = (m.index + MENU_ROWS - 1) % MENU_ROWS;
    if (k === "ArrowDown" || k === "KeyS") m.index = (m.index + 1) % MENU_ROWS;
    const left = k === "ArrowLeft" || k === "KeyA" || k === "KeyQ";
    const right = k === "ArrowRight" || k === "KeyD" || k === "Enter" || k === "Space";
    if (!left && !right) continue;
    if (m.index === 0) {
      s.style = STYLES[(STYLES.indexOf(s.style) + (left ? -1 : 1) + STYLES.length) % STYLES.length];
      worldFor(s);
    } else if (m.index === 1 && right) {
      unlockAll(s);
    } else if (m.index === 2 && right) {
      m.open = false;
      return;
    }
  }
}

/** Logique globale : menu Échap, onglets, routage des clics, puis la scène courante. */
export function updateGame(s: GameState, input: Input, dt: number) {
  s.time += dt;
  s.mouse.x = input.mouse.x;
  s.mouse.y = input.mouse.y;
  if (s.menu.open) {
    updateMenu(s, input);
    return;
  }
  if (input.pressed.includes("Escape")) { s.menu.open = true; s.menu.index = 0; return; }
  for (const t of TABS) if (input.pressed.includes(t.key)) setMode(s, t.mode);
  for (const c of input.mouse.clicks) {
    const id = hitAt(c.x, c.y);
    if (id?.startsWith("tab:")) setMode(s, id.slice(4) as Mode);
    else if (id) input.ui.push(id);
    else input.worldClicks.push(c);
  }
  SCENES[s.mode].update(s, input, dt);
}

/** Dessine la scène courante, puis les onglets, les notifications et le menu. */
export function composeGame(s: GameState, world: Frame, ui: Frame, fps: number) {
  const th = THEMES[s.style];
  beginUi(ui, s.mouse.x, s.mouse.y);
  SCENES[s.mode].compose(s, th, world, ui);

  // Barre d'onglets (ligne 0).
  const u = th.ui;
  fill(ui, 0, 0, ui.cols, 1, u.panel, u.alpha);
  let x = 1;
  for (const t of TABS) x += button(ui, th, `tab:${t.mode}`, x, 0, t.label, { active: s.mode === t.mode }) + 1;
  const bones = Object.values(s.progress.bones).reduce((n, l) => n + (l?.length ?? 0), 0);
  const status = `Os ${bones}   Especes ${s.progress.assembled.length}/${SPECIES_LIST.length}   Carnet ${s.progress.facts.length}   Echap : menu`;
  text(ui, Math.max(x + 2, ui.cols - status.length - 1), 0, status, u.dim, u.panel, u.alpha);
  if (DEV) text(ui, ui.cols - 9, ui.rows - 1, `FPS ${fps.toFixed(0).padStart(3)}`, u.dim, u.panel, 0.6);

  drawToasts(s, th, ui);
  if (s.menu.open) {
    beginUi(ui, s.mouse.x, s.mouse.y);
    drawMenu(s, th, world);
  }
}
