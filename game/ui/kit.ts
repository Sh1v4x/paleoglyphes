import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics, uiCellAt } from "../render/metrics";

/**
 * Petite boîte à outils d'interface en mode immédiat, sur le calque d'interface (cellules lisibles).
 * - Tout le texte passe par `ascii()` : la grille n'affiche que l'ASCII 32-126 (accents retirés).
 * - Les zones cliquables sont enregistrées pendant le dessin (`region`, `button`) ; le cœur des scènes
 *   les utilise à la frame suivante pour router les clics (voir scenes/index.ts).
 *
 * Règles de mise en page (communes à tous les écrans) :
 * - `SP.margin` cellule entre le bord de la fenêtre et un panneau ; `SP.pad` cellules de marge intérieure ;
 *   `SP.gap` cellule entre deux boutons d'une même rangée.
 * - Panneau : titre dans la bordure du haut (à gauche), fermeture « [x] » en haut à droite,
 *   actions en bas à droite (l'action principale tout à droite, voir `actions`).
 * - Boutons : `secondary` (défaut), `primary` (plein, l'action attendue), `ghost` (discret),
 *   `danger` (destructif), `toggle` (« * » quand il est allumé), `disabled` (grisé, inerte).
 *   Un raccourci clavier s'affiche en pastille inversée à droite du libellé (`key`).
 * - Focus clavier : Tab / Maj+Tab parcourent les boutons visibles dans l'ordre de lecture
 *   (haut en bas, gauche à droite) ; Entrée / Espace activent. Le focus est cerclé de « > ... < ».
 * - Infobulles : `tip` sur un bouton ou une zone ; elles apparaissent après un court survol
 *   (ou tout de suite sur le bouton qui a le focus clavier), près du curseur, sans sortir de l'écran.
 * - Rien ne passe l'information par la couleur seule : états marqués aussi par un glyphe ou un mot.
 */

/** Espacements communs (cellules d'interface). */
export const SP = { margin: 1, pad: 2, gap: 1 } as const;

/** Délai avant l'apparition d'une infobulle (s). */
const TIP_DELAY = 0.45;

export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Atteignable au clavier (Tab). */
  focus?: boolean;
  tip?: string;
}

/** Rectangle dessiné, pour les vérifications de mise en page (scripts/ui-snap.ts). */
export interface UiRect {
  kind: "panel" | "button" | "overlay";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Journal de dessin (désactivé en jeu : seul le script de vérification l'allume). */
export const uiLog = { enabled: false, rects: [] as UiRect[], clipped: [] as { x: number; y: number; t: string }[] };

let hits: Hit[] = [];
let prevHits: Hit[] = [];
const mouse = { x: -1, y: -1, moved: false };
let now = 0;

// Focus clavier.
let focusId: string | undefined;
let focusVisible = false;
// Infobulle : candidate de cette frame, et survol en cours (id + début).
let tipCand: { id: string; text: string; x: number; y: number; w: number; h: number; byKey: boolean } | null = null;
let tipHover = { id: "", since: 0 };
/** Couche « au-dessus » : les rectangles dessinés sont marqués comme superposition voulue. */
let overlayDepth = 0;

/** Début d'une frame d'interface : les zones de la frame précédente deviennent cliquables. */
export function beginUi(ui: Frame, mx: number, my: number, time = 0) {
  prevHits = hits;
  hits = [];
  mouse.moved = mx !== mouse.x || my !== mouse.y;
  // La souris bouge : on repasse en mode pointeur (le cercle de focus s'efface).
  if (mouse.moved && mouse.x !== -1 && mx >= 0) focusVisible = false;
  mouse.x = mx;
  mouse.y = my;
  now = time;
  tipCand = null;
  overlayDepth = 0;
  if (uiLog.enabled) { uiLog.rects = []; uiLog.clipped = []; }
  ui.ch.fill(0);
  ui.fg.fill(0);
  ui.bg.fill(0);
}

/** Efface le calque et les zones de cette frame, sans toucher à celles de la frame précédente. */
export function resetUi(ui: Frame) {
  hits = [];
  tipCand = null;
  if (uiLog.enabled) uiLog.rects = [];
  ui.ch.fill(0);
  ui.fg.fill(0);
  ui.bg.fill(0);
}

/** Tout ce qui est dessiné dans `fn` est une superposition voulue (menu déroulant, modale, notification). */
export function overlay<T>(fn: () => T): T {
  overlayDepth++;
  try {
    return fn();
  } finally {
    overlayDepth--;
  }
}

function log(kind: UiRect["kind"], id: string, x: number, y: number, w: number, h: number) {
  if (uiLog.enabled) uiLog.rects.push({ kind: overlayDepth > 0 ? "overlay" : kind, id, x, y, w, h });
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

export interface RegionOpts {
  /** Atteignable au clavier (Tab). */
  focus?: boolean;
  /** Infobulle au survol. */
  tip?: string;
}

/** Zone cliquable (et, en option, focalisable et/ou avec infobulle). */
export function region(id: string, x: number, y: number, w: number, h: number, o: RegionOpts = {}) {
  hits.push({ id, x, y, w, h, focus: o.focus, tip: o.tip });
  if (o.tip) {
    const byKey = focusVisible && focusId === id;
    if (over(x, y, w, h) || byKey) tipCand = { id, text: o.tip, x, y, w, h, byKey };
  }
}

/** La souris survole-t-elle ce rectangle (cellules d'interface) ? */
export function over(x: number, y: number, w: number, h: number): boolean {
  const c = uiCellAt(mouse.x, mouse.y);
  return c.x >= x && c.x < x + w && c.y >= y && c.y < y + h;
}

// ---------------------------------------------------------------------------
// Focus clavier
// ---------------------------------------------------------------------------

/** Boutons focalisables de la dernière image dessinée, dans l'ordre de lecture. */
function focusList(): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) if (h.focus && !seen.has(h.id)) { seen.add(h.id); out.push(h); }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Tab (dir 1) ou Maj+Tab (dir -1) : focus suivant / précédent. */
export function moveFocus(dir: 1 | -1) {
  const list = focusList();
  if (!list.length) { focusId = undefined; return; }
  const i = list.findIndex((h) => h.id === focusId);
  const wasShown = focusVisible && i >= 0;
  focusVisible = true;
  // Premier Tab : on commence par le premier (ou le dernier) bouton, sans en sauter un.
  if (!wasShown) { focusId = (i >= 0 ? list[i] : dir > 0 ? list[0] : list[list.length - 1]).id; return; }
  focusId = list[(i + dir + list.length) % list.length].id;
}

/** Bouton qui a le focus clavier visible (sinon undefined). */
export function focusedId(): string | undefined {
  if (!focusVisible || !focusId) return undefined;
  return hits.some((h) => h.id === focusId && h.focus) ? focusId : undefined;
}

/** Donne le focus à un bouton précis (ex. ouverture d'une fenêtre : focus sur son action). */
export function setFocus(id: string | undefined, visible = focusVisible) {
  focusId = id;
  focusVisible = visible && !!id;
}

/** Le cercle de focus est-il affiché ? (mode clavier) */
export const keyboardMode = () => focusVisible;

const isFocused = (id: string) => focusVisible && focusId === id;

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

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
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Coupe un texte trop long avec « ... » (en ASCII). */
export function clip(str: string, w: number): string {
  const t = ascii(str);
  if (w <= 0) return "";
  return t.length <= w ? t : w <= 3 ? t.slice(0, w) : `${t.slice(0, w - 3)}...`;
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
  if (uiLog.enabled && t.trim() && (x < 0 || x + t.trimEnd().length > ui.cols || y < 0 || y >= ui.rows)) uiLog.clipped.push({ x, y, t });
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

// ---------------------------------------------------------------------------
// Panneaux
// ---------------------------------------------------------------------------

export interface PanelOpts {
  /** Id du bouton de fermeture « [x] » en haut à droite (Échap fait de même, voir Scene.back). */
  close?: string;
  /** Raccourci affiché à droite du titre (« Recensement  C »). */
  key?: string;
  /** Superposition voulue (menu déroulant, modale) : exclue des contrôles de chevauchement. */
  overlay?: boolean;
}

/** Panneau encadré en ASCII, avec titre facultatif dans la bordure du haut. */
export function panel(ui: Frame, th: Theme, x: number, y: number, w: number, h: number, title?: string, o: PanelOpts = {}) {
  const u = th.ui;
  if (o.overlay) overlayDepth++;
  log("panel", title ?? "", x, y, w, h);
  if (o.overlay) overlayDepth--;
  fill(ui, x, y, w, h, u.panel, u.alpha);
  for (let i = x; i < x + w; i++) { put(ui, i, y, 45, u.border, u.panel, u.alpha); put(ui, i, y + h - 1, 45, u.border, u.panel, u.alpha); }
  for (let j = y; j < y + h; j++) { put(ui, x, j, 124, u.border, u.panel, u.alpha); put(ui, x + w - 1, j, 124, u.border, u.panel, u.alpha); }
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) put(ui, cx, cy, 43, u.border, u.panel, u.alpha);
  // Place pour le titre : on garde la fermeture et les coins.
  const room = w - 6 - (o.close ? 4 : 0) - (o.key ? o.key.length + 3 : 0);
  if (title && room > 2) {
    const n = text(ui, x + 2, y, ` ${clip(title, room)} `, u.hi, u.panel, u.alpha);
    if (o.key) keyChip(ui, th, x + 2 + n, y, o.key);
  }
  if (o.close) closeButton(ui, th, o.close, x + w - 5, y);
}

/** Bouton de fermeture « [x] », à poser sur la bordure haute d'un panneau. */
export function closeButton(ui: Frame, th: Theme, id: string, x: number, y: number) {
  button(ui, th, id, x, y, "x", { w: 3, variant: "ghost", tip: "Fermer (Echap)" });
}

/** Titre de section « -- Libellé ----- » dans un panneau. */
export function section(ui: Frame, th: Theme, x: number, y: number, w: number, label: string) {
  const u = th.ui;
  const t = clip(label, w - 4);
  text(ui, x, y, "--", u.border, u.panel, u.alpha);
  text(ui, x + 3, y, t, u.hi, u.panel, u.alpha);
  for (let i = x + 4 + t.length; i < x + w; i++) put(ui, i, y, 45, u.border, u.panel, u.alpha);
}

/** Pastille de touche (« V », « Echap ») : lettres claires sur fond sombre. Renvoie sa largeur. */
export function keyChip(ui: Frame, th: Theme, x: number, y: number, key: string, a = 1): number {
  const u = th.ui;
  return text(ui, x, y, ` ${ascii(key)} `, u.panel, u.border, a);
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonOpts {
  /** Largeur imposée (sinon : libellé + 4, + la pastille de touche). */
  w?: number;
  /** Bouton actif (onglet courant, option choisie) ; pour un `toggle`, allumé. */
  active?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  /** Interrupteur : allumé = « * » devant le libellé (pas seulement la couleur). */
  toggle?: boolean;
  /** Raccourci clavier, affiché en pastille (« V »). */
  key?: string;
  /** Infobulle (indispensable pour un bouton à icône seule). */
  tip?: string;
  /** Atteignable au clavier (oui par défaut). */
  focus?: boolean;
}

/** Largeur naturelle d'un bouton (libellé, pastille). */
export function buttonW(label: string, o: Pick<ButtonOpts, "key"> = {}): number {
  return ascii(label).length + 4 + (o.key ? ascii(o.key).length + 3 : 0);
}

/** Bouton « [ libellé ] » cliquable. Renvoie sa largeur. */
export function button(ui: Frame, th: Theme, id: string, x: number, y: number, label: string, o: ButtonOpts = {}): number {
  const u = th.ui;
  const t = ascii(label);
  const key = o.key ? ascii(o.key) : "";
  const w = o.w ?? buttonW(t, o);
  const v = o.variant ?? "secondary";
  const focused = !o.disabled && isFocused(id);
  const hover = !o.disabled && (over(x, y, w, 1) || focused);
  const on = !!o.active;
  let bg: RGB = u.panel, fg: RGB = u.text, br: RGB = u.border, a = u.alpha;
  if (o.disabled) { fg = u.dim; br = u.dim; }
  else if (on || v === "primary") { bg = hover ? u.text : u.hi; fg = u.panel; br = u.panel; }
  else if (v === "danger") { bg = hover ? u.bad : u.panel; fg = hover ? u.panel : u.bad; br = hover ? u.panel : u.bad; }
  else if (v === "ghost") { bg = hover ? u.panelAlt : u.panel; fg = hover ? u.hi : u.text; br = hover ? u.hi : u.dim; }
  else if (hover) { bg = u.panelAlt; fg = u.hi; br = u.hi; }
  if (v === "ghost" && !hover) a = u.alpha;
  log("button", id, x, y, w, 1);
  fill(ui, x, y, w, 1, bg, a);
  put(ui, x, y, 91, br, bg, a);
  put(ui, x + w - 1, y, 93, br, bg, a);
  if (o.toggle && on) put(ui, x + 1, y, 42, fg, bg, a); // « * » : allumé
  const kw = key ? key.length + 3 : 0;
  const room = w - 2 - kw;
  const lt = t.length > room ? clip(t, room) : t;
  text(ui, x + 1 + Math.max(0, Math.floor((room - lt.length) / 2)), y, lt, fg, bg, a);
  if (key) text(ui, x + w - 1 - (key.length + 2), y, ` ${key} `, o.disabled ? u.panel : on || v === "primary" ? u.hi : u.panel, o.disabled ? u.dim : on || v === "primary" ? u.panel : u.border, a);
  if (!o.disabled) region(id, x, y, w, 1, { focus: o.focus ?? true, tip: o.tip });
  return w;
}

export interface Action extends ButtonOpts {
  id: string;
  label: string;
}

/**
 * Rangée d'actions alignée à droite dans [x, x+w) : la dernière est l'action principale (tout à droite).
 * Renvoie la colonne de départ (pour placer un texte à gauche).
 */
export function actions(ui: Frame, th: Theme, x: number, y: number, w: number, items: Action[]): number {
  const ws = items.map((it) => it.w ?? buttonW(it.label, it));
  const total = ws.reduce((a, b) => a + b, 0) + SP.gap * Math.max(0, items.length - 1);
  let bx = Math.max(x, x + w - total);
  items.forEach((it, i) => { bx += button(ui, th, it.id, bx, y, it.label, { ...it, w: ws[i] }) + SP.gap; });
  return Math.max(x, x + w - total);
}

/** Bouton d'une barre d'outils : libellé complet, court, et icône (avec infobulle) pour les fenêtres étroites. */
export interface ToolItem extends Action {
  short?: string;
  icon?: string;
}

/**
 * Barre d'outils horizontale : chaque bouton garde sa touche ; si tout ne tient pas dans `w`, les libellés
 * se raccourcissent, puis passent en icônes (l'infobulle donne alors le nom complet).
 * Renvoie la largeur utilisée.
 */
export function toolbar(ui: Frame, th: Theme, x: number, y: number, w: number, items: ToolItem[]): number {
  const levels = [(it: ToolItem) => it.label, (it: ToolItem) => it.short ?? it.label, (it: ToolItem) => it.icon ?? it.short ?? it.label];
  const width = (f: (it: ToolItem) => string) => items.reduce((n, it) => n + buttonW(f(it), it), 0) + SP.gap * Math.max(0, items.length - 1);
  const pick = levels.find((f) => width(f) <= w) ?? levels[2];
  let bx = x;
  for (const it of items) {
    const label = pick(it);
    if (bx + buttonW(label, it) > x + w) break;
    bx += button(ui, th, it.id, bx, y, label, { ...it, tip: it.tip ?? (label !== it.label ? it.label : undefined) }) + SP.gap;
  }
  return bx - x;
}

/** Barre de progression ASCII « [#####.....] ». */
export function bar(ui: Frame, th: Theme, x: number, y: number, w: number, v: number, color?: RGB) {
  const u = th.ui;
  const n = Math.round(Math.max(0, Math.min(1, v)) * (w - 2));
  put(ui, x, y, 91, u.border, u.panel, u.alpha);
  for (let i = 0; i < w - 2; i++) put(ui, x + 1 + i, y, i < n ? 35 : 46, i < n ? (color ?? u.hi) : u.dim, u.panel, u.alpha);
  put(ui, x + w - 1, y, 93, u.border, u.panel, u.alpha);
}

// ---------------------------------------------------------------------------
// Ligne d'aide, état vide, infobulle, focus
// ---------------------------------------------------------------------------

/** Une aide clavier : touche (ou geste) puis ce qu'elle fait. */
export type Hint = readonly [key: string, label: string];

/**
 * Ligne d'aide en bas de l'écran (même style partout) : pastilles de touches + action.
 * Les aides qui ne tiennent pas sont omises (la liste complète est dans l'aide, touche H).
 */
export function hintLine(ui: Frame, th: Theme, items: readonly Hint[], right: readonly Hint[] = []) {
  const u = th.ui, y = ui.rows - 1;
  fill(ui, 0, y, ui.cols, 1, u.panel, 0.8);
  const width = (h: Hint) => ascii(h[0]).length + 3 + ascii(h[1]).length;
  let rx = ui.cols - 1;
  for (let i = right.length - 1; i >= 0; i--) {
    const h = right[i], w = width(h);
    if (rx - w < 1) break;
    rx -= w;
    const k = keyChip(ui, th, rx, y, h[0], 0.95);
    text(ui, rx + k + 1, y, h[1], u.dim, u.panel, 0.8);
    rx -= 3;
  }
  let x = 1;
  for (const h of items) {
    const w = width(h);
    if (x + w > rx - 1) break;
    const k = keyChip(ui, th, x, y, h[0], 0.95);
    text(ui, x + k + 1, y, h[1], u.dim, u.panel, 0.8);
    x += w + 3;
  }
}

/** État vide (même allure partout) : panneau centré, explication, action facultative. */
export function emptyState(ui: Frame, th: Theme, title: string, body: string, act?: Action, cy = Math.floor(ui.rows / 2)) {
  const u = th.ui;
  const W = Math.min(60, ui.cols - 4);
  const lines = wrap(body, W - 2 * SP.pad);
  const H = lines.length + 4 + (act ? 1 : 0);
  const x = Math.floor((ui.cols - W) / 2), y = Math.max(0, cy - Math.floor(H / 2));
  panel(ui, th, x, y, W, H, title);
  lines.forEach((l, i) => text(ui, x + SP.pad, y + 2 + i, l, u.text, u.panel, u.alpha));
  if (act) actions(ui, th, x + SP.pad, y + H - 2, W - 2 * SP.pad, [{ variant: "primary", ...act }]);
}

/** Infobulle de la frame (après un court survol, ou au focus clavier), près du curseur. */
export function drawTooltip(ui: Frame, th: Theme) {
  const c = tipCand;
  if (!c) { tipHover.id = ""; return; }
  if (tipHover.id !== c.id) tipHover = { id: c.id, since: now };
  if (!c.byKey && now - tipHover.since < TIP_DELAY) return;
  const u = th.ui;
  const lines = wrap(c.text, Math.min(40, ui.cols - 6));
  const w = Math.max(...lines.map((l) => l.length)) + 2, h = lines.length;
  // Sous l'élément (ou au-dessus s'il n'y a pas la place), calé dans l'écran.
  const m = uiCellAt(mouse.x, mouse.y);
  const ax = c.byKey ? c.x : m.x + 1;
  let y = c.y + c.h;
  if (y + h > ui.rows - 1) y = c.y - h;
  const x = Math.max(0, Math.min(ui.cols - w, ax));
  overlay(() => log("overlay", `tip:${c.id}`, x, y, w, h));
  lines.forEach((l, i) => text(ui, x, y + i, ` ${l.padEnd(w - 2)} `, u.panel, u.text, 0.97));
}

/** Cercle de focus clavier (« > ... < » autour de l'élément), dessiné en dernier. */
export function drawFocus(ui: Frame, th: Theme) {
  if (!focusVisible || !focusId) return;
  const h = hits.find((q) => q.id === focusId && q.focus);
  if (!h) return;
  const u = th.ui, my = h.y + (h.h >> 1);
  put(ui, h.x - 1, my, 62, u.hi, u.panel, 1);
  put(ui, h.x + h.w, my, 60, u.hi, u.panel, 1);
  if (h.h > 1) {
    // Zone haute (carte du carnet...) : coins en plus des chevrons.
    for (const [cx, cy] of [[h.x - 1, h.y - 1], [h.x + h.w, h.y - 1], [h.x - 1, h.y + h.h], [h.x + h.w, h.y + h.h]]) put(ui, cx, cy, 43, u.hi);
  }
}

export { metrics };
