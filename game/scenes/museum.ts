import { PX_PER_M } from "../config";
import type { Input } from "../input";
import { THEMES, type RGB, type Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import type { Prim, Raster } from "../render/raster";
import { drawRaster } from "../render/sprite";
import { hash2 } from "../rng";
import { shownName, SPECIES, SPECIES_LIST } from "../species";
import { eggSize } from "../species/eggs";
import type { SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { actions, bar, button, buttonW, clip, hitAt, panel, region, SP, text, wrap, type Action, type Hint } from "../ui/kit";
import { EGG_FACT, EXTRA_BY_ID, EXTRAS, outlineRaster, scaleAll } from "./dig-fossils";
import { labScene } from "./lab";
import {
  cachedRaster, entryFrames, medal, eggFound, hallFor, lifeRaster, lighten, lookOf, mix, put, ROOMS, visible,
  type Exhibit, type Hall,
} from "./museum-hall";
import { parkScene } from "./park";
import { UI_TOP, type Scene } from "./types";

/**
 * Musée : le joueur expose tout ce qu'il a trouvé. Un long couloir de salles en enfilade
 * (accueil, grand hall des squelettes, salle des mers, galerie des fossiles, salle de la vie),
 * parcouru de gauche à droite. Cliquer une pièce ouvre son cartel (fiche d'exposition).
 * Le décor est cuit une fois (museum-hall.ts) ; on n'anime ici que le survol, la poussière dans
 * les projecteurs, les bulles, les dioramas et les visiteurs.
 */

export interface MuseumState {
  ready: boolean;
  /** Caméra : première colonne du hall à l'écran (cellules monde). */
  camX: number;
  /** Glissement vers une salle (colonne cible), ou null. */
  target: number | null;
  /** Pièce dont le cartel est ouvert (clé d'exposition). */
  sel: string | null;
  /** Glisser-déplacer en cours (commencé hors de l'interface). */
  drag: boolean;
}
export function createMuseumState(): MuseumState {
  return { ready: false, camX: 0, target: null, sel: null, drag: false };
}

const SCROLL = 150;

/** Dernier plan dessiné : la logique utilise exactement celui qu'on voit à l'écran. */
let shown: Hall | null = null;
const hallNow = (s: GameState) => shown ?? hallFor(THEMES[s.style], metrics.cols, metrics.rows, s.progress);
const maxCam = (h: Hall) => Math.max(0, h.width - h.geo.cols);
const roomAt = (h: Hall, x: number) => Math.max(0, h.rooms.findIndex((r) => x >= r.x0 && x < r.x0 + r.w));

/** Pièce sous un point écran (px CSS) : la plus petite boîte gagne (vitrine devant un mur, etc.). */
function exhibitAt(h: Hall, cam: number, px: number, py: number): Exhibit | undefined {
  const x = Math.floor(px / metrics.cellW) + cam, y = Math.floor(py / metrics.cellH);
  let best: Exhibit | undefined, area = Infinity;
  for (const e of h.ex) {
    if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) continue;
    const a = (e.x1 - e.x0 + 1) * (e.y1 - e.y0 + 1);
    if (a < area) { best = e; area = a; }
  }
  return best;
}

function goRoom(s: GameState, h: Hall, i: number) {
  const r = h.rooms[Math.max(0, Math.min(h.rooms.length - 1, i))];
  s.museum.target = Math.max(0, Math.min(maxCam(h), r.x0));
}

/** Ouvre la fiche d'une espèce dans le carnet. */
function toJournal(s: GameState, sp: SpeciesId | undefined) {
  s.journal.species = sp;
  s.journal.extras = !sp;
  s.mode = "journal";
}

/** Rejoint un individu vivant de l'espèce dans la réserve, caméra qui le suit. */
function toPark(s: GameState, sp: SpeciesId) {
  s.mode = "park";
  parkScene.enter?.(s);
  const a = s.park.animals.find((q) => q.sp === sp && q.task !== "dead");
  if (a) { s.park.selected = a.id; s.park.follow = true; s.park.cam.x = a.x - 600; s.park.cam.y = a.y - 350; }
}

function toLab(s: GameState, sp: SpeciesId) {
  s.mode = "lab";
  s.lab.species = sp;
  labScene.enter?.(s);
}

export const museumScene: Scene = {
  enter(s) {
    s.museum.ready = true;
    s.museum.drag = false;
  },

  update(s, input: Input, dt) {
    const m = s.museum, h = hallNow(s);
    const cols = h.geo.cols;
    if (input.dx) { m.camX += input.dx * SCROLL * dt; m.target = null; }
    if (input.mouse.wheel) { m.camX += input.mouse.wheel * 0.25; m.target = null; }
    for (const p of input.mouse.presses) if (p.button === 0 && !hitAt(p.x, p.y)) m.drag = true;
    if (!input.mouse.down) m.drag = false;
    if (m.drag && input.mouse.dragX) { m.camX -= input.mouse.dragX / metrics.cellW; m.target = null; }

    const cur = roomAt(h, m.camX + cols / 2);
    for (const k of input.pressed) {
      if (k === "Enter" || k === "Space") goRoom(s, h, cur + 1 >= h.rooms.length ? 0 : cur + 1);
    }
    for (const id of input.ui) {
      if (id === "museum:prev") goRoom(s, h, m.camX > h.rooms[cur].x0 + 4 ? cur : cur - 1);
      else if (id === "museum:next") goRoom(s, h, cur + 1);
      else if (id.startsWith("museum:room:")) goRoom(s, h, Number(id.slice(12)));
      else if (id.startsWith("museum:ex:")) m.sel = m.sel === id.slice(10) ? null : id.slice(10);
      else if (id === "museum:close") m.sel = null;
      else if (m.sel) {
        const e = h.ex.find((q) => q.key === m.sel);
        if (id === "museum:journal") return toJournal(s, e?.kind === "extra" ? undefined : e?.sp);
        if (id === "museum:park" && e?.sp) return toPark(s, e.sp);
        if (id === "museum:lab" && e?.sp) return toLab(s, e.sp);
      }
    }
    for (const c of input.worldClicks) {
      const e = exhibitAt(h, Math.round(m.camX), c.x, c.y);
      m.sel = e && e.key !== m.sel ? e.key : null;
    }
    if (m.target !== null) {
      m.camX += (m.target - m.camX) * Math.min(1, dt * 7);
      if (Math.abs(m.target - m.camX) < 0.5) { m.camX = m.target; m.target = null; }
    }
    m.camX = Math.max(0, Math.min(maxCam(h), m.camX));
  },

  compose(s, th, world, ui) {
    const h = (shown = hallFor(th, world.cols, world.rows, s.progress));
    const m = s.museum;
    m.camX = Math.max(0, Math.min(maxCam(h), m.camX));
    const cam = Math.round(m.camX);
    blit(world, h, cam);
    const hover = !hitAt(s.mouse.x, s.mouse.y) && s.mouse.x >= 0 ? exhibitAt(h, cam, s.mouse.x, s.mouse.y) : undefined;
    drawLive(s, th, world, h, cam, hover);
    drawUi(s, th, ui, h, cam, hover);
  },

  hints(s) {
    const h: Hint[] = [["Fleches", "se deplacer"], ["Glisser", "se deplacer"], ["Clic", "cartel"], ["Entree", "salle suivante"]];
    if (s.museum.sel) h.push(["Echap", "fermer le cartel"]);
    return h;
  },

  help() {
    return [
      ["Fleches", "se deplacer dans le couloir (ou Q / D, molette, glisser)"],
      ["Clic", "ouvrir le cartel d'une piece (plaque ou objet)"],
      ["Entree", "salle suivante (Espace aussi)"],
      ["Echap", "fermer le cartel"],
    ];
  },

  back(s) {
    if (!s.museum.sel) return false;
    s.museum.sel = null;
    return true;
  },
};

// ---------------------------------------------------------------------------
// Calque monde : copie de la bande cuite, puis ce qui bouge.
// ---------------------------------------------------------------------------
function blit(f: Frame, h: Hall, cam: number) {
  const W = h.strip.cols, n = Math.min(f.cols, W - cam);
  for (let y = 0; y < f.rows && y < h.strip.rows; y++) {
    const a = y * W + cam, b = y * f.cols;
    f.ch.set(h.strip.ch.subarray(a, a + n), b);
    f.fg.set(h.strip.fg.subarray(a * 4, (a + n) * 4), b * 4);
    f.bg.set(h.strip.bg.subarray(a * 4, (a + n) * 4), b * 4);
  }
}

/** Visiteur : silhouette humaine qui marche (jambes et bras balancés), échelle du musée. */
function visitorPrims(phase: number, hM: number): Prim[] {
  const H = hM * PX_PER_M, m = 149; // SM.Human
  const sw = Math.sin(phase) * 3;
  return [
    { k: "e", x: 0, y: -H + 5, rx: 5, ry: 5, m, z: 6, h: 4 },
    { k: "c", ax: 0, ay: -H + 13, bx: 0, by: -H * 0.47, ra: 5.5, rb: 4.8, m, z: 4, h: 4 },
    { k: "c", ax: -2, ay: -H * 0.47, bx: -2 + sw, by: -1.5, ra: 2.6, rb: 2, m, z: 3, h: 2 },
    { k: "c", ax: 2, ay: -H * 0.47, bx: 2 - sw, by: -1.5, ra: 2.6, rb: 2, m, z: 3, h: 2 },
    { k: "c", ax: -4.5, ay: -H + 14, bx: -4.5 - sw * 0.8, by: -H * 0.5, ra: 2, rb: 1.6, m, z: 5, h: 2 },
    { k: "c", ax: 4.5, ay: -H + 14, bx: 4.5 + sw * 0.8, by: -H * 0.5, ra: 2, rb: 1.6, m, z: 5, h: 2 },
  ];
}

function drawLive(s: GameState, th: Theme, f: Frame, h: Hall, cam: number, hover: Exhibit | undefined) {
  const L = lookOf(th), g = h.geo, t = s.time;
  const sel = s.museum.sel;
  const vis = visible(h, cam, f.cols);

  // Poussière qui danse dans les projecteurs.
  for (const e of vis) {
    if (e.kind !== "sp" && e.kind !== "sea") continue;
    const H = g.base - g.ceil - 2;
    for (let k = 0; k < 7; k++) {
      const r1 = hash2(k, e.px, 1), r2 = hash2(k, e.px, 2);
      const yy = g.ceil + 2 + ((r2 * H + t * (1 + r1)) % H);
      const hw = 2 + ((yy - g.ceil) / H) * Math.max(6, (e.r?.w ?? 20) * 0.5);
      const x = Math.round(e.px + (r1 - 0.5) * 2 * hw + Math.sin(t * 0.7 + k) * 1.5) - cam;
      const y = Math.round(yy);
      if (x < 0 || x >= f.cols || f.ch[y * f.cols + x] !== 32) continue;
      put(f, x, y, r1 < 0.5 ? "." : "'", mix(L.light, L.glassHi, 0.5));
    }
  }

  // Bulles qui montent dans la salle des mers.
  const sea = h.rooms[ROOMS.sea];
  if (sea.x0 < cam + f.cols && sea.x0 + sea.w > cam) {
    const H = g.floor - g.ceil;
    for (let k = 0; k < 40; k++) {
      const r1 = hash2(k, 7, 3), r2 = hash2(k, 7, 4);
      const x = Math.round(sea.x0 + r1 * sea.w + Math.sin(t * 2 + k) * 0.8) - cam;
      const y = Math.round(g.floor - 1 - ((t * (2 + r2 * 3) + r2 * H) % H));
      if (x < 0 || x >= f.cols || y < 0 || y >= f.rows) continue;
      const c = f.ch[y * f.cols + x];
      if (c !== 32 && c !== 126) continue;
      put(f, x, y, r2 < 0.3 ? "o" : ".", mix(L.glassHi, L.walls[ROOMS.sea], 0.3));
    }
  }

  // Dioramas : l'animal vivant respire (poses quantifiées, rasters en cache).
  for (const e of vis) {
    if (e.kind !== "life" || !e.owned || !e.sp) continue;
    const spec = SPECIES[e.sp];
    if (!spec) continue;
    const tq = Math.floor(t * 5 + hash2(e.x0, 1, 1) * 6) % 6;
    const r = lifeRaster(spec, e.k ?? 1, tq);
    const ref = lifeRaster(spec, e.k ?? 1, 0);
    const mid = (e.x0 + e.x1) >> 1;
    const ox = mid - Math.round(ref.cx + ref.w / 2) - cam;
    let oy: number;
    if (spec.habitat === "sea") oy = Math.round((e.y0 + e.y1) / 2 - (ref.cy + ref.h / 2));
    else {
      const ground = e.y0 + Math.round((e.y1 - e.y0 + 1) * 0.62) + Math.round((e.y1 - e.y0) * 0.16);
      oy = Math.max(e.y0 + 1 - ref.cy, Math.min(ground, e.y1 - 1 - (ref.cy + ref.h - 1)));
      // Ombre douce sous l'animal.
      for (let x = ox + ref.cx + Math.round(ref.w * 0.15); x < ox + ref.cx + Math.round(ref.w * 0.85); x++) {
        const k = (oy * f.cols + x) * 4;
        if (x < 0 || x >= f.cols || oy >= f.rows) continue;
        for (let c = 0; c < 3; c++) f.bg[k + c] *= 0.8;
      }
    }
    if (th.outline) outlineRaster(f, r, ox, oy, th.pal.ink);
    drawRaster(f, th, r, ox, oy, { light: e === hover ? 1.2 : 1.05 });
  }

  // Survol et sélection : la pièce s'illumine.
  for (const e of [hover, h.ex.find((q) => q.key === sel)]) {
    if (!e) continue;
    const hot = e.key === sel;
    if (e.r && (e.kind === "sp" || e.kind === "sea" || e.kind === "extra" || e.kind === "egg")) {
      if (hot) outlineRaster(f, e.r, e.ox - cam, e.oy, th.ui.hi);
      if (e.owned) drawRaster(f, th, e.r, e.ox - cam, e.oy, { light: 1.3 });
      else drawRaster(f, th, e.r, e.ox - cam, e.oy, { ghost: true, tint: th.ui.hi, light: 1.4 });
    } else if (e.kind === "life") {
      for (let x = e.x0; x <= e.x1; x++) for (const y of [e.y0, e.y1]) put(f, x - cam, y, "=", th.ui.hi);
      for (let y = e.y0; y <= e.y1; y++) for (const x of [e.x0, e.x1]) put(f, x - cam, y, "#", th.ui.hi);
    }
    if (e.kind !== "life") for (let y = e.y0; y <= g.base; y++) for (let x = e.x0; x <= e.x1; x++) if (hot) lighten(f, x - cam, y, th.ui.hi, 0.04);
  }

  // Visiteurs : un par salle, qui flâne d'un bout à l'autre (et un enfant dans le grand hall).
  const feet = Math.min(g.rows - 2, g.base + 5);
  h.rooms.forEach((room, i) => {
    if (room.x0 > cam + f.cols || room.x0 + room.w < cam) return;
    const span = room.w - 50;
    const walkers: [number, number][] = i === ROOMS.hall ? [[0, 1.75], [-9, 1.15]] : [[0, 1.75]];
    for (const [lag, hM] of walkers) {
      const d = t * 4 + i * 97 + lag;
      const u = ((d % (2 * span)) + 2 * span) % (2 * span);
      const back = u > span;
      const x = room.x0 + 25 + Math.round(back ? 2 * span - u : u) - cam;
      if (x < -10 || x > f.cols + 10) continue;
      const fq = Math.floor(d * 0.9) % 4;
      const r: Raster = cachedRaster(`visitor|${hM}|${fq}|${g.S}|${back ? 1 : 0}`, () => scaleAll(visitorPrims((fq / 4) * Math.PI * 2, hM), g.S), back);
      drawRaster(f, th, r, x, feet, { light: 0.9 });
    }
  });
}

// ---------------------------------------------------------------------------
// Calque d'interface : titres, plaques, panneaux de l'accueil, cartel, navigation.
// ---------------------------------------------------------------------------
const toUiX = (x: number) => Math.floor((x * metrics.cellW) / metrics.uiW);
const toUiY = (y: number) => Math.floor((y * metrics.cellH) / metrics.uiH);

function exName(s: GameState, e: Exhibit): string {
  const p = s.progress;
  if (e.kind === "extra") return e.owned ? (EXTRA_BY_ID[e.extra ?? ""]?.name ?? "?") : "???";
  if (e.kind === "egg" && e.sp) return e.owned ? `Oeuf ${deOf(shownName(p, e.sp))}` : "Oeuf ???";
  if (!e.sp) return "???";
  return e.owned ? (SPECIES[e.sp]?.name ?? e.sp) : (p.bones[e.sp]?.length ? shownName(p, e.sp) : "???");
}
const deOf = (n: string) => (/^[aeiouyhAEIOUYH]/.test(n) ? `d'${n}` : `de ${n}`);
const fmtNum = (v: number) => String(v).replace(".", ",");

function drawUi(s: GameState, th: Theme, ui: Frame, h: Hall, cam: number, hover: Exhibit | undefined) {
  const u = th.ui, L = lookOf(th);
  const cur = roomAt(h, cam + h.geo.cols / 2);
  const room = h.rooms[cur];

  // Plaques de laiton sous chaque pièce visible (cliquables).
  const plaqueFg: RGB = th.style === "dark" ? u.panel : u.text;
  for (const e of visible(h, cam, h.geo.cols)) {
    const name = exName(s, e);
    const maxW = e.kind === "extra" || e.kind === "egg" ? Math.max(6, toUiX(e.x1 - e.x0) - 1) : 26;
    const lines = wrap(name, maxW).slice(0, 2);
    const y = toUiY(e.py);
    lines.forEach((t, i) => {
      const x = toUiX(e.px - cam) - (t.length >> 1);
      // Plaque coupée par le bord de l'écran : on attend qu'elle soit entièrement visible.
      if (x < 0 || x + t.length > ui.cols || y + i >= ui.rows - 2) return;
      text(ui, x, y + i, t, e.owned ? plaqueFg : u.dim, e.owned ? L.brass : u.panel, e.owned ? 1 : 0.75);
      region(`museum:ex:${e.key}`, x, y + i, t.length, 1);
    });
  }

  // Accueil : la collection en chiffres, et le plan du musée.
  drawEntryPanels(s, th, ui, h, cam);

  // Titre de la salle courante.
  const title = ` ${room.title.toUpperCase()} `;
  const tx = (ui.cols - title.length) >> 1;
  text(ui, tx, UI_TOP, title, u.panel, u.hi, 1);
  const sub = ` ${room.sub} `;
  if (sub.length < ui.cols - 4) text(ui, (ui.cols - sub.length) >> 1, UI_TOP + 1, sub, u.text, u.panel, 0.85);

  // Bulle de survol.
  if (hover && hover.key !== s.museum.sel) {
    const tag = ` ${exName(s, hover)}  -  clic : cartel `;
    const mx = Math.floor(s.mouse.x / metrics.uiW), my = Math.floor(s.mouse.y / metrics.uiH);
    text(ui, Math.max(0, Math.min(ui.cols - tag.length, mx + 2)), Math.max(UI_TOP + 2, my - 2), tag, u.text, u.panel, 0.95);
  }

  // Cartel de la pièce choisie.
  const e = s.museum.sel ? h.ex.find((q) => q.key === s.museum.sel) : undefined;
  if (e) drawCartel(s, th, ui, e);

  // Navigation entre les salles : au-dessus de la ligne d'aide (précédente à gauche, suivante à droite,
  // pastilles des salles au centre, chacune cliquable ; la salle courante est un « O » plein).
  const y = ui.rows - 2;
  const prev = "< Salle precedente", next = "Salle suivante >";
  const pw = buttonW(prev), nw = buttonW(next);
  button(ui, th, "museum:prev", SP.margin, y, prev, { disabled: cam <= 0, tip: "Salle precedente (fleche gauche)" });
  button(ui, th, "museum:next", ui.cols - nw - SP.margin, y, next, { disabled: cur >= h.rooms.length - 1, tip: "Salle suivante (Entree)" });
  const dots = h.rooms.map((_, i) => (i === cur ? "O" : "o")).join(" ");
  const room0 = ui.cols - pw - nw - 2 * SP.margin - 4;
  const mid = clip(` ${dots}   ${cur + 1}/${h.rooms.length} ${room.title} `, room0);
  if (room0 >= dots.length + 2) {
    const mx = (ui.cols - mid.length) >> 1;
    text(ui, mx, y, mid, u.text, u.panel, 0.85);
    h.rooms.forEach((r, i) => region(`museum:room:${i}`, mx + 1 + i * 2, y, 1, 1, { tip: `${i + 1}. ${r.title}` }));
  }
}

function drawEntryPanels(s: GameState, th: Theme, ui: Frame, h: Hall, cam: number) {
  const u = th.ui, p = s.progress;
  const frames = entryFrames(h);
  if (frames[0][0] - cam > h.geo.cols || frames[1][2] - cam < 0) return;
  const T = (x: number, y: number, str: string, col: RGB = u.text) => text(ui, x, y, str, col, u.panel, u.alpha);

  // --- Titre autour du médaillon ---
  {
    const md = medal(h);
    const room = toUiX(md.R * 4 + 8);
    const t1 = room >= 30 ? " MUSEE D'HISTOIRE NATURELLE " : " MUSEE ", t2 = room >= 30 ? " Collection de l'explorateur " : "";
    const cx = toUiX(md.x - cam);
    text(ui, cx - (t1.length >> 1), toUiY(md.cy - md.R) - 2, t1, u.panel, u.hi, 1);
    if (t2) text(ui, cx - (t2.length >> 1), toUiY(md.cy + md.R) + 2, t2, u.text, u.panel, 0.85);
  }

  // --- Statistiques ---
  {
    const [x0, y0, x1, y1] = frames[0];
    const ux = toUiX(x0 - cam) + 1, uy = toUiY(y0) + 1, w = toUiX(x1 - x0) - 1, hh = toUiY(y1) - uy;
    if (w >= 24 && hh >= 6) {
      panel(ui, th, ux, uy, w, hh, "Ta collection");
      const iw = w - 4;
      const bones = SPECIES_LIST.reduce((n, sp) => n + (p.bones[sp.id]?.length ?? 0), 0);
      const allBones = SPECIES_LIST.reduce((n, sp) => n + sp.bones.length, 0);
      const extras = EXTRAS.filter((x) => p.extras.includes(x.id)).length;
      const layers = SPECIES_LIST.filter((sp) => eggSize(sp.id) > 0);
      const eggs = layers.filter((sp) => eggFound(p, sp.id)).length;
      const facts = p.facts.filter((f) => !f.startsWith("fauna:")).length;
      const allFacts = SPECIES_LIST.reduce((n, sp) => n + sp.facts.length, 0);
      const pop = Object.values(p.population).reduce((n, v) => n + (v ?? 0), 0);
      const rows: [string, number, number][] = [
        ["Especes assemblees", p.assembled.length, SPECIES_LIST.length],
        ["Os trouves", bones, allBones],
        ["Fossiles bonus", extras, EXTRAS.length],
        ["Oeufs fossiles", eggs, layers.length],
        ["Faits debloques", Math.min(facts, allFacts), allFacts],
      ];
      let y = uy + 2;
      const hy = uy + hh - 1;
      if (y < hy) { T(ux + 2, uy + 1, "Musee d'histoire naturelle".slice(0, iw), u.hi); }
      for (const [label, a, b] of rows) {
        if (y + 1 >= hy) break;
        const v = `${a}/${b}`;
        T(ux + 2, y, label.slice(0, iw - v.length - 1), u.text);
        T(ux + 2 + iw - v.length, y, v, a >= b ? u.ok : u.hi);
        bar(ui, th, ux + 2, y + 1, iw, a / Math.max(1, b), a >= b ? u.ok : u.hi);
        y += 3;
      }
      if (y < hy) T(ux + 2, y++, `Fouilles terminees : ${p.digs}`.slice(0, iw));
      if (y < hy) T(ux + 2, y++, `Animaux dans la reserve : ${pop}`.slice(0, iw));
      if (y + 1 < hy && !p.assembled.length) wrap("Ton musee attend ses premieres pieces : fouille (2), puis assemble (3) !", iw).slice(0, hy - y - 1).forEach((l, i) => T(ux + 2, y + 1 + i, l, u.dim));
    }
  }

  // --- Plan du musée ---
  {
    const [x0, y0, x1, y1] = frames[1];
    const ux = toUiX(x0 - cam) + 1, uy = toUiY(y0) + 1, w = toUiX(x1 - x0) - 1, hh = toUiY(y1) - uy;
    if (w >= 24 && hh >= 6) {
      panel(ui, th, ux, uy, w, hh, "Plan du musee");
      const iw = w - 4;
      let y = uy + 2;
      for (let i = 1; i < h.rooms.length && y + 1 < uy + hh - 1; i++) {
        const r = h.rooms[i];
        const ex = h.ex.filter((q) => q.room === i);
        const own = ex.filter((q) => q.owned).length;
        const cnt = `${own}/${ex.length}`;
        button(ui, th, `museum:room:${i}`, ux + 2, y, `${i}. ${r.title}`, { w: Math.max(10, iw - cnt.length - 2) });
        T(ux + 2 + iw - cnt.length, y, cnt, own >= ex.length ? u.ok : u.dim);
        y += 2;
      }
    }
  }
}

/** Cartel : la fiche d'exposition de la pièce choisie, avec ses boutons. */
function drawCartel(s: GameState, th: Theme, ui: Frame, e: Exhibit) {
  const u = th.ui, p = s.progress;
  const w = Math.min(46, ui.cols - 4), x = ui.cols - w - 2, iw = w - 4;
  const lines: [string, RGB][] = [];
  const add = (t: string, c: RGB = u.text) => wrap(t, iw).forEach((l) => lines.push([l, c]));
  const btns: [string, string][] = [];
  let title = exName(s, e);
  const spec = e.sp ? SPECIES[e.sp] : undefined;

  if ((e.kind === "sp" || e.kind === "sea" || e.kind === "life") && spec) {
    if (e.owned) {
      add(spec.latin, u.dim);
      add(spec.period);
      add(`Longueur : ${fmtNum(spec.lengthM)} m   Poids : ${spec.massKg >= 1000 ? `${fmtNum(Math.round(spec.massKg / 100) / 10)} t` : `${spec.massKg} kg`}`);
      add(`Regime : ${spec.behavior.diet}`);
      add(`Fossiles trouves : ${spec.place}`, u.dim);
      lines.push(["", u.text]);
      const got = spec.facts.filter((f) => p.facts.includes(`${spec.id}:${f.id}`));
      const f = got[Math.floor(s.time / 8) % Math.max(1, got.length)] ?? spec.facts[0];
      if (f) { add(f.title, u.hi); add(f.text); }
      lines.push(["", u.text]);
      add(`Faits debloques : ${got.length}/${spec.facts.length}`, u.dim);
      const pop = p.population[spec.id] ?? 0;
      if (pop) add(`Dans la reserve : ${pop}`, u.dim);
      btns.push(["museum:journal", "Voir dans le carnet"]);
      if (pop > 0) btns.push(["museum:park", "Voir dans la reserve"]);
    } else {
      const found = p.bones[spec.id]?.length ?? 0;
      title = found ? shownName(p, spec.id) : "???";
      add(e.kind === "life" ? "Diorama vide : cette espece n'a pas encore ete ramenee a la vie." : "Socle vide : il attend son squelette.", u.text);
      lines.push(["", u.text]);
      add(`Os trouves : ${found}/${spec.bones.length}`, found ? u.hi : u.dim);
      add(found >= spec.bones.length ? "Tous les os sont la : assemble-le a l'atelier !" : "Fouille et assemble-le !", u.hi);
      if (found >= spec.bones.length) btns.push(["museum:lab", "Aller a l'atelier"]);
    }
  } else if (e.kind === "extra") {
    const d = EXTRA_BY_ID[e.extra ?? ""];
    if (e.owned && d) {
      add("Fossile bonus, trouve en fouille", u.dim);
      lines.push(["", u.text]);
      add(d.fact);
      btns.push(["museum:journal", "Voir dans le carnet"]);
    } else add("Vitrine vide : ce fossile se cache encore dans la roche. Continue a fouiller les falaises !", u.dim);
  } else if (e.kind === "egg" && spec) {
    if (e.owned) {
      add("Oeuf fossile, trouve en fouille", u.dim);
      lines.push(["", u.text]);
      add(EGG_FACT);
      const n = p.eggs[spec.id] ?? 0;
      if (n > 0) {
        lines.push(["", u.text]);
        add(p.assembled.includes(spec.id) ? `${n} a incuber a l'atelier.` : `${n} en attente : assemble d'abord l'espece pour l'incuber.`, u.hi);
        if (p.assembled.includes(spec.id)) btns.push(["museum:lab", "Aller a l'atelier"]);
      }
    } else add("Vitrine vide : aucun oeuf de cette espece pour l'instant. Les oeufs sont rares, ouvre l'oeil en fouille !", u.dim);
  }

  // Fermeture en haut à droite ; actions en bas à droite, la principale (la première de la liste) tout à
  // droite. Une seule rangée si elles tiennent, sinon empilées (la principale en bas).
  const acts = btns.map(([id, label], i): Action => ({ id, label, variant: i === 0 ? "primary" : "secondary" })).reverse();
  const oneRow = acts.reduce((n, a) => n + buttonW(a.label) + SP.gap, -SP.gap) <= iw;
  const rowsN = acts.length ? (oneRow ? 1 : acts.length) : 0;
  const hgt = Math.min(lines.length + 3 + rowsN * 2 - (rowsN ? 1 : 0), ui.rows - UI_TOP - 6);
  const y = UI_TOP + 3;
  panel(ui, th, x, y, w, hgt, `Cartel : ${title}`, { close: "museum:close" });
  const room = hgt - 3 - (rowsN ? rowsN * 2 - 1 : 0);
  lines.slice(0, Math.max(0, room)).forEach(([t, c], i) => text(ui, x + 2, y + 1 + i, t, c, u.panel, u.alpha));
  if (oneRow) actions(ui, th, x + 2, y + hgt - 2, iw, acts);
  else acts.forEach((a, i) => actions(ui, th, x + 2, y + hgt - 2 - (acts.length - 1 - i) * 2, iw, [a]));
}

