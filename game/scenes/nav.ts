import { CELL_H, CELL_W, WORLD_H, WORLD_W } from "../config";
import { SPECIES } from "../species";
import type { SpeciesId } from "../species/types";
import type { World } from "../world/generate";
import { T } from "../world/tiles";
import { onTerrainChange } from "../world/trees";

/**
 * Navigation de la réserve : une grille grossière (NAV px par case) où chaque espèce a sa carte
 * des cases praticables (son corps tient-il debout au centre de la case ?), puis des chemins A*
 * lissés par visibilité directe. Le corps d'un dinosaure vu de profil est long à l'horizontale :
 * l'emprise est un segment horizontal de la longueur du tronc, au niveau des pattes.
 */

export const NAV = 16;
const GW = Math.ceil(WORLD_W / NAV), GH = Math.ceil(WORLD_H / NAV);
/** Demi-longueur de l'emprise au sol, en fraction de `halfLen` (tête et queue débordent un peu). */
export const FOOT = 0.72;
/** Part centrale de l'emprise qui ne peut pas être au-dessus de l'eau profonde. */
const WET = 0.45;

/** Espèces assez massives pour renverser les arbres : les troncs ne les arrêtent pas. */
export const BREAKERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["trex", "allosaurus", "alamosaurus"]);
/**
 * Plafond de la demi-emprise au sol (px) : un sauropode de 780 px ne trouverait aucune place libre
 * sur toute sa longueur ; on ne teste que le tronc et les pattes (les arbres tombent de toute façon).
 */
const FOOT_MAX = 180;
/** Bande de terre (px) le long de la côte où la tortue de mer (Archelon) peut ramper pour pondre. */
export const BEACH = 250;

/** Demi-emprise au sol de l'espèce (px). */
export const footOf = (sp: SpeciesId) => { const spec = SPECIES[sp]; return spec ? Math.min(spec.halfLen * FOOT, FOOT_MAX) : 20; };

const coasts = new WeakMap<World, Float32Array>();
/**
 * Abscisse de la côte (px) à la hauteur y : début de l'eau continue jusqu'au bord est du monde.
 * Calculée une fois par monde (chaque ligne balayée depuis l'est).
 */
export function coastAt(w: World, y: number): number {
  let c = coasts.get(w);
  if (!c) {
    c = new Float32Array(w.rows);
    for (let r = 0; r < w.rows; r++) {
      let x = w.cols - 1;
      while (x > 0 && (w.terrain[r * w.cols + x] === T.Shallow || w.terrain[r * w.cols + x] === T.Deep)) x--;
      c[r] = (x + 1) * CELL_W;
    }
    coasts.set(w, c);
  }
  return c[Math.max(0, Math.min(w.rows - 1, Math.floor(y / CELL_H)))];
}

/** Nageur : tout le corps en eau profonde, avec une marge au-dessus et au-dessous (pas d'échouage). */
export function deepSea(w: World, sp: SpeciesId, x: number, y: number): boolean {
  const half = footOf(sp);
  if (x < half + 10 || x > WORLD_W - half - 10 || y < 100 || y > WORLD_H - 20) return false;
  for (let dy = -CELL_H * 2; dy <= CELL_H * 2; dy += CELL_H * 2) {
    const row = Math.floor((y + dy) / CELL_H) * w.cols;
    for (let lx = -half; lx <= half; lx += CELL_W * 3) if (w.terrain[row + Math.floor((x + lx) / CELL_W)] !== T.Deep) return false;
  }
  return true;
}

/** L'espèce tient-elle debout à (x, y) ? Pas d'eau profonde ni d'obstacle (tronc, rocher) sous le corps. */
export function standable(w: World, sp: SpeciesId, x: number, y: number): boolean {
  const breaks = BREAKERS.has(sp);
  const spec = SPECIES[sp];
  const half = footOf(sp);
  if (spec?.habitat === "sea") {
    // La tortue de mer rampe aussi sur la plage (ponte) : eau ou terre sans obstacle près de la côte.
    if (sp === "archelon" && y > 100 && y < WORLD_H - 20) {
      const c = coastAt(w, y);
      if (x > c - BEACH && x < c + 200) {
        const row = Math.floor(y / CELL_H) * w.cols;
        for (let lx = -half; lx <= half; lx += CELL_W * 1.5) if (w.solid[row + Math.floor((x + lx) / CELL_W)]) return false;
        return x < WORLD_W - half - 10;
      }
    }
    return deepSea(w, sp, x, y);
  }
  if (x < half + 10 || x > WORLD_W - half - 10 || y < 80 || y > WORLD_H - 6) return false;
  const row = Math.floor(y / CELL_H) * w.cols;
  // Troncs et rochers bloquent sur toute la longueur du corps ; l'eau profonde seulement sous le
  // tronc et les pattes (tête et queue peuvent dépasser au-dessus de l'eau : on passe les gués).
  const legs = half * WET;
  for (let lx = -half; lx <= half; lx += CELL_W * 1.5) {
    const i = row + Math.floor((x + lx) / CELL_W);
    if ((w.solid[i] && !(breaks && w.solidOwner[i] >= 0)) || (w.terrain[i] === T.Deep && lx >= -legs && lx <= legs)) return false;
  }
  return true;
}

interface Grid {
  ok: Uint8Array;
}

const grids = new WeakMap<World, Map<SpeciesId, Grid>>();

/** Carte des cases praticables pour une espèce (calculée une fois par monde). */
function grid(w: World, sp: SpeciesId): Grid {
  let m = grids.get(w);
  if (!m) grids.set(w, (m = new Map()));
  let g = m.get(sp);
  if (!g) {
    const ok = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) ok[j * GW + i] = cellFree(w, sp, i, j);
    g = { ok };
    m.set(sp, g);
  }
  return g;
}

/**
 * Une case n'est praticable que si le corps tient sur toutes les lignes qu'elle couvre :
 * un pied de tronc (2 lignes de 7 px) ne doit pas passer entre deux lignes testées.
 */
function cellFree(w: World, sp: SpeciesId, i: number, j: number): 0 | 1 {
  const x = (i + 0.5) * NAV;
  for (let y = j * NAV + 1; y < (j + 1) * NAV; y += CELL_H - 1) if (!standable(w, sp, x, y)) return 0;
  return standable(w, sp, x, (j + 1) * NAV - 1) ? 1 : 0;
}

// Un arbre tombe ou repousse : on recalcule seulement la zone touchée, pour chaque espèce.
onTerrainChange((w, x0, y0, x1, y1) => {
  const m = grids.get(w);
  if (!m) return;
  const i0 = Math.max(0, Math.floor(x0 / NAV) - 10), i1 = Math.min(GW - 1, Math.ceil(x1 / NAV) + 10);
  const j0 = Math.max(0, Math.floor(y0 / NAV) - 1), j1 = Math.min(GH - 1, Math.ceil(y1 / NAV) + 1);
  for (const [sp, g] of m) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.ok[j * GW + i] = cellFree(w, sp, i, j);
});

const cellOf = (x: number, y: number) => [Math.min(GW - 1, Math.max(0, Math.floor(x / NAV))), Math.min(GH - 1, Math.max(0, Math.floor(y / NAV)))] as const;

/** Case praticable la plus proche de (x, y), en anneaux. Renvoie le centre en px, ou null. */
export function nearestFree(w: World, sp: SpeciesId, x: number, y: number, maxR = 24): { x: number; y: number } | null {
  const g = grid(w, sp);
  const [ci, cj] = cellOf(x, y);
  if (g.ok[cj * GW + ci]) return { x: (ci + 0.5) * NAV, y: (cj + 0.5) * NAV };
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= GW || j >= GH || !g.ok[j * GW + i]) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = j * GW + i; }
    }
    if (best >= 0) return { x: ((best % GW) + 0.5) * NAV, y: (Math.floor(best / GW) + 0.5) * NAV };
  }
  return null;
}

/** Ligne droite praticable entre deux points (pas d'une demi-case sur la grille de l'espèce). */
export function clearLine(w: World, sp: SpeciesId, ax: number, ay: number, bx: number, by: number): boolean {
  const g = grid(w, sp);
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.ceil(d / (NAV * 0.5));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const [i, j] = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (!g.ok[j * GW + i]) return false;
  }
  return true;
}

// --- A* (tas binaire sur tableaux typés, réutilisés entre les appels) ---
const N = GW * GH;
const gScore = new Float32Array(N);
const fScore = new Float32Array(N);
const came = new Int32Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
let gen = 1;
const heap = new Int32Array(N);
let hn = 0;

function push(n: number) {
  let i = hn++;
  heap[i] = n;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (fScore[heap[p]] <= fScore[heap[i]]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}
function pop(): number {
  const top = heap[0];
  heap[0] = heap[--hn];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1;
    let m = i;
    if (l < hn && fScore[heap[l]] < fScore[heap[m]]) m = l;
    if (r < hn && fScore[heap[r]] < fScore[heap[m]]) m = r;
    if (m === i) break;
    [heap[m], heap[i]] = [heap[i], heap[m]];
    i = m;
  }
  return top;
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]] as const;

/** Compteur de calculs de chemins (budget par frame, voir `pathBudget`). */
export const navStats = { paths: 0, budget: 0, partial: false };
/** Remet le budget de chemins de la frame (quelques A* par pas au plus, le reste attend son tour). */
export function pathBudget(n: number) { navStats.budget = n; }

/**
 * Chemin praticable de (ax, ay) à (bx, by) pour l'espèce, lissé (points d'étape en px), ou null.
 * Le départ et l'arrivée sont ramenés sur la case libre la plus proche. `maxExpand` borne le coût.
 */
export function findPath(w: World, sp: SpeciesId, ax: number, ay: number, bx: number, by: number, maxExpand = 9000): number[] | null {
  const g = grid(w, sp);
  const s0 = nearestFree(w, sp, ax, ay, 6), e0 = nearestFree(w, sp, bx, by, 12);
  if (!s0 || !e0) return null;
  navStats.paths++;
  navStats.budget--;
  const [si, sj] = cellOf(s0.x, s0.y), [ei, ej] = cellOf(e0.x, e0.y);
  const start = sj * GW + si, goal = ej * GW + ei;
  if (++gen === 0xffffffff) { gen = 1; stamp.fill(0); closed.fill(0); }
  hn = 0;
  const h = (n: number) => { const dx = Math.abs((n % GW) - ei), dy = Math.abs(Math.floor(n / GW) - ej); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  stamp[start] = gen; gScore[start] = 0; fScore[start] = h(start); came[start] = -1;
  push(start);
  let found = -1, expanded = 0, bestN = start, bestH = h(start);
  while (hn > 0 && expanded < maxExpand) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    expanded++;
    if (cur === goal) { found = cur; break; }
    const hc = fScore[cur] - gScore[cur];
    if (hc < bestH) { bestH = hc; bestN = cur; }
    const ci = cur % GW, cj = Math.floor(cur / GW);
    for (const [di, dj, c] of DIRS) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
      const n = j * GW + i;
      if (!g.ok[n] || closed[n] === gen) continue;
      // Pas de diagonale qui rase un coin bloqué.
      if (di && dj && (!g.ok[cj * GW + i] || !g.ok[j * GW + ci])) continue;
      const ng = gScore[cur] + c;
      if (stamp[n] === gen && ng >= gScore[n]) continue;
      stamp[n] = gen; gScore[n] = ng; fScore[n] = ng + h(n); came[n] = cur;
      push(n);
    }
  }
  // But inaccessible (île, autre rive) ou trop loin : on va au plus près (`navStats.partial` si inaccessible).
  // Seulement si la zone accessible est épuisée (vraiment inaccessible), pas si la recherche a été bornée.
  navStats.partial = found < 0 && hn === 0;
  if (found < 0) found = bestN;
  const cells: number[] = [];
  for (let n = found; n >= 0; n = came[n]) cells.push(n);
  cells.reverse();
  // Lissage : on garde un point d'étape seulement quand la ligne droite cesse d'être praticable.
  const pts: number[] = [];
  const cx = (n: number) => ((n % GW) + 0.5) * NAV, cy = (n: number) => (Math.floor(n / GW) + 0.5) * NAV;
  let ax2 = ax, ay2 = ay;
  for (let m = 1; m < cells.length; m++) {
    // Tant que la case suivante reste visible depuis l'ancre, on la saute.
    if (m < cells.length - 1 && clearLine(w, sp, ax2, ay2, cx(cells[m + 1]), cy(cells[m + 1]))) continue;
    ax2 = cx(cells[m]); ay2 = cy(cells[m]);
    pts.push(ax2, ay2);
  }
  // Dernier point : la vraie cible si on l'atteint, sinon le centre de la dernière case.
  if (found === goal && clearLine(w, sp, ax2, ay2, bx, by) && standable(w, sp, bx, by)) {
    if (pts.length) { pts[pts.length - 2] = bx; pts[pts.length - 1] = by; } else pts.push(bx, by);
  }
  return pts.length ? pts : null;
}

/** Une case est-elle praticable pour l'espèce ? (calque de debug) */
export function navOk(w: World, sp: SpeciesId, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < GW && j < GH && grid(w, sp).ok[j * GW + i] === 1;
}
