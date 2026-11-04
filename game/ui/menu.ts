import { DEV } from "../config";
import { pointer } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { calm, settings, UI_SCALES, VOLUMES } from "../settings";
import { actions, button, keyChip, panel, put, region, SP, text, wrap } from "./kit";
import type { GameState } from "../state";
import { STRINGS } from "../strings";
import { BIG, type BigLabel } from "./bigtext";

// Valeurs de la ligne « Style » (désactivée, voir plus bas) :
// const VALUES: Record<string, BigLabel> = { dark: "dark", cartoon: "cartoon" };

/** Lignes du menu Échap, dans l'ordre : la plus sûre (reprendre) en premier. */
export const MENU_ITEMS = ["resume", "settings", "unlock", "restart"] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

function big(f: Frame, label: BigLabel, x: number, y: number, fg: RGB, bg: RGB) {
  const lines = BIG[label];
  lines.forEach((line, j) => {
    for (let k = 0; k < line.length; k++) put(f, x + k, y + j, line.charCodeAt(k), fg, bg);
  });
  return lines[0].length;
}

function small(f: Frame, text: string, x: number, y: number, fg: RGB, bg: RGB) {
  for (let k = 0; k < text.length; k++) put(f, x + k, y, text.charCodeAt(k), fg, bg);
}

/** Voile : le monde continue de vivre derrière, assombri. */
function veil(f: Frame, k: number) {
  const n = f.cols * f.rows * 4;
  for (let i = 0; i < n; i += 4) {
    f.fg[i] *= k; f.fg[i + 1] *= k; f.fg[i + 2] *= k;
    f.bg[i] *= k; f.bg[i + 1] *= k; f.bg[i + 2] *= k;
  }
}

/** Menu pause en grandes lettres ASCII, dessiné directement dans la grille. */
export function drawMenu(s: GameState, th: Theme, f: Frame) {
  const sk = th.ui;
  veil(f, sk.menuVeil);
  // Page Réglages : le voile seul, le panneau est sur le calque d'interface (voir drawSettings).
  if (s.menu.page === "settings") return;

  const W = 84, H = 42;
  const x0 = Math.floor((f.cols - W) / 2), y0 = Math.max(0, Math.floor((f.rows - H) / 2));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edgeY = y === 0 || y === H - 1, edgeX = x === 0 || x === W - 1;
      const ch = edgeX && edgeY ? 43 : edgeY ? 61 : edgeX ? 124 : 32; // + = |
      put(f, x0 + x, y0 + y, ch, sk.border, sk.panel);
    }
  }
  // Ombre portée du panneau.
  for (let y = 1; y <= H; y++) for (let x = 1; x <= 2; x++) put(f, x0 + W - 1 + x, y0 + y, 32, sk.panel, sk.menuShadow);
  for (let x = 2; x <= W + 1; x++) put(f, x0 + x, y0 + H, 32, sk.panel, sk.menuShadow);

  const cx = (w: number) => x0 + Math.floor((W - w) / 2);
  big(f, "title", cx(BIG.title[0].length), y0 + 2, sk.menuText, sk.panel);

  // Style dark fantasy mis de côté pour l'instant (le code reste en place) :
  // { label: "style", value: VALUES[s.style], y: ... },
  const labels: Record<MenuItem, BigLabel> = { resume: "resume", settings: "settings", unlock: "unlock", restart: s.menu.confirm ? "confirm" : "restart" };
  const blink = calm() || Math.sin(s.time * 6) > -0.2;
  MENU_ITEMS.forEach((item, n) => {
    const vy = y0 + 9 + n * 7;
    const sel = s.menu.index === n;
    const value = labels[item];
    const vw = BIG[value][0].length;
    const vx = cx(vw);
    big(f, value, vx, vy, sel ? sk.hi : sk.menuText, sk.panel);
    // Sélection : flèche (forme) en plus de la couleur.
    if (sel && blink) big(f, "right", vx - 8, vy, sk.hi, sk.panel);
    if (item === "unlock") small(f, STRINGS.menu.unlockCaption, cx(STRINGS.menu.unlockCaption.length), vy + 5, sk.dim, sk.panel);
    // Ligne cliquable : zone convertie des cellules monde vers les cellules d'interface.
    const ux = Math.floor(((vx - 8) * metrics.cellW) / metrics.uiW), uy = Math.floor((vy * metrics.cellH) / metrics.uiH);
    const uw = Math.ceil(((vw + 16) * metrics.cellW) / metrics.uiW), uh = Math.ceil((5 * metrics.cellH) / metrics.uiH);
    region(`menurow:${n}`, ux, uy, uw, uh);
  });

  if (s.menu.confirm) {
    const warn = pointer.touch ? STRINGS.menu.restartWarnTouch : STRINGS.menu.restartWarnKeys;
    small(f, warn, cx(warn.length), y0 + 9 + 3 * 7 + 5, sk.hi, sk.panel);
  }
  const hint = pointer.touch ? STRINGS.menu.hintTouch : STRINGS.menu.hintKeys;
  small(f, hint, cx(hint.length), y0 + H - 2, sk.dim, sk.panel);
}

// ---------------------------------------------------------------------------
// Réglages (calque d'interface : lisible, focalisable au clavier)
// ---------------------------------------------------------------------------

/** Panneau des réglages, centré. */
export function drawSettings(s: GameState, th: Theme, ui: Frame) {
  const u = th.ui, t = STRINGS.settings;
  const W = Math.min(64, ui.cols - 2 * SP.margin), iw = W - 2 * SP.pad;
  const yesNo = (on: boolean) => (on ? t.yes : t.no);
  const rows: { title: string; help: string; draw: (x: number, y: number) => void }[] = [
    {
      title: t.scale,
      help: t.scaleHelp,
      draw: (x, y) => {
        for (const k of ["auto", ...UI_SCALES] as const) {
          const on = settings.uiScale === k;
          x += button(ui, th, `set:scale:${k}`, x, y, k === "auto" ? t.scaleAuto : `${Math.round(k * 100)} %`, { active: on, toggle: true, tip: on ? t.scaleCurrent : t.scalePick }) + SP.gap;
        }
      },
    },
    {
      title: t.sound,
      help: t.soundHelp,
      draw: (x, y) => {
        for (const v of VOLUMES) {
          const on = !settings.mute && settings.volume === v;
          x += button(ui, th, `set:vol:${v}`, x, y, `${v * 100} %`, { active: on, toggle: true, tip: on ? t.volumeCurrent : t.volumePick }) + SP.gap;
        }
        button(ui, th, "set:mute", x, y, t.mute, { toggle: true, active: settings.mute, key: "B", tip: t.muteTip });
      },
    },
    {
      title: t.motion,
      help: t.motionHelp,
      draw: (x, y) => {
        const n = button(ui, th, "set:motion", x, y, t.motionToggle, { toggle: true, active: settings.reduceMotion });
        text(ui, x + n + 2, y, yesNo(settings.reduceMotion), settings.reduceMotion ? u.ok : u.dim, u.panel, u.alpha);
      },
    },
  ];
  if (DEV) rows.push({
    title: t.fps,
    help: t.fpsHelp,
    draw: (x, y) => {
      const n = button(ui, th, "set:fps", x, y, t.fpsToggle, { toggle: true, active: settings.showFps });
      text(ui, x + n + 2, y, yesNo(settings.showFps), settings.showFps ? u.ok : u.dim, u.panel, u.alpha);
    },
  });
  const helps = rows.map((r) => wrap(r.help, iw - 2));
  const H = 2 + rows.reduce((n, _, i) => n + 3 + helps[i].length, 0) + 2;
  const x = Math.floor((ui.cols - W) / 2), y = Math.max(0, Math.floor((ui.rows - H) / 2));
  panel(ui, th, x, y, W, H, t.title, { close: "set:back", overlay: true });
  let yy = y + 2;
  rows.forEach((r, i) => {
    text(ui, x + SP.pad, yy++, r.title, u.hi, u.panel, u.alpha);
    r.draw(x + SP.pad + 2, yy++);
    helps[i].forEach((l) => text(ui, x + SP.pad + 2, yy++, l, u.dim, u.panel, u.alpha));
    yy++;
  });
  const hx = x + SP.pad;
  if (!pointer.touch) {
    const k = keyChip(ui, th, hx, y + H - 2, "Tab");
    text(ui, hx + k + 1, y + H - 2, t.pick, u.dim, u.panel, u.alpha);
  }
  actions(ui, th, x + SP.pad, y + H - 2, iw, [{ id: "set:back", label: t.back, key: "Echap", variant: "primary" }]);
}
