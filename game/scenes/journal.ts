import { liveBirth } from "../species/life";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { scalePrim } from "../render/raster";
import { drawRaster } from "../render/sprite";
import { FAUNA, type FaunaDef } from "../species/fauna";
import { SPECIES, SPECIES_LIST } from "../species";
import { eggModel } from "../species/eggs";
import type { FactUnlock, Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { actions, button, buttonW, clip, over, panel, put, region, SP, text, wrap, type Hint } from "../ui/kit";
import { box, cached, DEFENSE, factKey, fitSprite, fmtKg, fmtM, groundLine, hasF, human, idle, known, knownList, lerp, paper, RH, RW } from "./journal-common";
import { createQuizState, quizPage, quizUpdate, type QuizState } from "./journal-quiz";
import { createSizesState, sizesPage, sizesUpdate, type SizesState } from "./journal-sizes";
import { createTimelineState, timelinePage, timelineUpdate, type TimelineState } from "./journal-timeline";
import { UI_TOP, type Scene } from "./types";

/**
 * Carnet de terrain : sommaire des espèces, page détaillée (rendu de studio, échelle humaine, faits),
 * page « Extras » (fossiles bonus, notes sur la petite faune).
 * Les faits jamais lus dans le carnet portent la marque « Nouveau ! » (mémorisée dans le navigateur).
 * Sous-onglets pédagogiques : frise du temps (journal-timeline), quiz (journal-quiz), tailles (journal-sizes).
 */

export type JournalTab = "species" | "timeline" | "quiz" | "sizes";
const SUBTABS: { id: JournalTab; label: string; tip: string }[] = [
  { id: "species", label: "Espèces", tip: "Les fiches de toutes les especes" },
  { id: "timeline", label: "Frise du temps", tip: "Quand vivaient-ils ? Et un petit jeu" },
  { id: "quiz", label: "Quiz", tip: "Questions sur les faits decouverts" },
  { id: "sizes", label: "Tailles", tip: "Comparer leur taille a la notre" },
];

export interface JournalState {
  /** Sous-onglet du carnet (« Espèces » par défaut). */
  tab: JournalTab;
  tl: TimelineState;
  quiz: QuizState;
  sizes: SizesState;
  /** Espèce ouverte dans le carnet (sinon : sommaire). */
  species?: SpeciesId;
  /** Page des extras ouverte (si aucune espèce). */
  extras: boolean;
  /** Vue squelette plutôt que chair. */
  skeleton: boolean;
  /** Défilement des faits / des extras (lignes). */
  scroll: number;
  /** Carte sélectionnée au clavier dans le sommaire. */
  focus: number;
  /** Page ouverte au dernier pas (pour détecter un changement venu d'ailleurs, ex. la réserve). */
  opened: string;
  /** Entrées marquées « Nouveau ! » sur la page courante. */
  fresh: string[];
}

export function createJournalState(): JournalState {
  return { tab: "species", tl: createTimelineState(), quiz: createQuizState(), sizes: createSizesState(),
    extras: false, skeleton: false, scroll: 0, focus: 0, opened: "", fresh: [] };
}

/** Comment débloquer un fait, en clair (carnet et fiche de la réserve). */
export const UNLOCK_HINT: Record<FactUnlock, string> = {
  discover: "Observe-le dans la réserve (clique dessus).",
  assemble: "Assemble son squelette à l'atelier.",
  eat: "Observe-le en train de manger dans la réserve.",
  drink: "Observe-le en train de boire dans la réserve.",
  rest: "Observe-le pendant qu'il dort dans la réserve.",
  attack: "Observe-le pendant qu'il attaque.",
  defend: "Observe-le pendant qu'il se défend face à un prédateur.",
  call: "Observe-le pendant qu'il appelle ses congénères.",
  herd: "Observe-le quand il est avec son troupeau.",
  hunt: "Observe-le pendant qu'il chasse.",
  flee: "Observe-le pendant qu'il fuit un prédateur.",
  scavenge: "Observe-le pendant qu'il mange une carcasse.",
  migrate: "Observe-le pendant qu'il migre avec son troupeau.",
  nest: "Observe un de ses nids (ou un parent qui le garde) dans la réserve.",
  baby: "Observe un de ses petits dans la réserve.",
};

// ---------------------------------------------------------------------------
// « Déjà lu » : mémorisé dans le navigateur, séparé de la progression.
// ---------------------------------------------------------------------------
const SEEN_KEY = "ascii-dino-journal-seen-v1";
let seen: Set<string> | null = null;
function seenSet(): Set<string> {
  if (seen) return seen;
  seen = new Set();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) for (const k of JSON.parse(raw) as string[]) seen.add(k);
  } catch {
    // Pas de stockage : tout reste « nouveau » pendant la session, ce n'est pas grave.
  }
  return seen;
}
function markSeen(keys: string[]) {
  const set = seenSet();
  let changed = false;
  for (const k of keys) if (!set.has(k)) { set.add(k); changed = true; }
  if (!changed) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* sans stockage */ }
}

export { known } from "./journal-common";
const faunaList = () => Object.values(FAUNA) as FaunaDef[];

function newCount(s: GameState, sp: Species): number {
  const set = seenSet();
  return sp.facts.filter((f) => hasF(s, sp.id, f.id) && !set.has(factKey(sp.id, f.id))).length;
}

/** Ouvre une page : ce qui n'a jamais été lu devient « Nouveau ! » pour cette visite, puis « lu ». */
function openPage(s: GameState) {
  const j = s.journal;
  j.opened = j.species ? `sp:${j.species}` : j.extras ? "extras" : "summary";
  j.scroll = 0;
  const set = seenSet();
  let keys: string[] = [];
  const spec = j.species ? SPECIES[j.species] : undefined;
  if (spec) keys = spec.facts.filter((f) => hasF(s, spec.id, f.id)).map((f) => factKey(spec.id, f.id));
  else if (j.extras) keys = s.progress.extras.map((e) => `x:${e}`);
  j.fresh = keys.filter((k) => !set.has(k));
  markSeen(keys);
}

function go(s: GameState, sp: SpeciesId | undefined, extras = false) {
  s.journal.species = sp;
  s.journal.extras = extras;
  openPage(s);
}

function step(s: GameState, dir: number) {
  const list = knownList(s);
  if (!list.length) return;
  const k = list.findIndex((sp) => sp.id === s.journal.species);
  go(s, list[(k + dir + list.length) % list.length].id);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Grille du sommaire à la dernière image (colonnes), pour la navigation au clavier. */
let gridCols = 2;

/**
 * Grille du sommaire : le plus grand nombre de lignes de cartes qui tiennent sans défiler (cartes de 8 à
 * 18 lignes, 28 colonnes au moins) ; sinon on garde des cartes de 9 lignes et la grille défile.
 */
function grid(cols: number, avail: number, n: number) {
  let best: { ncol: number; cw: number; ch: number } | undefined;
  for (let ncol = 2; ncol <= 6; ncol++) {
    const cw = Math.floor((cols - 4 - (ncol - 1) * 2) / ncol);
    if (cw < 28) break;
    const nrow = Math.ceil(n / ncol);
    const ch = Math.floor((avail - (nrow - 1)) / nrow);
    if (ch >= 8) return { ncol, cw, ch: Math.min(18, ch), scroll: false };
    best = { ncol, cw, ch: 9 };
  }
  best ??= { ncol: 1, cw: cols - 4, ch: 9 };
  return { ...best, scroll: true };
}

function summary(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const u = th.ui, j = s.journal;
  const p = s.progress;
  const total = SPECIES_LIST.reduce((n, sp) => n + sp.facts.length, 0);
  const got = SPECIES_LIST.reduce((n, sp) => n + sp.facts.filter((f) => hasF(s, sp.id, f.id)).length, 0);
  const xl = `Extras (${p.extras.length})`;
  const bx = ui.cols - buttonW(xl) - SP.pad;
  button(ui, th, "journal:extras", bx, UI_TOP - 1, xl, { tip: "Fossiles bonus et petite faune" });
  const ft = `Faits decouverts : ${got}/${total}`;
  if (bx - ft.length - 3 > 56) text(ui, bx - ft.length - 3, UI_TOP - 1, ft, u.text);

  const n = SPECIES_LIST.length;
  const top = UI_TOP + 1, bottom = ui.rows - 2;
  const g = grid(ui.cols, bottom - top, n);
  gridCols = g.ncol;
  const { ncol, cw, ch } = g;
  const nrow = Math.ceil(n / ncol);
  const vis = Math.max(1, Math.floor((bottom - top + 1) / (ch + 1)));
  // Défilement par rangée : la carte qui a le focus reste visible.
  const fr = Math.floor(j.focus / ncol);
  if (fr < j.scroll) j.scroll = fr;
  if (fr >= j.scroll + vis) j.scroll = fr - vis + 1;
  j.scroll = Math.max(0, Math.min(Math.max(0, nrow - vis), j.scroll));
  SPECIES_LIST.forEach((sp, idx) => {
    const row = Math.floor(idx / ncol) - j.scroll;
    if (row < 0 || row >= vis) return;
    const x = 2 + (idx % ncol) * (cw + 2), y = top + row * (ch + 1);
    const isKnown = known(s, sp.id);
    const hot = isKnown && (over(x, y, cw, ch) || j.focus === idx);
    box(ui, th, x, y, cw, ch, hot ? u.hi : isKnown ? u.border : u.dim);
    const spriteH = ch - 5;
    fitSprite(world, th, `card:${sp.id}`, sp.model, x + 1, y + 1, cw - 2, spriteH, isKnown && hot ? s.time : 0, 1.6, isKnown ? undefined : th.style === "dark" ? u.border : u.text);
    const ty = y + ch - 4;
    if (!isKnown) {
      text(ui, x + Math.floor(cw / 2) - 1, y + Math.floor(spriteH / 2), "???", u.panel, u.dim, 0.9);
      text(ui, x + 2, ty, "???", u.dim, u.panel, u.alpha);
      wrap("Espèce inconnue : trouve un de ses os en fouille.", cw - 4).slice(0, 2).forEach((l, i) => text(ui, x + 2, ty + 1 + i, l, u.dim, u.panel, u.alpha));
      return;
    }
    const facts = sp.facts.filter((f) => hasF(s, sp.id, f.id)).length;
    const nw = newCount(s, sp);
    const name = clip(sp.name, cw - 4 - (nw ? 16 : 0));
    const nl = text(ui, x + 2, ty, name, hot ? u.hi : u.text, u.panel, u.alpha);
    if (nw) text(ui, x + 3 + nl, ty, clip(` Nouveau ! (${nw}) `, cw - 5 - nl), u.panel, u.hi, 1);
    text(ui, x + 2, ty + 1, clip(sp.latin, cw - 4), u.dim, u.panel, u.alpha);
    const bones = p.bones[sp.id]?.length ?? 0;
    const asm = p.assembled.includes(sp.id) ? "Assemblé" : `Os ${bones}/${sp.bones.length}`;
    const pop = p.population[sp.id] ?? 0;
    const info = `Faits ${facts}/${sp.facts.length}   ${asm}${pop ? `   Réserve : ${pop}` : ""}`;
    text(ui, x + 2, ty + 2, clip(info, cw - 4), u.text, u.panel, u.alpha);
    region(`journal:sp:${sp.id}`, x, y, cw, ch, { focus: true, tip: `Ouvrir la fiche : ${sp.name}` });
  });
  if (nrow > vis) {
    const t = ` Rangees ${j.scroll + 1}-${Math.min(nrow, j.scroll + vis)} sur ${nrow} : molette `;
    text(ui, ui.cols - t.length - 2, bottom, t, u.dim, u.panel, u.alpha);
  }
}

interface Line { t: string; c: RGB; tag?: string }

function speciesPage(s: GameState, th: Theme, world: Frame, ui: Frame, spec: Species) {
  const u = th.ui, j = s.journal, p = s.progress;
  const L = Math.max(40, Math.floor(ui.cols * 0.55));
  const top = UI_TOP, bottom = ui.rows - 3;
  const H = bottom - top;

  // --- Rendu de studio à gauche ---
  box(ui, th, 1, top, L - 1, H, u.border, spec.name);
  let bx = 3;
  bx += button(ui, th, "journal:flesh", bx, top + 1, "Chair", { active: !j.skeleton }) + 1;
  bx += button(ui, th, "journal:skel", bx, top + 1, "Squelette", { active: j.skeleton }) + 2;
  const rw = RW(), rh = RH();
  const ax = 3 * rw, aw = (L - 6) * rw;
  const groundY = Math.round((bottom - 4) * rh);
  const ah = groundY - (top + 3) * rh;
  const man = cached("human", human);
  const r1 = cached(`big:${spec.id}|1`, () => spec.model(idle(0)));
  const gap = 6;
  const k = Math.max(0.5, Math.min(3, (aw - man.w * 3 - gap * 2) / r1.w, ah / r1.h));
  const kq = Math.round(k * 8) / 8;
  const hm = cached(`human|${kq}`, () => human().map((q) => scalePrim(q, kq)));
  const tq = Math.floor(s.time * 5) % 6;
  const flesh = cached(`big:${spec.id}|${kq}|${tq}`, () => spec.model(idle(tq / 5)).map((q) => scalePrim(q, kq)));
  // La mise en page se cale sur une pose fixe : la respiration anime l'animal sans faire bouger
  // l'humain, le sol ni la cote (les rasters partagent la même origine, au sol sous le corps).
  const ref = cached(`big:${spec.id}|${kq}|0`, () => spec.model(idle(0)).map((q) => scalePrim(q, kq)));
  // Sol commun, l'humain à gauche, l'animal à droite : même échelle.
  const used = hm.w + gap + ref.w;
  const left = Math.round(ax + Math.max(0, (aw - used) / 2));
  const hx = left - hm.cx;
  const dx = left + hm.w + gap - ref.cx;
  groundLine(world, th, ax, ax + aw, groundY);
  drawRaster(world, th, hm, hx, groundY, { tint: th.style === "dark" ? u.text : u.border, light: 0.8 });
  // Son œuf, dans le coin haut droit du studio (le mosasaure, lui, mettait bas des petits vivants).
  if (!liveBirth(spec) && L >= 50) {
    const ex = L - 12, ey = top + 2;
    text(ui, ex, ey, "Son oeuf", u.dim);
    fitSprite(world, th, `egg:${spec.id}`, () => eggModel(spec.id, 0), ex, ey + 1, 9, 4, 0, 4);
  }
  if (j.skeleton) {
    const have = new Set(p.bones[spec.id] ?? []);
    const asm = p.assembled.includes(spec.id);
    const sk = `${asm ? "all" : [...have].sort().join(",")}`;
    const found = cached(`skel:${spec.id}|${kq}|${sk}|1`, () => spec.skeleton(idle(0)).filter((q) => asm || !q.bone || have.has(q.bone)).map((q) => scalePrim(q, kq)));
    const miss = cached(`skel:${spec.id}|${kq}|${sk}|0`, () => spec.skeleton(idle(0)).filter((q) => !asm && q.bone && !have.has(q.bone)).map((q) => scalePrim(q, kq)));
    drawRaster(world, th, miss, dx, groundY, { ghost: true });
    drawRaster(world, th, found, dx, groundY);
    const cap = asm ? "Squelette complet (assemblé à l'atelier)" : `Os trouvés : ${have.size}/${spec.bones.length}, les manquants en pointillés`;
    text(ui, bx, top + 1, cap.slice(0, Math.max(0, L - bx - 2)), u.dim);
  } else drawRaster(world, th, flesh, dx, groundY);
  // Cote de longueur au-dessus de l'animal, légende de l'humain sous ses pieds.
  const ux0 = Math.ceil((dx + ref.cx) / rw), ux1 = Math.floor((dx + ref.cx + ref.w) / rw);
  const uy = Math.max(top + 2, Math.floor((groundY + ref.cy) / rh) - 1);
  const lab = ` ${fmtM(spec.lengthM)} `;
  if (ux1 - ux0 > lab.length + 4) {
    const line = `|${"-".repeat(ux1 - ux0 - 1)}|`;
    text(ui, ux0, uy, line, u.dim);
    text(ui, ux0 + Math.floor((ux1 - ux0 - lab.length) / 2), uy, lab, u.text);
  }
  const hux = Math.floor((hx + hm.cx + hm.w / 2) / rw);
  text(ui, Math.max(2, hux - 3), Math.floor(groundY / rh) + 1, "Humain", u.dim);
  text(ui, Math.max(2, hux - 3), Math.floor(groundY / rh) + 2, "1,75 m", u.dim);

  // --- Fiche à droite ---
  const px = L + 1, pw = ui.cols - px - 1;
  panel(ui, th, px, top, pw, H, "Fiche");
  const tw = pw - 4;
  const B = spec.behavior;
  const lines: Line[] = [];
  const add = (t: string, c: RGB, tag?: string) => wrap(t, tw).forEach((l, i) => lines.push({ t: l, c, tag: i === 0 ? tag : undefined }));
  add(spec.name, u.hi);
  add(spec.latin, u.dim);
  lines.push({ t: "", c: u.text });
  add(`Époque : ${spec.period}`, u.text);
  add(`Lieu : ${spec.place}`, u.text);
  add(`Taille : ${fmtM(spec.lengthM)} de long, ${fmtKg(spec.massKg)}`, u.text);
  add(`  ${compare(spec)}`, u.dim);
  const diet = B.diet === "herbivore" ? `herbivore${B.browse ? B.browse === "low" ? ", plantes basses" : B.browse === "high" ? ", feuilles hautes" : ", plantes basses et hautes" : ""}`
    : B.diet === "carnivore" ? `carnivore${B.prey.length ? `, chasse ${B.prey.map((q) => SPECIES[q]?.name ?? q).join(", ")}` : ""}` : "omnivore";
  add(`Régime : ${diet}${B.scavenger ? " (mange aussi les carcasses)" : ""}`, u.text);
  add(`Défense : ${DEFENSE[B.defense]}`, u.text);
  add(`Vie sociale : ${B.herd[1] <= 1 ? "solitaire" : `groupes de ${B.herd[0]} à ${B.herd[1]}`}`, u.text);
  add(`Naissance : ${liveBirth(spec) ? `des petits vivants${spec.habitat === "sea" ? ", nés dans l'eau" : ""} (pas d'œuf)` : "dans un œuf, pondu dans un nid"}`, u.text);
  const eggs = p.eggs[spec.id] ?? 0;
  if (eggs > 0) add(`Oeufs fossiles à l'atelier : ${eggs} (à incuber)`, u.hi);
  const bones = p.bones[spec.id]?.length ?? 0;
  add(`Atelier : ${p.assembled.includes(spec.id) ? "squelette assemblé" : `${bones}/${spec.bones.length} os trouvés`}`, u.text);
  lines.push({ t: "", c: u.text });
  const got = spec.facts.filter((f) => hasF(s, spec.id, f.id)).length;
  add(`Faits (${got}/${spec.facts.length})`, u.hi);
  lines.push({ t: "-".repeat(Math.min(tw, 30)), c: u.border });
  for (const f of spec.facts) {
    if (hasF(s, spec.id, f.id)) {
      add(`[*] ${f.title}`, u.text, j.fresh.includes(factKey(spec.id, f.id)) ? " Nouveau ! " : undefined);
      wrap(f.text, tw - 4).forEach((l) => lines.push({ t: `    ${l}`, c: u.dim === u.text ? u.text : lerp(u.text, u.dim, 0.35) }));
    } else {
      add("[ ] ???", u.dim);
      wrap(`Indice : ${UNLOCK_HINT[f.unlock]}`, tw - 4).forEach((l) => lines.push({ t: `    ${l}`, c: u.dim }));
    }
    lines.push({ t: "", c: u.text });
  }
  drawLines(ui, th, j, lines, px + 2, top + 1, H - 2, tw);

  // --- Navigation (bas à droite, l'action principale « Suivant » tout à droite) ---
  actions(ui, th, 2, ui.rows - 2, ui.cols - 4, [
    { id: "journal:back", label: "Sommaire", key: "Echap", tip: "Retour au sommaire du carnet" },
    { id: "journal:prev", label: "< Precedent", key: "<-", tip: "Espece precedente (fleche gauche)" },
    { id: "journal:next", label: "Suivant >", key: "->", variant: "primary", tip: "Espece suivante (fleche droite)" },
  ]);
}

/** Écrit une liste de lignes avec défilement (molette, flèches haut/bas). */
function drawLines(ui: Frame, th: Theme, j: JournalState, lines: Line[], x: number, y: number, h: number, w: number) {
  const u = th.ui;
  const max = Math.max(0, lines.length - h);
  j.scroll = Math.max(0, Math.min(max, j.scroll));
  const off = j.scroll;
  for (let i = 0; i < h && i + off < lines.length; i++) {
    const l = lines[i + off];
    const n = text(ui, x, y + i, l.t, l.c, u.panel, u.alpha);
    if (l.tag) text(ui, x + n + 1, y + i, l.tag, u.panel, u.hi, 1);
  }
  if (max > 0) {
    // Ascenseur.
    const pos = Math.round((off / max) * (h - 1));
    for (let i = 0; i < h; i++) put(ui, x + w + 1, y + i, i === pos ? 35 : 58, i === pos ? u.hi : u.dim, u.panel, u.alpha);
  }
}

/** Comparaison à l'échelle humaine (longueur en adultes allongés, masse en adultes ou éléphants). */
function compare(spec: Species): string {
  const len = spec.lengthM / 1.75;
  const lt = len < 1.5 ? "à peu près la taille d'un adulte" : `aussi long que ${Math.round(len)} adultes allongés bout à bout`;
  const mt = spec.massKg >= 3000 ? `aussi lourd que ${String(Math.round(spec.massKg / 600) / 10).replace(".", ",")} éléphant${spec.massKg >= 9000 ? "s" : ""} d'Afrique`
    : `aussi lourd que ${Math.max(1, Math.round(spec.massKg / 70))} adultes`;
  return `Soit ${lt}, ${mt}.`;
}

/** Texte lisible pour un identifiant d'extra inconnu (« fauna:petit-mammifere » -> « Petit mammifere »). */
function humanize(id: string): string {
  const t = id.replace(/^[a-z]+:/, "").replace(/[-_]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
}

function extrasPage(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const u = th.ui, j = s.journal;
  text(ui, 2, UI_TOP, "Extras", u.hi);
  text(ui, 2, UI_TOP + 1, "Fossiles bonus trouvés en fouille et notes sur la petite faune de la réserve.", u.dim);
  const top = UI_TOP + 3, bottom = ui.rows - 3, H = bottom - top;
  const x = 2, W = ui.cols - 4, iconW = 14;
  box(ui, th, x, top, W, H, u.border);
  // Entrées : la petite faune (connue ou non), puis les autres extras.
  interface Entry { key: string; title: string; sub: string; body: string; def?: FaunaDef; locked: boolean }
  const entries: Entry[] = [];
  const ex = s.progress.extras;
  for (const d of faunaList()) {
    const k = `fauna:${d.id}`;
    entries.push(ex.includes(k) ? { key: k, title: d.name, sub: d.latin, body: d.text, def: d, locked: false }
      : { key: k, title: "???", sub: "Petite bête de la réserve", body: "Clique sur cette petite bête dans la réserve pour l'ajouter au carnet.", locked: true });
  }
  for (const k of ex) {
    if (entries.some((e) => e.key === k)) continue;
    entries.push({ key: k, title: humanize(k), sub: k.startsWith("fauna:") ? "Petite faune" : "Fossile bonus", body: "", locked: false });
  }
  if (!entries.length) {
    text(ui, x + 3, top + 2, "Rien pour l'instant : fouille et observe la réserve pour remplir cette page.", u.dim);
    return;
  }
  const tw = W - iconW - 8;
  const blocks = entries.map((e) => ({ e, lines: e.body ? wrap(e.body, tw) : [] }));
  const heights = blocks.map((b) => Math.max(5, 3 + b.lines.length));
  const totalH = heights.reduce((a, b) => a + b, 0);
  const max = Math.max(0, totalH - (H - 2));
  j.scroll = Math.max(0, Math.min(max, j.scroll));
  let yy = top + 1 - j.scroll;
  blocks.forEach(({ e, lines }, i) => {
    const h = heights[i];
    if (yy + h > top + 1 && yy < bottom - 1) {
      const vis = (r: number) => r > top && r < bottom - 1;
      const isNew = j.fresh.includes(`x:${e.key}`);
      if (vis(yy)) {
        const n = text(ui, x + iconW + 4, yy, e.title, e.locked ? u.dim : u.hi);
        if (isNew) text(ui, x + iconW + 5 + n, yy, " Nouveau ! ", u.panel, u.hi, 1);
      }
      if (vis(yy + 1)) text(ui, x + iconW + 4, yy + 1, e.sub, u.dim);
      lines.forEach((l, k) => { if (vis(yy + 2 + k)) text(ui, x + iconW + 4, yy + 2 + k, l, u.text); });
      // Petit portrait (seulement s'il tient en entier dans la zone visible).
      if (e.def && vis(yy) && vis(yy + 3)) {
        const def = e.def;
        fitSprite(world, th, `fauna:${def.id}`, def.model, x + 2, yy, iconW, 4, s.time, 6);
      } else if (vis(yy) && vis(yy + 2)) {
        text(ui, x + 2 + Math.floor(iconW / 2) - 1, yy + 1, e.locked ? "???" : e.key.startsWith("fauna:") ? "~o~" : "(@)", e.locked ? u.dim : u.text);
      }
    }
    yy += h;
  });
  if (max > 0) text(ui, x + W - 22, bottom - 1, " Molette : défiler ", u.dim, u.panel, u.alpha);
  actions(ui, th, 2, ui.rows - 2, ui.cols - 4, [{ id: "journal:back", label: "Sommaire", key: "Echap", variant: "primary", tip: "Retour au sommaire du carnet" }]);
}

/** Sous-onglets du carnet, sur la ligne d'air sous l'en-tête. */
function subTabs(s: GameState, th: Theme, ui: Frame) {
  let x = 2;
  for (const t of SUBTABS) x += button(ui, th, `journal:tab:${t.id}`, x, UI_TOP - 1, t.label, { active: s.journal.tab === t.id, tip: t.tip }) + SP.gap;
}

export const journalScene: Scene = {
  enter(s) {
    openPage(s);
  },

  update(s, input: Input) {
    const j = s.journal;
    const page = j.species ? `sp:${j.species}` : j.extras ? "extras" : "summary";
    // Une fiche ouverte depuis ailleurs (la réserve) ramène à l'onglet « Espèces ».
    if (page !== j.opened) { openPage(s); if (j.species) j.tab = "species"; }
    for (const id of input.ui) {
      if (id.startsWith("journal:tab:")) { j.tab = id.slice(12) as JournalTab; j.scroll = 0; }
      // Une vignette de la frise (ou d'ailleurs) ouvre la fiche de l'espèce.
      else if (id.startsWith("journal:sp:")) { go(s, id.slice(11) as SpeciesId); j.skeleton = false; j.tab = "species"; }
    }
    if (j.tab === "timeline") return timelineUpdate(s, input);
    if (j.tab === "quiz") return quizUpdate(s, input);
    if (j.tab === "sizes") return sizesUpdate(s, input);
    const list = SPECIES_LIST;
    for (const id of input.ui) {
      if (id === "journal:extras") go(s, undefined, true);
      else if (id === "journal:back") go(s, undefined);
      else if (id === "journal:prev") step(s, -1);
      else if (id === "journal:next") step(s, 1);
      else if (id === "journal:flesh") j.skeleton = false;
      else if (id === "journal:skel") j.skeleton = true;
    }
    // Molette : défile la fiche ou les extras ; dans le sommaire, change de rangée de cartes.
    const summaryPage = !j.species && !j.extras;
    if (input.mouse.wheel && !summaryPage) j.scroll += Math.sign(input.mouse.wheel) * 3;
    if (input.mouse.wheel && summaryPage) j.focus = Math.max(0, Math.min(list.length - 1, j.focus + Math.sign(input.mouse.wheel) * gridCols));
    for (const k of input.pressed) {
      if (j.species) {
        if (k === "ArrowLeft") step(s, -1);
        else if (k === "ArrowRight") step(s, 1);
        else if (k === "ArrowUp") j.scroll -= 2;
        else if (k === "ArrowDown") j.scroll += 2;
        else if (k === "Space" || k === "Enter") j.skeleton = !j.skeleton;
      } else if (j.extras) {
        if (k === "ArrowUp") j.scroll -= 2;
        else if (k === "ArrowDown") j.scroll += 2;
        else if (k === "ArrowLeft") go(s, undefined);
      } else {
        const ncol = gridCols;
        const move = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? -ncol : k === "ArrowDown" ? ncol : 0;
        if (move) j.focus = (j.focus + move + list.length) % list.length;
        if ((k === "Enter" || k === "Space") && list[j.focus] && known(s, list[j.focus].id)) go(s, list[j.focus].id);
      }
    }
    j.scroll = Math.max(0, j.scroll);
  },

  hints(s) {
    const j = s.journal;
    if (j.tab === "timeline") return j.tl.game ? [["Glisser", "poser l'animal sur la frise"], ["Clic", "choisir une periode"], ["Entree", "espece suivante"]] : [["Clic", "ouvrir une fiche"], ["Echap", "retour aux especes"]];
    if (j.tab === "quiz") return [["Clic", "repondre"], ["Entree", "question suivante"], ["Echap", "retour aux especes"]];
    if (j.tab === "sizes") return [["Haut/Bas", "changer d'espece"], ["Clic", "choisir la comparaison"], ["Echap", "retour aux especes"]];
    if (j.species) return [["Gauche/Droite", "changer d'espece"], ["Haut/Bas", "defiler"], ["Espace", "chair / squelette"], ["Echap", "sommaire"]];
    if (j.extras) return [["Haut/Bas", "defiler"], ["Echap", "sommaire"]];
    return [["Fleches", "choisir une fiche"], ["Entree", "ouvrir"], ["Molette", "defiler"]];
  },

  help(s) {
    const h: Hint[] = [
      ["Clic", "les sous-onglets Especes, Frise du temps, Quiz, Tailles (ou Tab pour les atteindre)"],
      ["Fleches", "sommaire : choisir une fiche ; fiche : gauche/droite change d'espece, haut/bas defile"],
      ["Entree", "sommaire : ouvrir la fiche choisie ; quiz et frise : question / espece suivante"],
      ["Espace", "fiche : basculer chair / squelette"],
      ["Echap", "revenir au sommaire, puis aux especes, puis le menu"],
    ];
    void s;
    return h;
  },

  back(s) {
    const j = s.journal;
    if (j.tab !== "species") { j.tab = "species"; j.scroll = 0; return true; }
    if (j.species || j.extras) {
      // Le focus du sommaire revient sur la fiche qu'on quitte.
      const i = SPECIES_LIST.findIndex((sp) => sp.id === j.species);
      go(s, undefined);
      if (i >= 0) j.focus = i;
      return true;
    }
    return false;
  },

  compose(s, th, world, ui) {
    const j = s.journal;
    paper(th, world);
    subTabs(s, th, ui);
    if (j.tab === "timeline") return timelinePage(s, th, world, ui);
    if (j.tab === "quiz") return quizPage(s, th, world, ui);
    if (j.tab === "sizes") return sizesPage(s, th, world, ui);
    const spec = j.species ? SPECIES[j.species] : undefined;
    if (spec) speciesPage(s, th, world, ui, spec);
    else if (j.extras) extrasPage(s, th, world, ui);
    else summary(s, th, world, ui);
  },
};
