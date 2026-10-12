import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics, uiCellAt } from "../render/metrics";

/**
 * Petite boîte à outils d'interface en mode immédiat, sur le calque d'interface (cellules lisibles).
 * - Tout le texte passe par `ascii()` : la grille n'affiche que l'ASCII 32-126 (accents retirés).
 * - Les zones cliquables sont enregistrées pendant le dessin (`region`, `button`) ; le cœur des scènes
 *   les utilise à la frame suivante pour router les clics (voir scenes/index.ts).
 */

export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let hits: Hit[] = [];
let prevHits: Hit[] = [];
const mouse = { x: -1, y: -1 };

/** Début d'une frame d'interface : les zones de la frame précédente deviennent cliquables. */
export function beginUi(ui: Frame, mx: number, my: number) {
  prevHits = hits;
  hits = [];
  mouse.x = mx;
  mouse.y = my;
  ui.ch.fill(0);
  ui.fg.fill(0);
  ui.bg.fill(0);
}

/** Zone cliquable sous un point (px CSS), la plus récemment dessinée gagne. */
export function hitAt(px: number, py: number): string | undefined {
  const c = uiCellAt(px, py);
  for (let i = prevHits.length - 1; i >= 0; i--) {
    const h = prevHits[i];
    if (c.x >= h.x && c.x < h.x + h.w && c.y >= h.y && c.y < h.y + h.h) return h.id;
  }
  return undefined;
}

export function region(id: string, x: number, y: number, w: number, h: number) {
  hits.push({ id, x, y, w, h });
}

/** La souris survole-t-elle ce rectangle (cellules d'interface) ? */
export function over(x: number, y: number, w: number, h: number): boolean {
  const c = uiCellAt(mouse.x, mouse.y);
  return c.x >= x && c.x < x + w && c.y >= y && c.y < y + h;
}

/** Retire accents et signes non ASCII : « é » devient « e », « œ » devient « oe ». */
export function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[œŒ]/g, (m) => (m === "œ" ? "oe" : "OE"))
    .replace(/[æÆ]/g, (m) => (m === "æ" ? "ae" : "AE"))
    .replace(/[«»“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

export function put(ui: Frame, x: number, y: number, ch: number, fg: RGB, bg: RGB | null = null, bgA = 1) {
  if (x < 0 || y < 0 || x >= ui.cols || y >= ui.rows) return;
  const i = y * ui.cols + x, k = i * 4;
  ui.ch[i] = ch;
  ui.fg[k] = fg[0]; ui.fg[k + 1] = fg[1]; ui.fg[k + 2] = fg[2]; ui.fg[k + 3] = 255;
  if (bg) { ui.bg[k] = bg[0]; ui.bg[k + 1] = bg[1]; ui.bg[k + 2] = bg[2]; ui.bg[k + 3] = Math.round(bgA * 255); }
}

/** Remplit un rectangle de fond (transparence `a`). */
export function fill(ui: Frame, x: number, y: number, w: number, h: number, bg: RGB, a = 1) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(ui, i, j, 32, bg, bg, a);
}

/** Écrit du texte (converti en ASCII). Renvoie sa longueur. */
export function text(ui: Frame, x: number, y: number, str: string, fg: RGB, bg: RGB | null = null, bgA = 1): number {
  const t = ascii(str);
  for (let k = 0; k < t.length; k++) put(ui, x + k, y, t.charCodeAt(k), fg, bg, bgA);
  return t.length;
}

/** Coupe un texte en lignes de `width` caractères au plus, sur les espaces. */
export function wrap(str: string, width: number): string[] {
  const out: string[] = [];
  for (const para of ascii(str).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

/** Panneau encadré en ASCII, avec titre facultatif dans la bordure du haut. */
export function panel(ui: Frame, th: Theme, x: number, y: number, w: number, h: number, title?: string) {
  const u = th.ui;
  fill(ui, x, y, w, h, u.panel, u.alpha);
  for (let i = x; i < x + w; i++) { put(ui, i, y, 45, u.border, u.panel, u.alpha); put(ui, i, y + h - 1, 45, u.border, u.panel, u.alpha); }
  for (let j = y; j < y + h; j++) { put(ui, x, j, 124, u.border, u.panel, u.alpha); put(ui, x + w - 1, j, 124, u.border, u.panel, u.alpha); }
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) put(ui, cx, cy, 43, u.border, u.panel, u.alpha);
  if (title) text(ui, x + 2, y, ` ${title} `, u.hi, u.panel, u.alpha);
}

export interface ButtonOpts {
  /** Largeur imposée (sinon : libellé + 4). */
  w?: number;
  /** Bouton actif (onglet courant, option choisie). */
  active?: boolean;
  disabled?: boolean;
}

/** Bouton « [ libellé ] » cliquable. Renvoie sa largeur. */
export function button(ui: Frame, th: Theme, id: string, x: number, y: number, label: string, o: ButtonOpts = {}): number {
  const u = th.ui;
  const t = ascii(label);
  const w = o.w ?? t.length + 4;
  const hover = !o.disabled && over(x, y, w, 1);
  const bg = o.active ? u.hi : hover ? u.panelAlt : u.panel;
  const fg = o.disabled ? u.dim : o.active ? u.panel : hover ? u.hi : u.text;
  fill(ui, x, y, w, 1, bg, u.alpha);
  put(ui, x, y, 91, o.disabled ? u.dim : u.border, bg, u.alpha);
  put(ui, x + w - 1, y, 93, o.disabled ? u.dim : u.border, bg, u.alpha);
  text(ui, x + Math.floor((w - t.length) / 2), y, t, fg, bg, u.alpha);
  if (!o.disabled) region(id, x, y, w, 1);
  return w;
}

/** Barre de progression ASCII « [#####.....] ». */
export function bar(ui: Frame, th: Theme, x: number, y: number, w: number, v: number, color?: RGB) {
  const u = th.ui;
  const n = Math.round(Math.max(0, Math.min(1, v)) * (w - 2));
  put(ui, x, y, 91, u.border, u.panel, u.alpha);
  for (let i = 0; i < w - 2; i++) put(ui, x + 1 + i, y, i < n ? 35 : 46, i < n ? (color ?? u.hi) : u.dim, u.panel, u.alpha);
  put(ui, x + w - 1, y, 93, u.border, u.panel, u.alpha);
}

export { metrics };
