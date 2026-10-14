import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { discovered, SPECIES } from "../species";
import type { Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { uiCellAt } from "../render/metrics";
import { button, buttonW, fill, hitAt, over, panel, put, region, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { ageMid, ageRange, box, du, fitSprite, known, knownList, le, lerp } from "./journal-common";
import { UI_TOP } from "./types";

/**
 * Frise du temps du carnet : du Trias à aujourd'hui, chaque espèce découverte posée à son âge.
 * Mini-jeu « Place-le sur la frise » : glisser une espèce assemblée sur la bonne période (une étoile).
 */

export interface TimelineState {
  /** Mini-jeu actif. */
  game: boolean;
  /** Espèce à placer. */
  target?: SpeciesId;
  /** Carte de l'espèce en cours de glisser-déposer. */
  drag: boolean;
  /** Dernier verdict du mini-jeu. */
  feedback?: { ok: boolean; text: string };
}

export function createTimelineState(): TimelineState {
  return { game: false, drag: false };
}

// ---------------------------------------------------------------------------
// Échelle des temps (Ma). Le Cénozoïque (66 Ma -> aujourd'hui) est compressé : rien à y placer.
// ---------------------------------------------------------------------------
interface Era { name: string; from: number; to: number; w: number; col: RGB; subs: [string, number, number][] }
const ERAS: Era[] = [
  { name: "Trias", from: 252, to: 201, w: 51, col: [156, 74, 168], subs: [["inférieur", 252, 247], ["moyen", 247, 237], ["supérieur", 237, 201]] },
  { name: "Jurassique", from: 201, to: 145, w: 56, col: [52, 170, 205], subs: [["inférieur", 201, 174], ["moyen", 174, 163], ["supérieur", 163, 145]] },
  { name: "Crétacé", from: 145, to: 66, w: 79, col: [118, 190, 72], subs: [["inférieur", 145, 100.5], ["supérieur", 100.5, 66]] },
  { name: "Cénozoïque", from: 66, to: 0, w: 26, col: [240, 160, 76], subs: [["Paléogène ->", 66, 0]] },
];
const TOTAL_W = ERAS.reduce((n, e) => n + e.w, 0);

/** Âge (Ma) -> colonne d'interface. */
function maToX(ma: number, x0: number, W: number): number {
  let acc = 0;
  for (const e of ERAS) {
    if (ma >= e.to || e === ERAS[ERAS.length - 1]) {
      const t = Math.max(0, Math.min(1, (e.from - ma) / (e.from - e.to)));
      return x0 + ((acc + t * e.w) / TOTAL_W) * W;
    }
    acc += e.w;
  }
  return x0 + W;
}

/** Ère et sous-période d'un âge. */
function epochOf(ma: number): [number, number] {
  const ei = Math.max(0, ERAS.findIndex((e) => ma <= e.from && ma >= e.to));
  const subs = ERAS[ei].subs;
  const si = Math.max(0, subs.findIndex(([, a, b]) => ma <= a && ma >= b));
  return [ei, si];
}
const epochName = (ei: number, si: number) => ei === ERAS.length - 1 ? "Cénozoïque (après les dinosaures)" : `${ERAS[ei].name} ${ERAS[ei].subs[si][0]}`;

const eraBg = (th: Theme, c: RGB, k = 0.55): RGB => lerp(th.ui.panel, c, th.style === "dark" ? k * 0.75 : k);

// ---------------------------------------------------------------------------
// Mini-jeu
// ---------------------------------------------------------------------------
function nextTarget(s: GameState) {
  const t = s.journal.tl;
  const list = knownList(s);
  t.feedback = undefined;
  t.drag = false;
  if (!list.length) { t.target = undefined; return; }
  const done = s.progress.timeline ?? [];
  const todo = list.filter((sp) => !done.includes(sp.id) && sp.id !== t.target);
  const pool = todo.length ? todo : list.filter((sp) => sp.id !== t.target);
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : list[0];
  t.target = pick.id;
}

function drop(s: GameState, ei: number, si: number) {
  const t = s.journal.tl;
  const sp = t.target ? SPECIES[t.target] : undefined;
  if (!sp || t.feedback?.ok) return;
  const [te, ts] = epochOf(ageMid(sp));
  const [a, b] = ageRange(sp);
  const age = a === b ? `${a} Ma` : `${a} à ${b} Ma`;
  if (te === ei && ts === si) {
    const list = (s.progress.timeline ??= []);
    const star = !list.includes(sp.id);
    if (star) { list.push(sp.id); saveProgress(s.progress); toast(s, "Etoile gagnee !", `${sp.name} est bien place sur la frise du temps.`); }
    t.feedback = { ok: true, text: `Bravo ! ${sp.name} vivait au ${epochName(te, ts)}, il y a ${age}.${star ? " Une étoile pour toi !" : ""}` };
  } else {
    const dropMid = (ERAS[ei].subs[si][1] + ERAS[ei].subs[si][2]) / 2;
    const dir = dropMid > ageMid(sp) ? "plus tard, plus près de nous" : "plus tôt, il y a plus longtemps";
    t.feedback = { ok: false, text: `Pas tout à fait : là, c'est le ${epochName(ei, si)}. ${sp.name} a vécu ${dir}. Essaie encore !` };
  }
}

export function timelineUpdate(s: GameState, input: Input) {
  const t = s.journal.tl;
  for (const id of input.ui) {
    if (id === "journal:tl:game") { t.game = !t.game; if (t.game) nextTarget(s); }
    else if (id === "journal:tl:next") nextTarget(s);
    else if (id.startsWith("journal:tl:drop:") && t.game) {
      const [ei, si] = id.slice(16).split(":").map(Number);
      drop(s, ei, si);
    }
  }
  if (!t.game) { t.drag = false; return; }
  for (const p of input.mouse.presses) if (p.button === 0 && hitAt(p.x, p.y) === "journal:tl:card" && !t.feedback?.ok) t.drag = true;
  for (const r of input.mouse.releases) {
    if (!t.drag) continue;
    t.drag = false;
    const id = hitAt(r.x, r.y);
    if (id?.startsWith("journal:tl:drop:")) {
      const [ei, si] = id.slice(16).split(":").map(Number);
      drop(s, ei, si);
    }
  }
  if (!input.mouse.down && !input.mouse.releases.length) t.drag = false;
  for (const k of input.pressed) if (k === "Enter" && t.feedback?.ok) nextTarget(s);
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

/**
 * Trait de rappel en équerre : descend de la vignette jusqu'à la ligne de routage `ry`, longe la frise
 * jusqu'à l'âge de l'espèce, puis descend (ou remonte) jusqu'à la frise en `y1`.
 */
function leader(ui: Frame, cx: number, y0: number, ax: number, ry: number, y1: number, col: RGB) {
  const vline = (x: number, a: number, b: number) => { for (let y = Math.min(a, b); y <= Math.max(a, b); y++) put(ui, x, y, 124, col); };
  if (cx === ax) { vline(cx, y0, y1); return; }
  vline(cx, y0, ry);
  for (let x = Math.min(cx, ax); x <= Math.max(cx, ax); x++) put(ui, x, ry, 45, col);
  vline(ax, ry, y1);
  put(ui, cx, ry, 43, col); put(ui, ax, ry, 43, col);
}

/**
 * Lignes de routage sans croisement : parmi les vignettes dont l'âge est à droite, la plus à droite
 * tourne au plus près d'elle ; idem à gauche. Renvoie un rang (0 = le plus près des vignettes).
 */
function routeRanks(cxs: number[], axs: number[]): number[] {
  const rank = cxs.map(() => 0);
  const right = cxs.map((_, i) => i).filter((i) => axs[i] > cxs[i]).sort((a, b) => cxs[b] - cxs[a]);
  const left = cxs.map((_, i) => i).filter((i) => axs[i] < cxs[i]).sort((a, b) => cxs[a] - cxs[b]);
  right.forEach((i, r) => (rank[i] = r));
  left.forEach((i, r) => (rank[i] = r));
  return rank;
}

/** Répartit des vignettes sur une rangée : au plus près de leur âge, sans se chevaucher. */
function spread(want: number[], w: number, gap: number, x0: number, x1: number): number[] {
  const pos = want.map((c) => c - w / 2);
  for (let i = 0; i < pos.length; i++) pos[i] = Math.max(pos[i], i ? pos[i - 1] + w + gap : x0);
  for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(pos[i], i < pos.length - 1 ? pos[i + 1] - w - gap : x1 - w);
  for (let i = 0; i < pos.length; i++) pos[i] = Math.max(pos[i], i ? pos[i - 1] + w + gap : x0);
  return pos.map(Math.round);
}

export function timelinePage(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const u = th.ui, t = s.journal.tl, p = s.progress;
  const x0 = 3, W = ui.cols - 6;
  const X = (ma: number) => Math.round(maToX(ma, x0, W));
  const top = UI_TOP;

  text(ui, 2, top, "Frise du temps : 252 millions d'années d'histoire", u.hi);
  text(ui, 2, top + 1, t.game ? "Glisse l'animal sur la bonne période de la frise (ou clique la période)." : "Chaque espèce découverte est posée à son âge. Clique une vignette pour ouvrir sa fiche.", u.dim);
  const gl = t.game ? "Quitter le jeu" : "Jeu : place-le sur la frise";
  const stars = (p.timeline ?? []).length;
  const bw = button(ui, th, "journal:tl:game", ui.cols - buttonW(gl) - 2, top, gl, { toggle: true, active: t.game, tip: t.game ? "Revenir a la frise" : "Petit jeu : retrouver l'epoque de chaque espece" });
  const st = `Etoiles : ${stars}/${knownList(s).length || 0}`;
  text(ui, ui.cols - bw - st.length - 5, top, st, u.text);

  // --- Rangées de vignettes (au-dessus et au-dessous de la frise) ---
  const iconH = 4;
  // Lignes de routage des traits de rappel (plus si l'écran est haut).
  const nRoute = Math.max(3, Math.min(6, Math.floor((ui.rows - 36) / 2) + 2));
  const yA = top + 3; // vignettes du haut : yA..yA+3, nom en yA+4
  const yBand = yA + iconH + nRoute + 3; // ère
  const ySub = yBand + 1, yAxis = yBand + 2, yLab = yBand + 3;
  const yB = yLab + nRoute + 3; // nom en yB, vignettes yB+1..yB+4
  const shown = [...new Set([...discovered(p), ...knownList(s)])]
    .filter((sp) => !(t.game && sp.id === t.target))
    .sort((a, b) => ageMid(b) - ageMid(a));
  const rows: Species[][] = [[], []];
  shown.forEach((sp, i) => rows[i % 2].push(sp));
  const perRow = Math.max(1, rows[0].length);
  const iconW = Math.max(8, Math.min(16, Math.floor(W / perRow) - 1));
  let hovered: Species | undefined;
  rows.forEach((row, ri) => {
    const pos = spread(row.map((sp) => X(ageMid(sp))), iconW, 1, x0, x0 + W);
    const cxs = pos.map((x) => x + Math.floor(iconW / 2)), axs = row.map((sp) => X(ageMid(sp)));
    const ranks = routeRanks(cxs, axs);
    row.forEach((sp, i) => {
      const x = pos[i], isKnown = known(s, sp.id);
      const yI = ri === 0 ? yA : yB + 1, yN = ri === 0 ? yA + iconH : yB;
      const hot = isKnown && over(x, Math.min(yI, yN), iconW, iconH + 1);
      if (hot) hovered = sp;
      const col = hot ? u.hi : isKnown ? u.border : u.dim;
      // Trait de rappel vers l'âge de l'espèce.
      const ax = axs[i], cx = cxs[i], rk = Math.min(ranks[i], nRoute - 1);
      if (ri === 0) { leader(ui, cx, yN + 1, ax, yN + 2 + rk, yBand - 1, col); put(ui, ax, yBand - 1, 118, col); }
      else { leader(ui, cx, yN - 1, ax, yN - 2 - rk, yLab + 1, col); put(ui, ax, yLab + 1, 94, col); }
      fitSprite(world, th, `tl:${sp.id}`, sp.model, x, yI, iconW, iconH, hot ? s.time : 0, 0.6,
        isKnown ? undefined : th.style === "dark" ? u.border : u.text, 0.05);
      const star = p.timeline?.includes(sp.id) ? "*" : "";
      const nm = isKnown ? `${star}${sp.name}` : "???";
      text(ui, x + Math.max(0, Math.floor((iconW - nm.length) / 2)), yN, nm.slice(0, iconW), hot ? u.hi : isKnown ? u.text : u.dim, u.panel, u.alpha);
      if (isKnown) region(`journal:sp:${sp.id}`, x, Math.min(yI, yN), iconW, iconH + 1);
    });
  });

  // --- La frise : ères (couleurs), sous-périodes, axe, âges ---
  const mouse = uiCellAt(s.mouse.x, s.mouse.y);
  let dropHot: [number, number] | undefined;
  ERAS.forEach((e, ei) => {
    const ea = X(e.from), eb = ei === ERAS.length - 1 ? x0 + W : X(e.to);
    fill(ui, ea, yBand, eb - ea, 1, eraBg(th, e.col, 0.7), 1);
    const nm = eb - ea >= e.name.length + 2 ? e.name : e.name.slice(0, Math.max(1, eb - ea - 1));
    text(ui, ea + Math.floor((eb - ea - nm.length) / 2), yBand, nm, u.text, eraBg(th, e.col, 0.7), 1);
    e.subs.forEach(([sn, a, b], si) => {
      const sa = X(a), sb = si === e.subs.length - 1 ? eb : X(b);
      const hot = t.game && (t.drag || !t.feedback?.ok) && mouse.x >= sa && mouse.x < sb && mouse.y >= yBand - 1 && mouse.y <= yAxis;
      if (hot) dropHot = [ei, si];
      const bg = hot ? u.hi : eraBg(th, e.col, si % 2 ? 0.32 : 0.45);
      fill(ui, sa, ySub, sb - sa, 1, bg, 1);
      const lab = sb - sa >= sn.length + 1 ? sn : sb - sa >= 4 ? sn.slice(0, 3) : "";
      if (lab) text(ui, sa + Math.floor((sb - sa - lab.length) / 2), ySub, lab, hot ? u.panel : u.text, bg, 1);
      if (t.game && ei < ERAS.length - 1) region(`journal:tl:drop:${ei}:${si}`, sa, yBand - 1, sb - sa, 4);
    });
  });
  for (let x = x0; x < x0 + W; x++) put(ui, x, yAxis, 61, u.border);
  // Plage d'âge de l'espèce survolée.
  if (hovered) { const [a, b] = ageRange(hovered); for (let x = X(a); x <= Math.max(X(a), X(b)); x++) put(ui, x, yAxis, 35, u.hi); }
  for (const ma of [252, 201, 145]) { put(ui, X(ma), yAxis, 43, u.border); text(ui, X(ma), yLab, `${ma} Ma`, u.text); }
  // La météorite (66 Ma) et les humains (0,3 Ma).
  put(ui, X(66), yAxis, 42, u.bad);
  text(ui, X(66), yLab, X(66) + 20 <= x0 + W ? "* 66 Ma : météorite" : "* 66 Ma", u.bad);
  put(ui, X(0.3), yAxis, 105, u.hi); // i : les humains
  text(ui, x0 + W - 14, yLab + 1, "humains (auj.)", u.hi);

  // --- Bas de page : encadrés pédagogiques, ou le mini-jeu ---
  const yC = yB + iconH + 3, hC = ui.rows - 2 - yC;
  if (hC < 3) return;
  if (t.game) gamePanel(s, th, world, ui, x0, yC, W, hC, dropHot);
  else callouts(s, th, ui, x0, yC, W, hC);
}

function callouts(s: GameState, th: Theme, ui: Frame, x: number, y: number, w: number, h: number) {
  const u = th.ui;
  panel(ui, th, x, y, w, h, "Le savais-tu ?");
  const allo = known(s, "allosaurus");
  const items: [string, RGB][] = [
    ["Le T. rex (68-66 Ma) a vécu plus près de nous que du Stégosaure (155-150 Ma) : 66 millions d'années nous séparent du T. rex, mais plus de 80 millions d'années le séparent du Stégosaure !", u.text],
    [allo ? "Allosaurus (155-145 Ma) et T. rex (68-66 Ma) : 80 millions d'années d'écart. Ces deux grands chasseurs ne se sont jamais croisés." :
      "Un grand chasseur du Jurassique se cache encore dans la roche : trouve ses os, puis place-le sur la frise.", u.text],
    ["Les oiseaux sont des dinosaures ! Une seule branche a survécu à la météorite : le pigeon de ta fenêtre est un lointain cousin du T. rex.", u.text],
    ["* Il y a 66 millions d'années, une météorite de 10 km tombe au Mexique : fin des dinosaures non-aviens, des ptérosaures et des grands reptiles marins.", u.bad],
    ["Les humains n'existent que depuis 0,3 million d'années : sur cette frise, à peine l'épaisseur du dernier trait.", u.dim],
  ];
  let yy = y + 1;
  for (const [t, c] of items) {
    for (const l of wrap(`- ${t}`, w - 6)) {
      if (yy >= y + h - 1) return;
      text(ui, x + 2, yy++, l, c, u.panel, u.alpha);
    }
  }
}

function gamePanel(s: GameState, th: Theme, world: Frame, ui: Frame, x: number, y: number, w: number, h: number, hot?: [number, number]) {
  const u = th.ui, t = s.journal.tl;
  box(ui, th, x, y, w, h, u.border, "Place-le sur la frise");
  const sp = t.target ? SPECIES[t.target] : undefined;
  if (!sp) {
    text(ui, x + 3, y + 2, "Assemble d'abord un squelette à l'atelier : tu pourras ensuite le placer sur la frise.", u.dim);
    return;
  }
  const cw = 18, ch = Math.min(5, h - 3);
  const cx = x + 3, cy = y + 1;
  const done = !!t.feedback?.ok;
  if (!t.drag) {
    fitSprite(world, th, `tl:${sp.id}`, sp.model, cx, cy, cw, ch, s.time, 0.8, undefined, 0.05);
    text(ui, cx + Math.max(0, Math.floor((cw - sp.name.length) / 2)), cy + ch, sp.name, u.hi, u.panel, u.alpha);
    if (!done) region("journal:tl:card", cx, cy, cw, ch + 1);
  } else {
    // La vignette suit la souris pendant le glisser-déposer.
    const m = uiCellAt(s.mouse.x, s.mouse.y);
    fitSprite(world, th, `tl:${sp.id}`, sp.model, m.x - Math.floor(cw / 2), m.y - ch, cw, ch, s.time, 0.8, undefined, 0.05);
    text(ui, m.x - Math.floor(sp.name.length / 2), m.y + 1, sp.name, u.panel, u.hi, 1);
  }
  const tx = cx + cw + 3, tw = w - (tx - x) - 3;
  let yy = y + 1;
  const say = (str: string, c: RGB) => { for (const l of wrap(str, tw)) if (yy < y + h - 1) text(ui, tx, yy++, l, c, u.panel, u.alpha); };
  say(`Quand vivait ${le(sp.name)} ? Glisse sa vignette sur la frise, dans la bonne période.`, u.text);
  if (hot && !done) say(`Ici : ${epochName(hot[0], hot[1])}`, u.hi);
  else if (!t.feedback) say(`Indice : la fiche ${du(sp.name)} donne son âge en millions d'années (Ma).`, u.dim);
  if (t.feedback) { yy++; say(t.feedback.text, t.feedback.ok ? u.ok : u.bad); }
  if (done && yy < y + h - 1) button(ui, th, "journal:tl:next", tx, yy + 1, "Espèce suivante", { key: "Entree", variant: "primary" });
}
