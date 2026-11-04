import { CELL_H, CELL_W, UI_CELL_H, UI_CELL_W } from "../config";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { discovered, shownName, SPECIES_LIST } from "../species";
import type { Species } from "../species/types";
import { worldFor, type GameState } from "../state";
import { actions, button, buttonW, clip, panel, put, SP, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { BIOME, BIOME_INFO, type BiomeId } from "../world/biomes";
import type { World } from "../world/generate";
import { T } from "../world/tiles";
import { isFisher } from "./eco-special";
import { mixRgb } from "../math";
import { drawLines, type Line } from "./journal-common";
import { UI_TOP } from "./types";
import { zoomLevel } from "./park";

/**
 * Carnet de voyage : une page par biome de la réserve. Le vrai site fossilifère qu'il représente, son
 * climat d'alors et d'aujourd'hui, ses fossiles, sa végétation Lenia, et une mini-carte du biome tirée
 * du vrai monde (terrain, eau, roche, arbres) avec les animaux de la réserve qui y vivent.
 * Une page s'ouvre à la première visite du biome dans la réserve (biome au centre de la caméra).
 */

export interface TravelState {
  biome: BiomeId;
  /** Défilement du texte (lignes). */
  scroll: number;
}

export function createTravelState(): TravelState {
  return { biome: BIOME.HellCreek, scroll: 0 };
}

/** Ordre des pages : du centre (point de départ) vers les bords. */
const PAGES: BiomeId[] = [BIOME.HellCreek, BIOME.Swamp, BIOME.Tundra, BIOME.Desert, BIOME.Sea];
const SHORT: Record<BiomeId, string> = {
  [BIOME.HellCreek]: "Hell Creek", [BIOME.Swamp]: "Marais", [BIOME.Tundra]: "Toundra", [BIOME.Desert]: "Gobi", [BIOME.Sea]: "Mer",
};

interface PageText {
  /** Où le trouver dans la réserve (page encore fermée). */
  where: string;
  site: string;
  then: string;
  now: string;
  fossils: string;
  life: string;
}

const TEXT: Record<BiomeId, PageText> = {
  [BIOME.HellCreek]: {
    where: "au centre de la réserve, autour du point de départ",
    site: "Dans l'est du Montana (États-Unis), des collines nues et ravinées, les « badlands », montrent des couches de roche déposées par des rivières il y a 68 à 66 millions d'années. C'est l'un des sites les plus célèbres pour les tout derniers dinosaures : en haut de la formation, une fine couche d'argile garde la trace de l'astéroïde qui a mis fin à leur règne.",
    then: "Alors : une grande plaine traversée de rivières, pas très loin d'une mer intérieure. Un climat doux à chaud et humide, sans hiver glacial. Les feuilles fossiles et les cernes du bois font penser à des saisons plus humides et d'autres plus sèches.",
    now: "Aujourd'hui : un climat sec, des étés chauds et des hivers très froids et enneigés. Il y pousse surtout de l'herbe et des buissons... alors que les prairies d'herbe n'existaient pas encore au temps des dinosaures !",
    fossils: "Les crues recouvraient vite les carcasses de sable et de boue : à l'abri de l'air, les os ont pu devenir des fossiles. On y trouve le T. rex, le Tricératops, l'Edmontosaure, l'Ankylosaure, le Pachycéphalosaure, mais aussi des tortues, des crocodiles, de petits mammifères, des poissons et des feuilles. Chaque orage creuse un peu plus les badlands : de nouveaux os apparaissent tous les ans.",
    life: "Les fougères du sol suivent Lenia, une règle de calcul : chaque petite case de plante regarde ses voisines. S'il y en a « juste assez », elle pousse ; trop seule ou trop serrée, elle fane. De cette règle toute simple naissent des taches et des bandes de fougères. Quand un herbivore broute, la trouée se referme peu à peu par les bords ; la pluie fait s'étendre les fougères, la sécheresse les fait reculer.",
  },
  [BIOME.Swamp]: {
    where: "au sud de la réserve, près de la côte",
    site: "Laramidia, c'était l'île-continent à l'ouest de la mer intérieure : l'ouest de l'Amérique du Nord d'aujourd'hui. Le long de sa côte s'étendaient des marais, des lagunes et des deltas, dont on retrouve les traces de l'Alberta (Canada) jusqu'au Nouveau-Mexique.",
    then: "Alors : chaud et très humide, de l'eau partout, des arbres cousins des cyprès chauves les pieds dans la vase. Les plantes mortes s'entassaient sans pourrir complètement dans cette eau pauvre en oxygène : en des millions d'années, elles sont devenues du charbon.",
    now: "Aujourd'hui : ces régions sont loin de toute mer, au milieu de grandes plaines sèches et de champs. Il faut imaginer la côte à des centaines de kilomètres de là où elle est maintenant.",
    fossils: "La vase sans oxygène protège bien les restes : feuilles, graines, pollen, ambre, tortues, crocodiles, poissons, et os de dinosaures venus boire ou traverser. Les couches de charbon (le lignite) sont elles-mêmes d'anciens marais devenus roche.",
    life: "Lenia y fait pousser des tapis presque continus, jusque sur l'eau calme, comme des lentilles d'eau : de toutes petites plantes qui flottent. On pense que des plantes flottantes de cette famille vivaient déjà dans les mares de cette époque (on en a trouvé des fossiles au Canada). Ces tapis repoussent vite après le passage d'un troupeau.",
  },
  [BIOME.Tundra]: {
    where: "tout au nord de la réserve, vers les montagnes",
    site: "Au nord de l'Alaska, les falaises de la rivière Colville (formation de Prince Creek) gardent des os de dinosaures vieux d'environ 70 millions d'années. Ce lieu était alors encore plus près du pôle Nord qu'aujourd'hui : ce sont les dinosaures les plus au nord que l'on connaisse.",
    then: "Alors : frais plutôt que glacial (environ 5 degrés en moyenne sur l'année, d'après les plantes fossiles). Des forêts de conifères et d'arbres à feuilles, des rivières et des marais. Mais une longue nuit polaire : des mois sans soleil en hiver, et des mois de jour sans fin en été. Il pouvait geler et neiger un peu, mais les grands froids étaient rares.",
    now: "Aujourd'hui : la toundra arctique, sans arbres, sur un sol gelé toute l'année (le pergélisol), avec des hivers à -30 degrés. Le Crétacé était bien plus chaud que notre époque. Dans la réserve, ce biome est plus enneigé qu'il ne l'était vraiment, pour bien le distinguer des forêts du sud.",
    fossils: "Les os viennent souvent de jeunes animaux, regroupés en « lits d'os » : sans doute des troupeaux emportés par des crues. On y a trouvé le Pachyrhinosaure, le Nanuqsaure (un petit cousin du T. rex), des hadrosaures, et même de minuscules os de bébés et des morceaux de coquilles d'œufs. Migraient-ils vers le sud pour l'hiver, ou restaient-ils toute l'année ? Les scientifiques en débattent ; ces bébés font pencher pour des résidents, au moins pour certaines espèces.",
    life: "Ici, Lenia fait pousser des lichens : de petites taches éparses qui « respirent » lentement sur la neige. Un lichen, c'est un champignon et une algue qui vivent ensemble ; il en existait déjà bien avant les dinosaures. Ils poussent lentement : un troupeau affamé met longtemps à les retrouver.",
  },
  [BIOME.Desert]: {
    where: "au sud-ouest de la réserve",
    site: "En Mongolie, les falaises rouges de Bayanzag, les « Falaises flamboyantes », appartiennent à la formation de Djadochta, vieille d'environ 75 millions d'années. C'est là que l'expédition de Roy Chapman Andrews a découvert, en 1923, les premiers œufs reconnus comme des œufs de dinosaures. En vrai, ce désert est en Asie, loin de l'Amérique : la réserve le pose à côté des autres.",
    then: "Alors : un désert de dunes de sable, chaud et sec, avec çà et là des points d'eau et des oasis. Les pluies étaient rares, peut-être seulement à certaines saisons.",
    now: "Aujourd'hui : toujours un désert, mais glacial en hiver (souvent -20 degrés ou moins) et brûlant en été. Le vent et le gel usent les falaises et font sortir les fossiles.",
    fossils: "Des squelettes souvent complets, parfois figés en pleine action : un Vélociraptor et un Protocératops morts en plein combat, des Citipati couchés sur leurs œufs. Ils ont dû être ensevelis d'un seul coup. Par une tempête de sable, ou par une dune gorgée d'eau qui s'effondre après une pluie ? C'est encore une hypothèse.",
    life: "Lenia y dessine une croûte du désert : de petites taches de cyanobactéries, de lichens et de mousses qui collent les grains de sable entre eux et retiennent un peu d'eau. Les cyanobactéries existent depuis des milliards d'années : on suppose qu'elles couvraient déjà ces sols. Autour des oasis, ce sont des fougères.",
  },
  [BIOME.Sea]: {
    where: "à l'est de la réserve, au-delà de la plage",
    site: "Pendant des dizaines de millions d'années, une mer peu profonde a coupé l'Amérique du Nord en deux, du golfe du Mexique jusqu'à l'océan Arctique : la Voie maritime intérieure de l'Ouest. À l'ouest, l'île de Laramidia (avec Hell Creek) ; à l'est, Appalachia.",
    then: "Alors : une mer chaude, profonde de quelques centaines de mètres au plus, pleine de vie : mosasaures, tortues géantes, grands poissons, ammonites, requins, et des ptérosaures qui pêchaient au-dessus des vagues.",
    now: "Aujourd'hui : à sa place s'étendent les Grandes Plaines (Kansas, Dakota), des champs de blé et des prairies à plus de mille kilomètres de la mer. On y ramasse des dents de requins au milieu des champs !",
    fossils: "La craie du Kansas (Niobrara) est faite de milliards de minuscules plaques de plancton tombées au fond. Là, l'eau calme et pauvre en oxygène a protégé les squelettes : mosasaures, Xiphactinus (l'un d'eux avait encore un poisson de 2 m dans le ventre), Ptéranodons, et l'Archélon dans les schistes de Pierre (Dakota du Sud).",
    life: "Le plancton de la réserve est une « créature » de Lenia appelée Orbium : une petite nuée qui avance toute seule, simplement parce que chaque case suit la même règle. Ce n'est pas un vrai être vivant : le vrai plancton est fait d'algues et de petites bêtes qui dérivent. Mais comme lui, il nourrit la mer : poissons et tortues se rassemblent sur les nuées, et les chasseurs les y suivent.",
  },
};

/** Biomes où vit une espèce (les nageurs et les ptérosaures pêcheurs : la mer). */
function homes(sp: Species): readonly BiomeId[] {
  if (sp.biomes) return sp.biomes;
  if (sp.habitat === "sea" || isFisher(sp.id)) return [BIOME.Sea];
  return [BIOME.HellCreek, BIOME.Swamp];
}

// ---------------------------------------------------------------------------
// Visites
// ---------------------------------------------------------------------------

/** Note le biome au centre de la caméra de la réserve (calculé par la météo) ; une nouvelle page s'ouvre. */
export function recordVisit(s: GameState) {
  // Visiter, c'est regarder de près : la vue carte (dézoom) ne débloque pas de page.
  if (zoomLevel(s).m > 1) return;
  const b = s.weather.viewBiome as BiomeId;
  const seen = (s.progress.biomes ??= []);
  if (seen.includes(b) || !BIOME_INFO[b]) return;
  seen.push(b);
  saveProgress(s.progress);
  toast(s, "Nouvelle page au carnet de voyage !", BIOME_INFO[b].name);
}

// ---------------------------------------------------------------------------
// Mini-carte
// ---------------------------------------------------------------------------

/** Sortes de case de la mini-carte : glyphe, encre, fond, légende. */
interface Cls { ch: string; fg: RGB; bg: RGB; label: string }
const CLS: Cls[] = [
  { ch: "~", fg: [96, 150, 210], bg: [28, 66, 116], label: "eau profonde" },
  { ch: "~", fg: [170, 210, 240], bg: [56, 112, 160], label: "eau peu profonde" },
  { ch: "^", fg: [210, 205, 198], bg: [92, 88, 86], label: "roche" },
  { ch: ".", fg: [140, 155, 178], bg: [226, 232, 240], label: "neige" },
  { ch: ".", fg: [150, 112, 56], bg: [214, 180, 112], label: "sable" },
  { ch: ",", fg: [160, 168, 100], bg: [88, 94, 58], label: "vase" },
  { ch: "\"", fg: [150, 200, 110], bg: [74, 124, 56], label: "fougeres" },
  { ch: ".", fg: [196, 166, 124], bg: [136, 104, 70], label: "terre" },
  { ch: "*", fg: [130, 200, 120], bg: [36, 80, 42], label: "arbres" },
];
const C_TREE = 8;
const TERRAIN_CLS: Record<number, number> = {
  [T.Deep]: 0, [T.Shallow]: 1, [T.Rock]: 2, [T.Snow]: 3, [T.Sand]: 4, [T.Mud]: 5, [T.Grass]: 6, [T.Dirt]: 7,
};

interface MiniMap {
  /** Taille utile (cases d'interface) et décalage dans la zone demandée. */
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** Coin haut gauche (px monde) et px monde par case d'interface. */
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  /** Sorte de chaque case (indice dans CLS), -1 hors du biome. */
  cls: Int8Array;
  /** Sortes présentes (pour la légende). */
  used: number[];
}

/** Emprise de chaque biome (cellules monde), mesurée une fois par monde. */
const extents = new WeakMap<World, Map<BiomeId, [number, number, number, number]>>();
function extent(w: World, b: BiomeId): [number, number, number, number] {
  let m = extents.get(w);
  if (!m) {
    m = new Map();
    // Balayage d'une cellule sur 4 : largement assez précis pour une carte réduite.
    for (let y = 0; y < w.rows; y += 4) for (let x = 0; x < w.cols; x += 4) {
      const k = w.biome[y * w.cols + x] as BiomeId;
      const e = m.get(k);
      if (!e) m.set(k, [x, y, x, y]);
      else { e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.max(e[2], x); e[3] = Math.max(e[3], y); }
    }
    extents.set(w, m);
  }
  return m.get(b) ?? [0, 0, w.cols - 1, w.rows - 1];
}

const maps = new WeakMap<World, Map<string, MiniMap>>();
/**
 * Réduit le biome dans un rectangle de W × H cases d'interface, à peu près dans ses proportions. Chaque case
 * prend la sorte de terrain la plus fréquente parmi 4 × 4 points tirés dans son emprise ; les arbres
 * (cellules décor appartenant à un arbre) l'emportent s'ils en couvrent assez. Calculé une fois par taille.
 */
function miniMap(w: World, b: BiomeId, W: number, H: number): MiniMap {
  let cache = maps.get(w);
  if (!cache) { cache = new Map(); maps.set(w, cache); }
  const key = `${b}|${W}|${H}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c0, r0, c1, r1] = extent(w, b);
  const bw = (c1 - c0 + 4) * CELL_W, bh = (r1 - r0 + 4) * CELL_H;
  const kx = bw / (W * UI_CELL_W), ky = bh / (H * UI_CELL_H), k = Math.max(kx, ky);
  // Un biome en longue bande (la toundra, la mer) est étiré jusqu'à 2 fois dans l'autre sens pour remplir le cadre.
  const sx = Math.max(kx, k / 2) * UI_CELL_W, sy = Math.max(ky, k / 2) * UI_CELL_H;
  const mw = Math.max(1, Math.min(W, Math.ceil(bw / sx))), mh = Math.max(1, Math.min(H, Math.ceil(bh / sy)));
  const x0 = c0 * CELL_W, y0 = r0 * CELL_H;
  const cls = new Int8Array(mw * mh).fill(-1);
  const used = new Set<number>();
  const N = 4;
  const count = new Int32Array(CLS.length);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    count.fill(0);
    let inside = 0, trees = 0;
    for (let a = 0; a < N; a++) for (let c = 0; c < N; c++) {
      const cx = Math.floor((x0 + (i + (c + 0.5) / N) * sx) / CELL_W), cy = Math.floor((y0 + (j + (a + 0.5) / N) * sy) / CELL_H);
      if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) continue;
      const ci = cy * w.cols + cx;
      if (w.biome[ci] !== b) continue;
      inside++;
      count[TERRAIN_CLS[w.terrain[ci]] ?? 7]++;
      if (w.decorOwner[ci] >= 0) trees++;
    }
    if (inside * 2 < N * N) continue;
    let best = 0;
    for (let q = 1; q < count.length; q++) if (count[q] > count[best]) best = q;
    if (best > 1 && trees * 4 >= inside) best = C_TREE;
    cls[j * mw + i] = best;
    used.add(best);
  }
  const m: MiniMap = { w: mw, h: mh, ox: Math.floor((W - mw) / 2), oy: Math.floor((H - mh) / 2), x0, y0, sx, sy, cls, used: [...used].sort((a, b2) => a - b2) };
  cache.set(key, m);
  return m;
}

/** Repère d'une espèce sur la carte : A, B, C... dans l'ordre de la liste. */
const mark = (i: number) => String.fromCharCode(65 + (i % 26));

/** Carte du biome (fantôme si la page est encore fermée) et repères des animaux vivants qui s'y trouvent. */
function drawMap(s: GameState, th: Theme, ui: Frame, b: BiomeId, x: number, y: number, W: number, H: number, open: boolean, list: Species[]): number[] {
  const u = th.ui, w = worldFor(s);
  const m = miniMap(w, b, W, H);
  const other = mixRgb(u.panel, u.panelAlt, 0.6);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const c = m.cls[j * m.w + i];
    if (c < 0) put(ui, x + m.ox + i, y + m.oy + j, 32, other, other, u.alpha);
    else if (!open) put(ui, x + m.ox + i, y + m.oy + j, 58, u.dim, u.panelAlt, 1);
    else { const k = CLS[c]; put(ui, x + m.ox + i, y + m.oy + j, k.ch.charCodeAt(0), k.fg, k.bg, 1); }
  }
  const counts = list.map(() => 0);
  if (!open) return counts;
  const known = new Set(discovered(s.progress).map((sp) => sp.id));
  for (const a of s.park.animals) {
    if (a.task === "dead") continue;
    const cx = Math.floor(a.x / CELL_W), cy = Math.floor(a.y / CELL_H);
    if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows || w.biome[cy * w.cols + cx] !== b) continue;
    const i = Math.floor((a.x - m.x0) / m.sx), j = Math.floor((a.y - m.y0) / m.sy);
    if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
    const k = list.findIndex((sp) => sp.id === a.sp);
    if (k >= 0) counts[k]++;
    // De passage (proie qui fuit, chasseur, oiseau) : repère « + » s'il ne vit pas ici.
    const ch = k < 0 ? "+" : known.has(a.sp) ? mark(k) : "?";
    put(ui, x + m.ox + i, y + m.oy + j, ch.charCodeAt(0), u.panel, u.hi, 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function travelPage(s: GameState, th: Theme, world: Frame, ui: Frame) {
  void world;
  const u = th.ui, t = s.journal.travel, b = t.biome;
  const visited = s.progress.biomes ?? [];
  const open = visited.includes(b);
  const info = BIOME_INFO[b];

  // --- Choix du biome (haut) ---
  // Noms courts si les noms complets ne tiennent pas sur la ligne.
  const full = PAGES.reduce<number>((w, pb) => w + buttonW(BIOME_INFO[pb].name) + SP.gap, 2) < ui.cols - 2;
  let bx = 2;
  for (const pb of PAGES) {
    const o = visited.includes(pb);
    bx += button(ui, th, `journal:tv:${pb}`, bx, UI_TOP, full ? BIOME_INFO[pb].name : SHORT[pb],
      { active: pb === b, variant: o ? "secondary" : "ghost", tip: o ? BIOME_INFO[pb].site : "Biome pas encore visite : page fermee" }) + SP.gap;
  }
  const n = `Pages ${visited.length}/${PAGES.length}`;
  if (bx + n.length + 2 < ui.cols) text(ui, ui.cols - n.length - 2, UI_TOP, n, u.dim);

  const top = UI_TOP + 2, bottom = ui.rows - 3, H = bottom - top;
  const L = Math.max(36, Math.floor(ui.cols * 0.5));

  // --- Carte et légende (gauche) ---
  const list = SPECIES_LIST.filter((sp) => homes(sp).includes(b));
  const known = new Set(discovered(s.progress).map((sp) => sp.id));
  const lw = L - 5;
  // Sous la carte : la légende du terrain (pastilles placées d'avance, sorte présentes dans le biome),
  // puis les espèces sur deux colonnes.
  const keys: { c: number; x: number; row: number }[] = [];
  if (open) {
    let lx = 0, row = 0;
    for (const c of miniMap(worldFor(s), b, lw, H).used) {
      const cw = CLS[c].label.length + 5;
      if (lx > 0 && lx + cw - 3 > lw) { lx = 0; row++; }
      keys.push({ c, x: lx, row });
      lx += cw;
    }
  }
  const terrRows = keys.length ? keys[keys.length - 1].row + 1 : 0;
  const half = Math.floor((lw - 1) / 2);
  const spRows = open ? Math.ceil(list.length / 2) : 0;
  const legH = open ? terrRows + 1 + spRows + (list.length ? 1 : 0) : 2;
  const mapH = Math.max(4, H - 3 - legH);
  panel(ui, th, 1, top, L - 1, H, open ? `Carte : ${info.name}` : "Carte : ???");
  const counts = drawMap(s, th, ui, b, 3, top + 1, lw, mapH, open, list);
  let ly = top + 2 + mapH;
  if (!open) {
    text(ui, 3, ly, clip("Carte a decouvrir : va voir ce biome dans la reserve.", lw), u.dim);
  } else {
    for (const { c, x, row } of keys) {
      const k = CLS[c];
      put(ui, 3 + x, ly + row, k.ch.charCodeAt(0), k.fg, k.bg, 1);
      text(ui, 5 + x, ly + row, k.label, u.dim);
    }
    ly += terrRows + 1;
    if (list.length) text(ui, 3, ly++, clip("Animaux (lettres sur la carte, + : de passage) :", lw), u.text);
    list.forEach((sp, i) => {
      const xx = 3 + (i % 2) * (half + 1), yy = ly + Math.floor(i / 2);
      if (!known.has(sp.id)) { text(ui, xx, yy, "? ??? (os a trouver)", u.dim); return; }
      const mig = sp.migration ? (sp.migration.summer.includes(b) ? " (l'ete)" : " (l'hiver)") : "";
      const lab = `${mark(i)} ${shownName(s.progress, sp.id)}${mig}${counts[i] ? ` x${counts[i]}` : ""}`;
      put(ui, xx, yy, mark(i).charCodeAt(0), u.panel, u.hi, 1);
      text(ui, xx + 1, yy, clip(lab.slice(1), half - 2), counts[i] ? u.text : u.dim);
    });
  }

  // --- Texte (droite) ---
  const px = L + 1, pw = ui.cols - px - 1;
  panel(ui, th, px, top, pw, H, open ? "Carnet de voyage" : "Page fermee");
  const tw = pw - 4;
  const lines: Line[] = [];
  const add = (s2: string, c: RGB) => wrap(s2, tw).forEach((l) => lines.push({ t: l, c }));
  const gap = () => lines.push({ t: "", c: u.text });
  const body = u.dim === u.text ? u.text : mixRgb(u.text, u.dim, 0.35);
  const P = TEXT[b];
  if (!open) {
    add(info.name, u.hi);
    gap();
    add(`Cette page s'ouvrira quand tu auras visité ce biome dans la réserve : il se trouve ${P.where}.`, u.text);
    gap();
    add("Déplace la caméra de la réserve jusqu'à lui (flèches ou glisser ; la carte de la touche M aide à s'orienter).", u.dim);
  } else {
    add(info.name, u.hi);
    add(`${info.site}, ${info.age}`, u.dim);
    gap();
    add(P.site, body);
    gap();
    add("Le climat, alors et aujourd'hui", u.hi);
    add(P.then, body);
    add(P.now, body);
    gap();
    add("Les fossiles", u.hi);
    add(P.fossils, body);
    gap();
    add("La vie Lenia de ce biome", u.hi);
    add(P.life, body);
    const migr = list.filter((sp) => sp.migration && known.has(sp.id));
    if (migr.length) {
      gap();
      add("Migrateurs", u.hi);
      for (const sp of migr) {
        const here = sp.migration!.summer.includes(b);
        add(`${shownName(s.progress, sp.id)} : ${here ? "le troupeau monte ici pour l'été polaire, puis redescend vers les forêts et les marais du sud pour l'hiver." : "le troupeau passe l'hiver ici, puis remonte vers l'Alaska pour l'été polaire."} Il figure donc sur les deux pages.`, body);
      }
    }
    gap();
    add("La réserve rassemble des lieux et des époques différents : en vrai, ces animaux ne se sont pas tous croisés.", u.dim);
  }
  drawLines(ui, th, t, lines, px + 2, top + 1, H - 2, tw);

  actions(ui, th, 2, ui.rows - 2, ui.cols - 4, [
    { id: "journal:tv:prev", label: "< Precedent", key: "<-", tip: "Biome precedent (fleche gauche)" },
    { id: "journal:tv:next", label: "Suivant >", key: "->", variant: "primary", tip: "Biome suivant (fleche droite)" },
  ]);
}

function stepPage(t: TravelState, dir: number) {
  const k = PAGES.indexOf(t.biome);
  t.biome = PAGES[(k + dir + PAGES.length) % PAGES.length];
  t.scroll = 0;
}

export function travelUpdate(s: GameState, input: Input) {
  const t = s.journal.travel;
  for (const id of input.ui) {
    if (id === "journal:tv:prev") stepPage(t, -1);
    else if (id === "journal:tv:next") stepPage(t, 1);
    else if (id.startsWith("journal:tv:")) { t.biome = Number(id.slice(11)) as BiomeId; t.scroll = 0; }
  }
  if (input.mouse.wheel) t.scroll += Math.sign(input.mouse.wheel) * 3;
  for (const k of input.pressed) {
    if (k === "ArrowLeft") stepPage(t, -1);
    else if (k === "ArrowRight") stepPage(t, 1);
    else if (k === "ArrowUp") t.scroll -= 2;
    else if (k === "ArrowDown") t.scroll += 2;
  }
  t.scroll = Math.max(0, t.scroll);
}
