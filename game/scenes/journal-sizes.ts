import { CELL_H, PX_PER_M } from "../config";
import type { Input } from "../input";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import { M } from "../render/materials";
import { scalePrim, type Prim, type Raster } from "../render/raster";
import { drawRaster } from "../render/sprite";
import { discovered, SPECIES } from "../species";
import type { Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { ascii, button, panel, put, text, wrap } from "../ui/kit";
import { cached, fmtKg, fmtM, fmtNum, groundLine, human, idle, known, knownList, RH, RW } from "./journal-common";
import { UI_TOP } from "./types";

/**
 * Comparateur de tailles : une espèce assemblée à côté d'un humain et d'une référence du quotidien
 * (chat, éléphant, girafe, bus scolaire, baleine bleue), tous à la même échelle, avec leurs cotes.
 */

export type RefId = "cat" | "elephant" | "giraffe" | "bus" | "whale" | "none";

export interface SizesState {
  sp?: SpeciesId;
  /** Référence choisie (absente : choisie selon la taille de l'animal). */
  ref?: RefId;
}

export function createSizesState(): SizesState {
  return {};
}

interface Ref {
  label: string;
  /** « un éléphant », pluriel « éléphants ». */
  un: string;
  plur: string;
  lengthM: number;
  heightM: number;
  massKg: number;
  /** Ce que mesure la longueur. */
  note: string;
  model: () => Prim[];
}

// --- Silhouettes de référence (mètres -> px modèle, origine aux pieds, regard à droite) ---
const P = PX_PER_M;
const E = (x: number, y: number, rx: number, ry: number, m: number = M.Stone, z = 4): Prim => ({ k: "e", x: x * P, y: y * P, rx: rx * P, ry: ry * P, m, z: z * P / 10, h: 4 });
const C = (ax: number, ay: number, bx: number, by: number, ra: number, rb = ra, m: number = M.Stone, z = 2): Prim =>
  ({ k: "c", ax: ax * P, ay: ay * P, bx: bx * P, by: by * P, ra: ra * P, rb: rb * P, m, z: z * P / 10, h: 3 });
const CUT = (x: number, y: number, rx: number, ry: number): Prim => ({ k: "cut", x: x * P, y: y * P, rx: rx * P, ry: ry * P });

function cat(): Prim[] {
  return [
    C(-0.2, -0.24, -0.36, -0.42, 0.02), // queue dressée
    E(0, -0.19, 0.2, 0.08), E(0.22, -0.27, 0.075, 0.07, M.Stone, 6),
    C(0.18, -0.33, 0.19, -0.37, 0.02), C(0.26, -0.33, 0.27, -0.37, 0.02),
    C(-0.13, -0.15, -0.14, -0.01, 0.025), C(-0.08, -0.15, -0.08, -0.01, 0.025),
    C(0.12, -0.15, 0.12, -0.01, 0.025), C(0.16, -0.15, 0.17, -0.01, 0.025),
  ];
}
function elephant(): Prim[] {
  return [
    C(-2.35, -2.5, -2.7, -1.3, 0.07, 0.05), // queue
    C(-1.5, -1.7, -1.5, -0.15, 0.42, 0.38, M.Stone, 1), C(1.4, -1.7, 1.4, -0.15, 0.42, 0.38, M.Stone, 1),
    E(0, -2.05, 2.4, 1.05),
    C(-1.1, -1.7, -1.1, -0.15, 0.45, 0.4, M.Stone, 3), C(1.0, -1.7, 1.0, -0.15, 0.45, 0.4, M.Stone, 3),
    E(2.6, -2.55, 0.8, 0.8, M.Stone, 5), E(2.2, -2.45, 0.55, 0.75, M.Stone, 6), // tête, oreille
    C(3.15, -2.4, 3.6, -0.5, 0.3, 0.14, M.Stone, 5), // trompe
    C(3.0, -1.95, 3.55, -1.55, 0.09, 0.05, M.Bone, 7), // défense
  ];
}
function giraffe(): Prim[] {
  return [
    C(-1.15, -2.5, -1.4, -1.5, 0.05),
    C(-0.8, -2.1, -0.85, 0, 0.13, 0.09), C(0.85, -2.1, 0.9, 0, 0.13, 0.09),
    E(0, -2.35, 1.2, 0.6),
    C(-0.6, -2.1, -0.65, 0, 0.13, 0.09, M.Stone, 3), C(0.65, -2.1, 0.7, 0, 0.13, 0.09, M.Stone, 3),
    C(0.9, -2.6, 1.65, -4.9, 0.3, 0.16, M.Stone, 3), // cou
    E(1.9, -5.1, 0.38, 0.17, M.Stone, 5), C(1.7, -5.25, 1.7, -5.45, 0.04, 0.04, M.Stone, 5),
  ];
}
function bus(): Prim[] {
  const win: Prim[] = [];
  for (let i = 0; i < 8; i++) win.push(CUT(-4.3 + i * 1.12, -2.45, 0.4, 0.33));
  return [
    C(-5.0, -1.4, 4.9, -1.4, 0.95), C(-5.0, -2.3, 4.6, -2.3, 0.95),
    ...win,
    E(-3.4, -0.45, 0.5, 0.5, M.Club, 6), E(3.4, -0.45, 0.5, 0.5, M.Club, 6),
  ];
}
function whale(): Prim[] {
  return [
    C(-7.5, -2.0, -11.5, -2.5, 1.2, 0.35), // pédoncule caudal
    C(-11.3, -2.5, -12.8, -3.4, 0.3, 0.15), C(-11.3, -2.5, -12.6, -1.7, 0.3, 0.15), // nageoire caudale
    E(0, -1.85, 8.5, 1.85), E(6.5, -1.7, 5.8, 1.6, M.Stone, 5),
    C(3.5, -0.9, 1.6, -0.15, 0.45, 0.2, M.Stone, 7), // nageoire pectorale
  ];
}

const REFS: Record<Exclude<RefId, "none">, Ref> = {
  cat: { label: "Chat", un: "un chat", plur: "chats", lengthM: 0.75, heightM: 0.3, massKg: 4, note: "avec la queue", model: cat },
  elephant: { label: "Éléphant", un: "un éléphant", plur: "éléphants", lengthM: 7, heightM: 3, massKg: 6000, note: "de la trompe à la queue", model: elephant },
  giraffe: { label: "Girafe", un: "une girafe", plur: "girafes", lengthM: 3.5, heightM: 5.5, massKg: 1200, note: "", model: giraffe },
  bus: { label: "Bus scolaire", un: "un bus scolaire", plur: "bus scolaires", lengthM: 12, heightM: 3.2, massKg: 11000, note: "", model: bus },
  whale: { label: "Baleine bleue", un: "une baleine bleue", plur: "baleines bleues", lengthM: 25, heightM: 3.7, massKg: 150000, note: "le plus gros animal de tous les temps", model: whale },
};
const REF_ORDER: RefId[] = ["cat", "elephant", "giraffe", "bus", "whale", "none"];

function autoRef(sp: Species): RefId {
  return sp.lengthM < 2 ? "cat" : sp.lengthM < 8 ? "elephant" : sp.lengthM < 18 ? "bus" : "whale";
}

export function sizesUpdate(s: GameState, input: Input) {
  const z = s.journal.sizes;
  for (const id of input.ui) {
    if (id.startsWith("journal:sz:sp:")) { z.sp = id.slice(14) as SpeciesId; z.ref = undefined; }
    else if (id.startsWith("journal:sz:ref:")) z.ref = id.slice(15) as RefId;
  }
  const list = knownList(s);
  for (const k of input.pressed) {
    if (k !== "ArrowUp" && k !== "ArrowDown") continue;
    if (!list.length) break;
    const i = list.findIndex((sp) => sp.id === z.sp);
    z.sp = list[(i + (k === "ArrowDown" ? 1 : -1) + list.length) % list.length].id;
    z.ref = undefined;
  }
}

/** « 2 bus scolaires », « 2 bus scolaires et demi », « un bus scolaire ». */
function count(n: number, r: Ref): string {
  const h = Math.round(n * 2) / 2;
  if (h <= 1) return r.un;
  const whole = Math.floor(h);
  return `${whole} ${r.plur}${h > whole ? " et demi" : ""}`;
}
const que = (t: string) => (/^[aeiouyéè]/i.test(t) ? `qu'${t}` : `que ${t}`);

/** Phrases pédagogiques : longueur et masse comparées à la référence, hauteur comparée à l'humain. */
function sentences(sp: Species, heightM: number, r?: Ref): string[] {
  const out: string[] = [];
  const air = sp.habitat === "air";
  const long = air ? "a une envergure aussi grande" : "est aussi long";
  if (r) {
    const k = sp.lengthM / r.lengthM;
    if (k >= 0.8) out.push(`Un ${sp.name} ${long} ${que(count(k, r))} !`);
    else out.push(`Il faudrait ${Math.round(1 / k)} ${sp.name} à la file pour faire la longueur d'${r.un}.`);
    const km = sp.massKg / r.massKg;
    if (km >= 1.5) out.push(`Il pèse autant ${que(count(km, r))} (${fmtKg(sp.massKg)}).`);
    else if (km >= 0.67) out.push(`Il pèse à peu près autant ${que(r.un)} (${fmtKg(sp.massKg)}).`);
    else out.push(`Pour peser autant ${que(r.un)}, il faudrait ${fmtNum(1 / km, 0)} ${sp.name} (${fmtKg(sp.massKg)} chacun, contre ${fmtKg(r.massKg)}).`);
  }
  const kh = heightM / 1.75;
  if (kh >= 1.3) out.push(`Haut de ${fmtM(heightM)} : environ ${fmtNum(kh, 0)} fois la taille d'un humain (1,75 m).`);
  else if (kh >= 0.8) out.push(`Debout à côté de lui, un humain (1,75 m) le regarde dans les yeux.`);
  else out.push(`Un humain (1,75 m) est plus grand que lui : il nous arrive à peu près ${kh < 0.35 ? "au genou" : kh < 0.6 ? "à la taille" : "à la poitrine"}.`);
  if (air) out.push("Chez les ptérosaures, la longueur indiquée est l'envergure : d'un bout d'aile à l'autre.");
  if (sp.habitat === "sea") out.push("Il vivait dans la mer : on le pose ici sur le sol, le temps de le mesurer.");
  return out;
}

export function sizesPage(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const u = th.ui, z = s.journal.sizes;
  const top = UI_TOP, bottom = ui.rows - 2;
  const list = knownList(s);
  // --- Liste des espèces (gauche) ---
  const LW = 26;
  panel(ui, th, 1, top, LW, bottom - top, "Espèces");
  const others = discovered(s.progress).filter((sp) => !known(s, sp.id));
  let y = top + 1;
  for (const sp of list) {
    if (y >= bottom - 1) break;
    button(ui, th, `journal:sz:sp:${sp.id}`, 3, y++, sp.name, { w: LW - 4, active: z.sp === sp.id });
  }
  for (let i = 0; i < others.length && y < bottom - 1; i++) text(ui, 4, y++, "??? (à assembler)", u.dim, u.panel, u.alpha);
  if (!list.length) {
    text(ui, LW + 4, top + 2, "Les tailles", u.hi);
    wrap("Assemble un squelette à l'atelier : tu pourras ensuite comparer l'animal à un humain, un bus, un éléphant...", ui.cols - LW - 10)
      .forEach((l, i) => text(ui, LW + 4, top + 4 + i, l, u.text));
    return;
  }
  if (!z.sp || !list.some((sp) => sp.id === z.sp)) z.sp = list[0].id;
  const sp = SPECIES[z.sp]!;
  const refId = z.ref ?? autoRef(sp);
  const ref = refId === "none" ? undefined : REFS[refId];

  // --- Choix de la référence (haut) ---
  const ax0 = LW + 3, aw0 = ui.cols - ax0 - 2;
  let bx = ax0;
  bx += text(ui, bx, top, "Comparer avec : ", u.dim);
  for (const id of REF_ORDER) {
    const lab = id === "none" ? "Humain seul" : REFS[id].label;
    bx += button(ui, th, `journal:sz:ref:${id}`, bx, top, lab, { active: refId === id }) + 1;
  }

  // --- Dessin à l'échelle (calque monde) ---
  const nText = 5;
  const rw = RW(), rh = RH();
  const gRow = bottom - nText - 3; // ligne d'interface du sol
  const groundY = Math.round((gRow + 1) * rh) - 1;
  const areaTop = (top + 4) * rh;
  const ah = groundY - areaTop;
  const aw = aw0 * rw;
  const gapPx = 10 * 8; // ~10 colonnes d'interface entre deux silhouettes (px)
  const figs: { key: string; build: () => Prim[]; name: string; lenLab: string; tint: boolean }[] = [
    { key: "human", build: human, name: "Humain", lenLab: "", tint: true },
    { key: `sz:${sp.id}`, build: () => sp.model(idle(0)), name: sp.name, lenLab: fmtM(sp.lengthM), tint: false },
  ];
  if (ref) figs.push({ key: `ref:${refId}`, build: ref.model, name: ref.label, lenLab: fmtM(ref.lengthM), tint: true });
  const r1 = figs.map((f) => cached(`${f.key}|1`, f.build));
  const sumW = r1.reduce((n, r) => n + r.w * 4, 0) + gapPx * (figs.length - 1);
  const maxH = Math.max(...r1.map((r) => -r.cy * CELL_H));
  const k = Math.min(3, (aw * 4 * 0.95) / sumW, (ah * CELL_H * 0.85) / maxH);
  const kq = Math.max(0.02, Math.floor(k * 64) / 64);
  const rs: Raster[] = figs.map((f) => cached(`${f.key}|s${kq}`, () => f.build().map((q) => scalePrim(q, kq))));
  const used = rs.reduce((n, r) => n + r.w, 0) + (gapPx / 4) * (figs.length - 1);
  let cx = Math.round(ax0 * rw + Math.max(0, (aw - used) / 2));
  groundLine(world, th, ax0 * rw, (ax0 + aw0) * rw, groundY);
  const tintC = th.style === "dark" ? u.text : u.border;
  rs.forEach((r, i) => {
    const f = figs[i];
    const dx = cx - r.cx;
    drawRaster(world, th, r, dx, groundY, f.tint ? { tint: tintC, light: i === 0 ? 0.8 : 0.6 } : {});
    // Cotes : longueur au-dessus, hauteur à droite, légendes sous le sol.
    const ux0 = Math.ceil(cx / rw), ux1 = Math.max(ux0, Math.floor((cx + r.w) / rw) - 1);
    const uTop = Math.max(top + 2, Math.floor((groundY + r.cy) / rh) - 1);
    const hM = (-r.cy * CELL_H) / (kq * PX_PER_M);
    const heightM = f.key === "human" ? 1.75 : ref && i === 2 ? ref.heightM : Math.round(hM * 2) / 2 || hM;
    if (f.lenLab && ux1 - ux0 >= 3) {
      const lab = ` ${f.lenLab} `;
      text(ui, ux0, uTop, `|${"-".repeat(Math.max(0, ux1 - ux0 - 1))}|`, u.dim);
      if (ux1 - ux0 > ascii(lab).length + 1) text(ui, ux0 + Math.floor((ux1 - ux0 - ascii(lab).length) / 2) + 1, uTop, lab, u.text);
      else text(ui, ux1 + 2, uTop, f.lenLab, u.text);
    }
    const hLab = heightM < 3 ? `${fmtNum(heightM, 2)} m` : fmtM(heightM);
    const hx = ux1 + 2;
    const hy0 = uTop + 1, hy1 = gRow;
    if (hy1 - hy0 >= 2) {
      put(ui, hx, hy0, 94, u.dim); // ^
      for (let yy = hy0 + 1; yy < hy1; yy++) put(ui, hx, yy, 124, u.dim);
      put(ui, hx, hy1, 118, u.dim); // v
      text(ui, hx + 1, Math.floor((hy0 + hy1) / 2), hLab, u.text);
    } else text(ui, hx, gRow, hLab, u.text);
    const mid = Math.floor((ux0 + ux1) / 2);
    const nm = ascii(f.name);
    text(ui, Math.max(ax0, mid - Math.floor(nm.length / 2)), gRow + 1, nm, i === 1 ? u.hi : u.text);
    const sub = f.key === "human" ? "1,75 m" : i === 1 && sp.habitat === "air" ? `envergure ${fmtM(sp.lengthM)}, haut. ${hLab}` : `haut. ${hLab}`;
    text(ui, Math.max(ax0, mid - Math.floor(sub.length / 2)), gRow + 2, sub, u.dim);
    cx += r.w + gapPx / 4;
  });

  // --- Phrases (bas) ---
  const ty = gRow + 4;
  let yy = ty;
  for (const l of sentences(sp, Math.round(((-rs[1].cy * CELL_H) / (kq * PX_PER_M)) * 2) / 2, ref)) {
    for (const w of wrap(`- ${l}`, aw0 - 2)) if (yy < bottom) text(ui, ax0, yy++, w, u.text);
  }
  if (ref?.note && yy < bottom) text(ui, ax0, yy, `(${ref.label} : ${ref.note})`, u.dim);
}
