import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import type { GameState } from "../state";
import { UI_TOP } from "../scenes/types";
import { panel, text, wrap } from "./kit";

export interface Toast {
  title: string;
  text: string;
  t0: number;
}

const LIFE = 4.5;

/** Affiche une notification (« Nouvelle entrée au carnet ! ») en haut à droite. */
export function toast(s: GameState, title: string, body = "") {
  s.toasts.push({ title, text: body, t0: s.time });
  if (s.toasts.length > 4) s.toasts.shift();
}

export function drawToasts(s: GameState, th: Theme, ui: Frame) {
  s.toasts = s.toasts.filter((t) => s.time - t.t0 < LIFE);
  const w = Math.min(46, ui.cols - 4);
  let y = UI_TOP;
  for (const t of s.toasts) {
    const lines = t.text ? wrap(t.text, w - 4) : [];
    const h = 3 + lines.length;
    const age = s.time - t.t0;
    // Glisse depuis la droite en entrant.
    const slide = Math.max(0, 1 - age * 4);
    const x = ui.cols - w - 2 + Math.round(slide * (w + 2));
    panel(ui, th, x, y, w, h);
    text(ui, x + 2, y + 1, `* ${t.title}`, th.ui.hi, th.ui.panel, th.ui.alpha);
    lines.forEach((l, i) => text(ui, x + 2, y + 2 + i, l, th.ui.text, th.ui.panel, th.ui.alpha));
    y += h + 1;
  }
}
