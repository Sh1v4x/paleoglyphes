import { CELL_H, CELL_W } from "../config";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { SPECIES, SPECIES_LIST } from "../species";
import type { Species, SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { button, put, text, wrap } from "../ui/kit";
import { BIOME, BIOME_INFO, type BiomeId } from "../world/biomes";

/**
 * Graphique des populations, dans le recensement (onglet « Graphique ») : la réserve relève les effectifs
 * vivants de chaque espèce à intervalle régulier (temps de jeu, donc plus vite en x4 / x16) et le
 * graphique en ASCII montre comment la chaîne alimentaire les fait monter et descendre.
 */

/** Un relevé toutes les 2 h de jeu ; 144 relevés = 12 jours de réserve. */
export const CENSUS_STEP = 1 / 12;
export const CENSUS_MAX = 144;

/** Historique des effectifs (nombres et tableaux simples : sérialisable tel quel avec s.park). */
export interface CensusState {
  /** Instant de chaque relevé (jours de réserve, heure comprise), du plus ancien au plus récent. */
  t: number[];
  /**
   * Effectifs vivants, alignés sur `t`. Clé : id d'espèce ; pour une espèce migratrice, aussi
   * « id@biome » (individus présents dans ce biome), pour voir la migration.
   */
  n: Record<string, number[]>;
  /** Interface : onglet du recensement, vue du graphique, biome et espèce choisis. */
  tab?: "list" | "chart";
  view?: "all" | "biome" | "species";
  biome?: BiomeId;
  sp?: SpeciesId;
  /** Dernier animal sélectionné vu par la vue « Espèce » (elle passe à son espèce quand il change). */
  selSeen?: number;
}

/** Temps de la réserve, en jours (le jour 0 commence au départ). */
const now = (s: GameState) => s.weather.day + s.clock / 24;

export function census(s: GameState): CensusState {
  return (s.park.census ??= { t: [], n: {} });
}

/**
 * Biomes d'une espèce : les siens (Hell Creek et le marais par défaut) ; la mer pour les marins et les
 * ptérosaures, qui volent partout mais pêchent surtout au large.
 */
function biomesOf(spec: Species): readonly BiomeId[] {
  if ((spec.habitat ?? "land") !== "land") return [BIOME.Sea];
  return spec.biomes ?? [BIOME.HellCreek, BIOME.Swamp];
}

/** Relève les effectifs si le pas de temps est écoulé (à appeler à chaque image de la réserve). */
export function sampleCensus(s: GameState) {
  const c = census(s), t = now(s), last = c.t[c.t.length - 1];
  // Un temps qui recule (partie rechargée, horloge remise à zéro) repart d'un historique vide.
  if (last !== undefined && t < last) { c.t = []; c.n = {}; }
  else if (last !== undefined && t - last < CENSUS_STEP) return;
  const count: Record<string, number> = {};
  const w = worldFor(s);
  for (const a of s.park.animals) {
    if (a.task === "dead") continue;
    count[a.sp] = (count[a.sp] ?? 0) + 1;
    if (SPECIES[a.sp]?.migration) {
      const b = w.biome[Math.floor(a.y / CELL_H) * w.cols + Math.floor(a.x / CELL_W)];
      count[`${a.sp}@${b}`] = (count[`${a.sp}@${b}`] ?? 0) + 1;
    }
  }
  const len = c.t.length;
  for (const k of Object.keys(count)) c.n[k] ??= new Array<number>(len).fill(0);
  for (const k of Object.keys(c.n)) c.n[k].push(count[k] ?? 0);
  c.t.push(t);
  if (c.t.length > CENSUS_MAX) {
    c.t.shift();
    for (const k of Object.keys(c.n)) c.n[k].shift();
  }
}

/** Boutons du recensement (onglets, vues, < >). Renvoie true si l'id était le sien. */
export function censusClick(s: GameState, id: string): boolean {
  if (!id.startsWith("park:census:")) return false;
  const c = census(s), a = id.slice(12);
  if (a === "list" || a === "chart") c.tab = a;
  else if (a === "all" || a === "biome" || a === "species") c.view = a;
  else if (a === "prev" || a === "next") {
    const d = a === "next" ? 1 : -1;
    if (c.view === "biome") {
      const bs = Object.values(BIOME);
      c.biome = bs[(bs.indexOf(c.biome ?? BIOME.HellCreek) + d + bs.length) % bs.length];
    } else {
      const list = shownSpecies(s);
      const k = list.findIndex((sp) => sp.id === c.sp);
      c.sp = list[(k + d + list.length) % list.length]?.id;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

interface Series {
  label: string;
  keys: string[];
  glyph: string;
  col: number;
}

/** Couleurs des courbes, lisibles sur le fond des panneaux de chaque style. */
const COLORS: Record<Theme["style"], RGB[]> = {
  dark: [[155, 232, 138], [224, 112, 90], [106, 168, 232], [232, 200, 74], [192, 138, 232], [90, 208, 192], [232, 154, 74], [232, 138, 184], [210, 206, 220], [176, 140, 100]],
  cartoon: [[42, 114, 40], [181, 42, 42], [31, 95, 168], [138, 100, 0], [106, 58, 160], [0, 112, 106], [184, 90, 0], [168, 48, 106], [60, 60, 70], [120, 80, 40]],
};
const GLYPHS = "ox~^*+%@=&";
/** Légende des séries d'un migrateur, par biome. */
const WHERE: Record<BiomeId, string> = {
  [BIOME.HellCreek]: "à Hell Creek", [BIOME.Swamp]: "au marais", [BIOME.Tundra]: "en toundra", [BIOME.Desert]: "au désert", [BIOME.Sea]: "en mer",
};

/** Espèces à proposer : assemblées, ou présentes dans l'historique. */
function shownSpecies(s: GameState): Species[] {
  const n = census(s).n;
  return SPECIES_LIST.filter((sp) => s.progress.assembled.includes(sp.id) || n[sp.id]?.some((v) => v > 0));
}

/** Les séries de la vue courante, et le texte qui l'explique. */
function seriesOf(s: GameState): { title: string; series: Series[]; caption: string } {
  const c = census(s), shown = shownSpecies(s);
  const lv = "Quand les proies abondent, les prédateurs mangent bien et font des petits ; puis les proies se raréfient, les prédateurs ont faim et nichent moins, et les proies se refont. Les courbes se suivent avec du retard : c'est le modèle de Lotka-Volterra.";
  const mig = "L'Édmontosaure migre : l'été polaire, il monte brouter en toundra ; l'hiver, il redescend à Hell Creek et au marais.";
  if (c.view === "biome") {
    const b = c.biome ?? BIOME.HellCreek;
    const here = shown.filter((sp) => biomesOf(sp).includes(b));
    const series = here.map((sp, i) => ({ label: sp.name, keys: [sp.migration ? `${sp.id}@${b}` : sp.id], glyph: GLYPHS[i % GLYPHS.length], col: i }));
    const hunt = here.some((sp) => sp.behavior.prey.some((p) => here.some((h) => h.id === p)));
    const caption = [here.some((sp) => sp.migration) ? mig : "", hunt ? lv : ""].filter(Boolean).join(" ")
      || "Ici, aucune espèce ne chasse les autres : chacune dépend surtout de sa nourriture et de la place.";
    return { title: BIOME_INFO[b].name, series, caption };
  }
  if (c.view === "species") {
    const sel = s.park.animals.find((a) => a.id === s.park.selected);
    if (sel && sel.id !== c.selSeen) c.sp = sel.sp;
    c.selSeen = sel?.id;
    const spec = shown.find((sp) => sp.id === c.sp) ?? shown[0];
    if (!spec) return { title: "Aucune espèce", series: [], caption: "" };
    c.sp = spec.id;
    const series: Series[] = [{ label: spec.name, keys: [spec.id], glyph: "#", col: spec.behavior.diet === "carnivore" ? 1 : 0 }];
    const prey = spec.behavior.prey.filter((p) => shown.some((sp) => sp.id === p));
    const hunters = shown.filter((sp) => sp.behavior.prey.includes(spec.id));
    let caption = "";
    if (prey.length) {
      series.push({ label: "ses proies", keys: prey, glyph: "o", col: 0 });
      caption = `Il chasse : ${prey.map((p) => SPECIES[p]?.name).join(", ")}. Il ne niche que si ses proies sont au moins trois fois plus nombreuses que lui : sa courbe suit la leur, avec du retard.`;
    } else if (hunters.length) {
      series.push({ label: "ses prédateurs", keys: hunters.map((h) => h.id), glyph: "x", col: 1 });
      caption = `Chassé par : ${hunters.map((h) => h.name).join(", ")}. Quand il abonde, ses prédateurs prospèrent... puis le chassent davantage.`;
    }
    if (spec.migration) {
      for (const b of [...spec.migration.summer, ...spec.migration.winter])
        series.push({ label: WHERE[b], keys: [`${spec.id}@${b}`], glyph: GLYPHS[2 + series.length], col: 2 + series.length });
      caption = `${mig} ${caption}`;
    }
    if (!caption) caption = spec.habitat === "sea" ? "Il dépend du plancton de la mer : quand le plancton manque, il ne se reproduit plus."
      : spec.behavior.diet === "carnivore" ? "Il pêche ou chasse des proies qui ne manquent jamais : sa population dépend surtout de la place."
        : "Il niche quand la végétation autour de lui est assez dense : sa courbe suit les plantes.";
    return { title: spec.name, series, caption };
  }
  // Toute la réserve, par place dans la chaîne alimentaire.
  const group = (f: (sp: Species) => boolean) => shown.filter(f).map((sp) => sp.id as string);
  const land = (sp: Species) => (sp.habitat ?? "land") === "land";
  const series = [
    { label: "Herbivores", keys: group((sp) => land(sp) && sp.behavior.diet !== "carnivore"), glyph: "o", col: 0 },
    { label: "Carnivores", keys: group((sp) => land(sp) && sp.behavior.diet === "carnivore"), glyph: "x", col: 1 },
    { label: "Mer", keys: group((sp) => sp.habitat === "sea"), glyph: "~", col: 2 },
    { label: "Ciel", keys: group((sp) => sp.habitat === "air"), glyph: "^", col: 3 },
  ].filter((g) => g.keys.length);
  return { title: "Toute la réserve", series, caption: `Plantes -> herbivores -> carnivores. ${lv}` };
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

const fmtDay = (t: number) => `j${Math.floor(t) + 1}`;

/**
 * Onglet « Graphique » du recensement, dans le panneau (x, y, W, H) déjà dessiné : vues, sélecteur,
 * courbes avec axes (effectifs, jours), légende avec les valeurs actuelles, explication.
 * Sur un petit panneau, l'explication puis la légende raccourcissent avant le graphique.
 */
export function drawCensus(s: GameState, th: Theme, ui: Frame, x: number, y: number, W: number, H: number) {
  const u = th.ui, c = census(s), pal = COLORS[th.style];
  const ix = x + 2, iw = W - 4;
  const T = (cx: number, cy: number, t: string, fg: RGB = u.text) => text(ui, cx, cy, t, fg, u.panel, u.alpha);
  // Vues, puis sélecteur de biome ou d'espèce.
  let bx = ix;
  for (const [id, label] of [["all", "Tout"], ["biome", "Biome"], ["species", "Espèce"]] as const)
    bx += button(ui, th, `park:census:${id}`, bx, y + 2, label, { active: (c.view ?? "all") === id, tip: id === "all" ? "Toute la reserve, par regime" : id === "biome" ? "Les especes d'un biome" : "Une espece (celle de l'animal choisi)" }) + 1;
  const { title, series, caption } = seriesOf(s);
  const pick = c.view === "biome" || c.view === "species";
  if (pick) {
    button(ui, th, "park:census:prev", ix, y + 3, "<", { tip: "Precedent" });
    button(ui, th, "park:census:next", ix + iw - 5, y + 3, ">", { tip: "Suivant" });
  }
  T(ix + Math.max(pick ? 6 : 0, Math.floor((iw - title.length) / 2)), y + 3, title.slice(0, iw - 12), u.hi);

  // Valeurs de chaque série à chaque relevé.
  const len = c.t.length;
  const vals = series.map((se) => Array.from({ length: len }, (_, i) => se.keys.reduce((m, k) => m + (c.n[k]?.[i] ?? 0), 0)));

  // Place : légende (2 colonnes si la largeur le permet), explication, puis le graphique.
  const entries = series.map((se, i) => `${se.glyph} ${se.label} ${vals[i][len - 1] ?? 0}`);
  const lcols = Math.max(1, Math.min(2, Math.floor(iw / (Math.max(0, ...entries.map((e) => e.length)) + 2))));
  const legFull = Math.ceil(entries.length / lcols);
  const cap = wrap(caption, iw);
  const top = y + 4, bottom = y + H - 1; // lignes utiles : [top, bottom)
  const free = bottom - top - 2; // moins l'axe des jours et ses étiquettes
  // Le graphique garde au moins 6 lignes : l'explication cède d'abord, puis la légende.
  const capH = Math.max(0, Math.min(cap.length, free - 6 - legFull));
  const legH = Math.max(1, Math.min(legFull, free - 6 - capH));
  const gh = free - legH - capH; // hauteur du graphique
  if (gh < 3 || !series.length) {
    T(ix, top, !series.length ? "Aucun animal à suivre ici." : "Agrandis la fenêtre pour voir le graphique.", u.dim);
    return;
  }
  // Graphique : étiquettes des effectifs à gauche (3 colonnes), puis l'axe « | ».
  const gx = ix + 4, gw = iw - 4, gy = top + gh - 1; // gy : ligne du zéro
  const maxV = Math.max(4, ...vals.flat());
  const rowOf = (v: number) => Math.round((v / maxV) * (gh - 1));
  T(ix, top, String(maxV).padStart(3), u.dim);
  if (gh >= 5) T(ix, top + Math.round((gh - 1) / 2), String(Math.round(maxV / 2)).padStart(3), u.dim);
  T(ix, gy, "  0", u.dim);
  for (let j = 0; j < gh; j++) put(ui, gx - 1, top + j, 124, u.border, u.panel, u.alpha);
  // Temps : une colonne = un relevé, tant que l'historique tient ; ensuite il se resserre.
  const tEnd = len ? c.t[len - 1] : now(s);
  const span = Math.max(gw * CENSUS_STEP, len ? tEnd - c.t[0] : 0);
  const t0 = tEnd - span;
  const colT = (k: number) => t0 + ((k + 1) / gw) * span;
  // Axe des jours : « + » à chaque minuit, étiquette dessous si elle a la place.
  let lastLabel = -99;
  for (let k = 0; k < gw; k++) {
    const day = k > 0 && len > 0 && colT(k - 1) >= c.t[0] && Math.floor(colT(k)) !== Math.floor(colT(k - 1));
    put(ui, gx + k, gy + 1, day ? 43 : 45, u.border, u.panel, u.alpha);
    if (day && k - lastLabel > 4 && k + 3 <= gw) { T(gx + k, gy + 2, fmtDay(colT(k)), u.dim); lastLabel = k; }
  }
  put(ui, gx - 1, gy + 1, 43, u.border, u.panel, u.alpha);
  if (!len) T(gx + 1, top, "Premier releve dans un instant...", u.dim);
  // Courbes : une ligne par série (glyphe + couleur), la dernière par-dessus ; une seule série : aire remplie.
  const area = series.length === 1 || c.view === "species";
  series.forEach((se, si) => {
    let i = 0, prev = -1;
    for (let k = 0; k < gw; k++) {
      const tk = colT(k);
      while (i + 1 < len && c.t[i + 1] <= tk + 1e-9) i++;
      if (!len || c.t[i] > tk + 1e-9) { prev = -1; continue; }
      const r = rowOf(vals[si][i]), col = pal[se.col % pal.length];
      // Beaucoup de courbes : les absents ne surchargent pas la ligne du zéro.
      if (r === 0 && series.length > 4) { prev = -1; continue; }
      if (area && si === 0) for (let j = 0; j < r; j++) put(ui, gx + k, gy - j, 46, col, u.panel, u.alpha);
      // Trait vertical quand la courbe saute de plusieurs lignes d'une colonne à l'autre.
      if (prev >= 0) for (let j = Math.min(prev, r) + 1; j < Math.max(prev, r); j++) put(ui, gx + k, gy - j, se.glyph.charCodeAt(0), col, u.panel, u.alpha);
      put(ui, gx + k, gy - r, se.glyph.charCodeAt(0), col, u.panel, u.alpha);
      prev = r;
    }
  });
  // Légende : glyphe et nom dans la couleur de la courbe, valeur actuelle.
  const ly = gy + 3, cw = Math.floor(iw / lcols);
  entries.slice(0, legH * lcols).forEach((e, i) => {
    const lx = ix + (i % lcols) * cw, lyy = ly + Math.floor(i / lcols);
    T(lx, lyy, e.slice(0, cw - 1), pal[series[i].col % pal.length]);
  });
  // Explication coupée faute de place : « ... » au bout.
  cap.slice(0, capH).forEach((l, i) => T(ix, ly + legH + i, i === capH - 1 && capH < cap.length ? `${l.slice(0, iw - 3)}...` : l, u.dim));
}
