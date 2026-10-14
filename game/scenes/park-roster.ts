import { isFish } from "./eco-special";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { uiCellAt } from "../render/metrics";
import { SPECIES, SPECIES_LIST } from "../species";
import { INCUBATION, lifespan, MAX_PER_SPECIES, stageOf, type Stage } from "../species/life";
import type { Species } from "../species/types";
import type { GameState } from "../state";
import { actions, bar, over, panel, put, region, SP, text, wrap, type Action } from "../ui/kit";
import { deName } from "./dig-fossils";
import { activity } from "./ecosystem";
import { UNLOCK_HINT } from "./journal";
import type { Animal, Nest } from "./park";
import { UI_TOP } from "./types";

/**
 * Interface du cycle de vie dans la réserve : fiche d'un animal (stade, âge, vie, famille, bouton
 * « Retirer »), fiche d'un nid, et le recensement (liste de tous les animaux, par espèce).
 */

/** Une journée de la réserve dure 8 min (480 s) à vitesse x1. */
export const DAY_S = 480;
/** Lignes défilées par cran de molette dans le recensement. */
export const ROSTER_STEP = 3;

/** Nom du stade, avec ses accents (le kit les retire à l'affichage). */
export const STAGE_LABEL: Record<Stage, string> = { baby: "bébé", juvenile: "juvénile", adult: "adulte", old: "âgé" };
/** Repère d'une lettre pour chaque stade (recensement). */
const STAGE_ICON: Record<Stage, string> = { baby: "b", juvenile: "j", adult: "A", old: "V" };

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const days = (life: number) => `${String(Math.round((life / DAY_S) * 10) / 10).replace(".", ",")} j`;
/** « Le Tricératops », « L'Ankylosaure ». */
/** Nom affiché d'un animal : « Tricératops (bébé) », « Tricératops (juvénile) » ; rien de plus pour un adulte. */
export function displayName(spec: Species, a: Animal): string {
  const st = stageOf(spec, a.life);
  return st === "baby" ? `${spec.name} (bébé)` : st === "juvenile" ? `${spec.name} (juvénile)` : spec.name;
}

export const theName = (n: string) => (/^[aeiouyhAEIOUYHÉ]/.test(n) ? `L'${n}` : `Le ${n}`);

/**
 * Avancement de l'éclosion d'un nid (0..1) : rien pendant les trois premiers quarts de l'incubation,
 * puis les coquilles se fendillent ; 1 une fois éclos.
 */
export function nestCrack(n: Nest): number {
  if (n.hatched !== undefined) return 1;
  const u = n.t / INCUBATION;
  return u < 0.75 ? 0 : Math.min(1, (u - 0.75) / 0.25);
}

// ---------------------------------------------------------------------------
// Fiche d'un animal
// ---------------------------------------------------------------------------

/**
 * Fiche de l'animal sélectionné (bas gauche) : activité, stade et âge, besoins, troupeau, ce qu'il reste
 * à découvrir. Fermeture en haut à droite, actions en bas à droite. Renvoie sa ligne du haut.
 */
export function drawAnimalCard(s: GameState, th: Theme, ui: Frame, a: Animal): number {
  const spec = SPECIES[a.sp];
  if (!spec) return ui.rows - 1;
  const u = th.ui, p = s.park;
  const dead = a.task === "dead";
  const confirm = !dead && p.confirmRetire === a.id;
  const W = Math.min(52, ui.cols - 2 * SP.margin - 2), H = dead ? 16 : 19, x = SP.margin + 1, y = Math.max(UI_TOP, ui.rows - H - 2);
  panel(ui, th, x, y, W, H, `${displayName(spec, a)} #${a.id}`, { close: "park:close" });
  text(ui, x + 2, y + 1, spec.latin, u.dim, u.panel, u.alpha);
  const lines = wrap(`En ce moment : il ${activity(a)}.`, W - 4);
  lines.slice(0, 2).forEach((l, i) => text(ui, x + 2, y + 2 + i, l, u.text, u.panel, u.alpha));
  let r = y + 5;
  if (dead) {
    wrap(a.natural ? "Il est mort de vieillesse, paisiblement." : `Carcasse : elle disparaîtra dans ${Math.ceil(a.decay / 60)} min. Les charognards en profitent.`, W - 4)
      .forEach((l, i) => text(ui, x + 2, r + i, l, u.dim, u.panel, u.alpha));
    r += 4;
  } else {
    // Cycle de vie : stade, âge, vie restante, famille.
    const st = stageOf(spec, a.life);
    const life = a.life / lifespan(spec);
    const d = Math.round((a.life / DAY_S) * 10) / 10;
    text(ui, x + 2, r++, `${cap(STAGE_LABEL[st])}, âge : ${String(d).replace(".", ",")} jour${d >= 2 ? "s" : ""} de la réserve`, u.hi, u.panel, u.alpha);
    text(ui, x + 2, r, "Vie", u.text, u.panel, u.alpha);
    bar(ui, th, x + 11, r, 20, life, st === "old" ? u.bad : u.ok);
    text(ui, x + 32, r++, `${Math.round(life * 100)} %`, u.dim, u.panel, u.alpha);
    const parent = a.parentId ? p.animals.find((b) => b.id === a.parentId && b.task !== "dead") : undefined;
    const nest = a.nestId ? p.nests.find((n) => n.id === a.nestId) : undefined;
    let fam = "";
    if (a.gestation) fam = isFish(spec) ? `Va bientot frayer : ${Math.round(a.gestation * 100)} %.` : `Attend un petit : naissance a ${Math.round(a.gestation * 100)} %.`;
    else if (nest) fam = `Garde son nid (${nest.eggs} œuf${nest.eggs > 1 ? "s" : ""}) : il ne s'éloigne pas.`;
    else if (st === "baby" || st === "juvenile") fam = parent ? `Suit son parent (#${parent.id}) partout.` : "Jeune sans parent : il se débrouille seul.";
    else if (st === "old") fam = "Âgé : plus lent, il se repose souvent.";
    text(ui, x + 2, r++, fam, u.dim, u.panel, u.alpha);
    // Besoin urgent : « ! urgent » écrit en plus de la couleur de la barre.
    const need = (label: string, v: number, bad: boolean) => {
      text(ui, x + 2, r, label, u.text, u.panel, u.alpha);
      bar(ui, th, x + 11, r, 20, v, bad ? u.bad : u.ok);
      if (bad) text(ui, x + 32, r, "! urgent", u.bad, u.panel, u.alpha);
      r++;
    };
    need("Faim", a.hunger, a.hunger > 0.7);
    need("Soif", a.thirst, a.thirst > 0.7);
    need("Énergie", a.energy, a.energy < 0.25);
    const [h0, h1] = spec.behavior.herd;
    const herdTxt = h1 <= 1 ? "Solitaire : il vit seul." : a.herd > 1 ? `Troupeau : ${a.herd} individus ensemble.` : `Seul, loin de son groupe (${h0}-${h1} d'habitude).`;
    text(ui, x + 2, r++, herdTxt, u.dim, u.panel, u.alpha);
  }
  // Ce qui reste à découvrir : on pointe le prochain fait verrouillé.
  const facts = spec.facts;
  const got = facts.filter((f) => s.progress.facts.includes(`${a.sp}:${f.id}`)).length;
  text(ui, x + 2, r + 1, `Carnet : ${got}/${facts.length} faits`, u.text, u.panel, u.alpha);
  if (confirm) {
    wrap("! Retirer ce dinosaure de la réserve ? Il disparaîtra.", W - 4).slice(0, 2)
      .forEach((l, i) => text(ui, x + 2, r + 2 + i, l, u.bad, u.panel, u.alpha));
    actions(ui, th, x + 2, y + H - 2, W - 4, [
      { id: "park:retire:no", label: "Annuler" },
      { id: "park:retire:yes", label: "Oui, retirer", variant: "danger" },
    ]);
    return y;
  }
  const locked = facts.filter((f) => !s.progress.facts.includes(`${a.sp}:${f.id}`) && f.unlock !== "assemble");
  const now = locked.find((f) => f.unlock === a.action || f.unlock === a.mood || (f.unlock === "nest" && a.nestId) || (f.unlock === "baby" && a.growth < 1));
  let teaser: string, hot = false;
  if (now) { teaser = "Clique-le maintenant pour en apprendre plus !"; hot = true; }
  else if (locked[0]) teaser = `Indice : ${UNLOCK_HINT[locked[0].unlock]}`;
  else teaser = got === facts.length ? "Carnet complet pour cette espèce. Bravo !" : "Assemble son squelette à l'atelier pour le dernier fait.";
  wrap(hot ? `> ${teaser}` : teaser, W - 4).slice(0, 2).forEach((l, i) => text(ui, x + 2, r + 2 + i, l, hot ? u.hi : u.dim, u.panel, u.alpha));
  const acts: Action[] = [];
  if (!dead) acts.push({ id: "park:retire", label: "Retirer", variant: "danger", tip: "Retirer cet animal de la reserve" });
  acts.push({ id: "park:journal", label: "Carnet", tip: "Ouvrir sa fiche dans le carnet" });
  acts.push({ id: "park:follow", label: "Suivre", toggle: true, active: p.follow, variant: "primary", tip: p.follow ? "Ne plus le suivre" : "La camera le suit" });
  actions(ui, th, x + 2, y + H - 2, W - 4, acts);
  return y;
}

// ---------------------------------------------------------------------------
// Fiche d'un nid
// ---------------------------------------------------------------------------

/** Fiche d'un nid (bas gauche). Renvoie sa ligne du haut. */
export function drawNestCard(s: GameState, th: Theme, ui: Frame, n: Nest): number {
  const spec = SPECIES[n.sp];
  if (!spec) return ui.rows - 1;
  const u = th.ui, p = s.park;
  const W = Math.min(52, ui.cols - 2 * SP.margin - 2), x = SP.margin + 1;
  const guard = n.guard ? p.animals.find((a) => a.id === n.guard && a.task !== "dead") : undefined;
  const info = wrap("Comme les oiseaux d'aujourd'hui, beaucoup de dinosaures pondaient dans un nid creusé au sol, et un parent le gardait jusqu'à l'éclosion.", W - 4).slice(0, 3);
  const H = 11 + info.length, y = Math.max(UI_TOP, ui.rows - H - 2);
  panel(ui, th, x, y, W, H, `Nid ${deName(spec.name)}`, { close: "park:close" });
  let r = y + 1;
  const T = (t: string, c: RGB = u.text) => text(ui, x + 2, r++, t, c, u.panel, u.alpha);
  if (n.hatched !== undefined) T("Éclos ! Il ne reste que des coquilles vides.", u.ok);
  else T(`Oeufs : ${n.eggs}`, u.hi);
  const prog = n.hatched !== undefined ? 1 : Math.min(1, n.t / INCUBATION);
  text(ui, x + 2, r, "Incubation", u.text, u.panel, u.alpha);
  bar(ui, th, x + 14, r, 22, prog, prog >= 0.75 ? u.hi : u.ok);
  text(ui, x + 37, r++, `${Math.round(prog * 100)} %`, u.dim, u.panel, u.alpha);
  if (n.hatched === undefined && prog >= 0.75) T("Les coquilles se fendillent : ça bouge dedans !", u.hi);
  else r++;
  if (guard) T(`Gardien : #${guard.id}, il ${activity(guard)}.`.slice(0, W - 4));
  else T("Aucun parent ne le garde : gare aux voleurs d'œufs !", u.dim);
  T(n.fossil ? "Origine : œuf fossile incubé à l'atelier." : "Origine : pondu ici, dans la réserve.", u.dim);
  r++;
  info.forEach((l) => T(l, u.dim));
  if (guard) actions(ui, th, x + 2, y + H - 2, W - 4, [{ id: `park:pick:${guard.id}`, label: "Voir le gardien", variant: "primary" }]);
  return y;
}

// ---------------------------------------------------------------------------
// Recensement
// ---------------------------------------------------------------------------

/** Rectangle du recensement à la dernière image (cellules d'interface), pour la molette. */
let rosterRect: { x: number; y: number; w: number; h: number } | null = null;

/** La souris (px CSS) est-elle au-dessus du recensement ? */
export function rosterOver(px: number, py: number): boolean {
  if (!rosterRect) return false;
  const c = uiCellAt(px, py), r = rosterRect;
  return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
}

type Row =
  | { k: "head"; spec: Species; n: number; nests: number }
  | { k: "animal"; a: Animal; spec: Species }
  | { k: "nest"; n: Nest }
  | { k: "gap" };

/**
 * Recensement : panneau à droite, de la ligne `top` jusqu'à `bottom` (exclue), défilant ; il ne déborde
 * pas à gauche de la colonne `left` (panneau du temps).
 */
export function drawRoster(s: GameState, th: Theme, ui: Frame, top: number, bottom: number, left = 0) {
  const u = th.ui, p = s.park;
  const W = Math.max(40, Math.min(58, ui.cols - left - 2 * SP.margin)), x = ui.cols - W - SP.margin;
  const rows: Row[] = [];
  for (const spec of SPECIES_LIST) {
    if (!s.progress.assembled.includes(spec.id)) continue;
    const list = p.animals.filter((a) => a.sp === spec.id && a.task !== "dead").sort((a, b) => b.life - a.life);
    const nests = p.nests.filter((n) => n.sp === spec.id);
    if (!list.length && !nests.length) continue;
    if (rows.length) rows.push({ k: "gap" });
    rows.push({ k: "head", spec, n: list.length, nests: nests.length });
    for (const a of list) rows.push({ k: "animal", a, spec });
    for (const n of nests) rows.push({ k: "nest", n });
  }
  const avail = bottom - top;
  if (avail < 6) { rosterRect = null; return; }
  const body = Math.max(1, rows.length);
  const H = Math.min(avail, body + 4);
  const view = H - 4; // lignes visibles (titre, légende, bordures)
  const max = Math.max(0, body - view);
  p.rosterScroll = Math.max(0, Math.min(max, p.rosterScroll ?? 0));
  const off = p.rosterScroll;
  // Le fond du panneau avale les clics (sinon ils désélectionneraient l'animal dans le monde) ;
  // posé avant le panneau pour que sa fermeture « [x] » reste prioritaire.
  region("park:roster:bg", x, top, W, H);
  rosterRect = { x, y: top, w: W, h: H };
  panel(ui, th, x, top, W, H, "Recensement", { key: "C", close: "park:roster" });
  text(ui, x + 2, top + 1, "Stade : b bébé  j juvénile  A adulte  V âgé   o nid", u.dim, u.panel, u.alpha);
  if (!rows.length) text(ui, x + 2, top + 2, "Aucun dinosaure dans la réserve.", u.dim, u.panel, u.alpha);
  const inner = W - 5;
  for (let i = 0; i < view && i + off < rows.length; i++) {
    const row = rows[i + off], ry = top + 2 + i;
    if (row.k === "gap") continue;
    if (row.k === "head") {
      const t = `${row.spec.name}  ${row.n}/${MAX_PER_SPECIES}${row.nests ? `   nids : ${row.nests}` : ""}`;
      text(ui, x + 2, ry, t, u.hi, u.panel, u.alpha);
      continue;
    }
    if (row.k === "animal") {
      const a = row.a, st = stageOf(row.spec, a.life);
      const sel = a.id === p.selected, hov = over(x + 1, ry, W - 2, 1);
      const bg = sel || hov ? u.panelAlt : u.panel;
      const fg = sel ? u.hi : u.text;
      for (let k = x + 1; k < x + W - 1; k++) put(ui, k, ry, 32, fg, bg, u.alpha);
      text(ui, x + 2, ry, STAGE_ICON[st], st === "old" ? u.dim : u.hi, bg, u.alpha);
      text(ui, x + 4, ry, `#${a.id}`.padEnd(5) + STAGE_LABEL[st].padEnd(9) + days(a.life).padStart(6), fg, bg, u.alpha);
      const bx = x + 25;
      miniBar(ui, th, bx, ry, 6, a.life / lifespan(row.spec), st === "old" ? u.bad : u.ok, bg);
      const act = a.gestation ? (isFish(SPECIES[a.sp]) ? "va frayer" : "attend un petit") : a.nestId ? "garde son nid" : activity(a);
      const room = inner - (bx + 7 - x) + 2;
      text(ui, bx + 7, ry, act.length > room ? `${act.slice(0, Math.max(0, room - 1))}.` : act, u.dim, bg, u.alpha);
      region(`park:pick:${a.id}`, x + 1, ry, W - 3, 1, { focus: true });
      continue;
    }
    const n = row.n;
    const sel = n.id === p.nestSel, hov = over(x + 1, ry, W - 2, 1);
    const bg = sel || hov ? u.panelAlt : u.panel;
    for (let k = x + 1; k < x + W - 1; k++) put(ui, k, ry, 32, u.text, bg, u.alpha);
    text(ui, x + 2, ry, "o", u.ok, bg, u.alpha);
    const st = n.hatched !== undefined ? "éclos" : `${n.eggs} œuf${n.eggs > 1 ? "s" : ""}, incubation ${Math.round(Math.min(1, n.t / INCUBATION) * 100)} %`;
    text(ui, x + 4, ry, `Nid ${n.fossil ? "(fossile) " : ""}: ${st}`.slice(0, inner), sel ? u.hi : u.text, bg, u.alpha);
    region(`park:nest:${n.id}`, x + 1, ry, W - 3, 1, { focus: true });
  }
  // Ascenseur et aide.
  if (max > 0) {
    const pos = Math.round((off / max) * (view - 1));
    for (let i = 0; i < view; i++) put(ui, x + W - 2, top + 2 + i, i === pos ? 35 : 58, i === pos ? u.hi : u.dim, u.panel, u.alpha);
  }
  text(ui, x + 2, top + H - 2, max > 0 ? "Clic : aller le voir   Molette : défiler" : "Clic : aller le voir", u.dim, u.panel, u.alpha);
}

/** Petite barre sans crochets (recensement). */
function miniBar(ui: Frame, th: Theme, x: number, y: number, w: number, v: number, col: RGB, bg: RGB) {
  const n = Math.round(Math.max(0, Math.min(1, v)) * w);
  for (let i = 0; i < w; i++) put(ui, x + i, y, i < n ? 35 : 46, i < n ? col : th.ui.dim, bg, th.ui.alpha);
}
