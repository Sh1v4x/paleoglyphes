import { hex, type RGB, type Theme } from "../palette";
import { setBg, setFg, type Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { region } from "./kit";
import type { GameState } from "../state";
import { BIG, type BigLabel } from "./bigtext";

/** Couleurs du panneau selon le style. */
const SKIN = {
  dark: { panel: hex("#100e15"), border: hex("#4a4458"), dim: hex("#5d586b"), text: hex("#a9a3b8"), hi: hex("#9be88a"), veil: 0.3 },
  cartoon: { panel: hex("#fff6e0"), border: hex("#1b1f2e"), dim: hex("#8a7f6a"), text: hex("#1b1f2e"), hi: hex("#e8553a"), veil: 0.45 },
} as const;

// Valeurs de la ligne « Style » (désactivée, voir plus bas) :
// const VALUES: Record<string, BigLabel> = { dark: "dark", cartoon: "cartoon" };

function put(f: Frame, x: number, y: number, ch: number, fg: RGB, bg: RGB) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = y * f.cols + x;
  f.ch[i] = ch;
  setFg(f, i, fg[0], fg[1], fg[2]);
  setBg(f, i, bg[0], bg[1], bg[2]);
}

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

/** Menu pause en grandes lettres ASCII, dessiné directement dans la grille. */
export function drawMenu(s: GameState, th: Theme, f: Frame) {
  const sk = SKIN[th.style];
  // Voile : le monde continue de vivre derrière, assombri.
  for (let i = 0; i < f.cols * f.rows; i++) {
    const k = i * 4;
    for (let c = 0; c < 3; c++) {
      f.fg[k + c] *= sk.veil;
      f.bg[k + c] *= sk.veil;
    }
  }

  const W = 84, H = 40;
  const x0 = Math.floor((f.cols - W) / 2), y0 = Math.floor((f.rows - H) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edgeY = y === 0 || y === H - 1, edgeX = x === 0 || x === W - 1;
      const ch = edgeX && edgeY ? 43 : edgeY ? 61 : edgeX ? 124 : 32; // + = |
      put(f, x0 + x, y0 + y, ch, sk.border, sk.panel);
    }
  }
  // Ombre portée du panneau.
  for (let y = 1; y <= H; y++) for (let x = 1; x <= 2; x++) put(f, x0 + W - 1 + x, y0 + y, 32, sk.panel, [0, 0, 0]);
  for (let x = 2; x <= W + 1; x++) put(f, x0 + x, y0 + H, 32, sk.panel, [0, 0, 0]);

  const cx = (w: number) => x0 + Math.floor((W - w) / 2);
  big(f, "title", cx(BIG.title[0].length), y0 + 2, sk.text, sk.panel);

  const rows: { label: BigLabel | null; value: BigLabel; y: number }[] = [
    // Style dark fantasy mis de côté pour l'instant (le code reste en place) :
    // { label: "style", value: VALUES[s.style], y: y0 + 10 },
    { label: "test", value: "unlock", y: y0 + 10 },
    { label: null, value: s.menu.confirm ? "confirm" : "restart", y: y0 + 21 },
    { label: null, value: "resume", y: y0 + 30 },
  ];
  rows.forEach((r, n) => {
    const sel = s.menu.index === n;
    const blink = Math.sin(s.time * 6) > -0.2;
    if (r.label) {
      const lw = BIG[r.label][0].length;
      big(f, r.label, cx(lw), r.y, sk.dim, sk.panel);
    }
    const vy = r.label ? r.y + 5 : r.y;
    const vw = BIG[r.value][0].length;
    const vx = cx(vw);
    big(f, r.value, vx, vy, sel ? sk.hi : sk.text, sk.panel);
    if (sel && blink) big(f, "right", vx - 8, vy, sk.hi, sk.panel);
    // Ligne cliquable : zone convertie des cellules monde vers les cellules d'interface.
    const ux = Math.floor((vx - 8) * metrics.cellW / metrics.uiW), uy = Math.floor((r.y * metrics.cellH) / metrics.uiH);
    const uw = Math.ceil(((vw + 16) * metrics.cellW) / metrics.uiW), uh = Math.ceil(((vy + 5 - r.y) * metrics.cellH) / metrics.uiH);
    region(`menurow:${n}`, ux, uy, uw, uh);
  });

  if (s.menu.confirm) {
    const warn = "Toute ta progression sera effacee ! Valide encore pour confirmer.";
    small(f, warn, cx(warn.length), y0 + 27, sk.hi, sk.panel);
  }
  const hint = "clic ou fleches + entree : choisir    echap : fermer";
  small(f, hint, cx(hint.length), y0 + H - 3, sk.dim, sk.panel);
}
