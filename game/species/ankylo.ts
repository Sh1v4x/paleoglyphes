import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import type { Pose, Species } from "./types";

/**
 * Ankylosaure modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Éditer les nombres ci-dessous pour retoucher la silhouette ; le moteur gère gauche/droite.
 * Le modèle brut mesure ~335 px du bout de la massue au bec ; on le ramène à sa taille réelle.
 */
const LENGTH_M = 7;
export const ANKYLO_SCALE = (LENGTH_M * PX_PER_M) / 335;

export const e = (x: number, y: number, rx: number, ry: number, m: number, z: number, h: number, yMin?: number, yMax?: number): Prim =>
  ({ k: "e", x, y, rx, ry, m, z, h, yMin, yMax });
export const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: number, z: number, h: number, stroke = false): Prim =>
  ({ k: "c", ax, ay, bx, by, ra, rb, m, z, h, stroke });

/**
 * Outils de pose partagés par les herbivores.
 * `turn` : rotation autour d'un pivot (rad ; positif = sens horaire à l'écran, donc tête qui s'abaisse
 * pour un regard à droite), puis décalage. Les ellipses ne tournent pas, seul leur centre bouge.
 */
export function turn(ps: Prim[], px: number, py: number, a: number, dx = 0, dy = 0): Prim[] {
  const co = Math.cos(a), si = Math.sin(a);
  const fx = (x: number, y: number) => px + (x - px) * co - (y - py) * si + dx;
  const fy = (x: number, y: number) => py + (x - px) * si + (y - py) * co + dy;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ax: fx(p.ax, p.ay), ay: fy(p.ax, p.ay), bx: fx(p.bx, p.by), by: fy(p.bx, p.by) };
    const y = fy(p.x, p.y), d = y - p.y;
    if (p.k === "cut") return { ...p, x: fx(p.x, p.y), y };
    return { ...p, x: fx(p.x, p.y), y, yMin: p.yMin === undefined ? undefined : p.yMin + d, yMax: p.yMax === undefined ? undefined : p.yMax + d };
  });
}

/** Aplatit verticalement vers le sol (y = 0) : animal couché sur le flanc. */
export function squash(ps: Prim[], sy: number, dy = 0): Prim[] {
  const r = Math.sqrt(sy);
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: p.ay * sy + dy, by: p.by * sy + dy, ra: p.ra * r, rb: p.rb * r };
    if (p.k === "cut") return { ...p, y: p.y * sy + dy, ry: p.ry * sy };
    return { ...p, y: p.y * sy + dy, ry: p.ry * sy,
      yMin: p.yMin === undefined ? undefined : p.yMin * sy + dy, yMax: p.yMax === undefined ? undefined : p.yMax * sy + dy };
  });
}

const smooth = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

/**
 * Déroulé d'un coup (0..1) : armé (0-0.35), frappe (0.35-0.6), retour (0.6-1).
 * Renvoie l'élan (-1 armé .. 1 frappé) et l'instant de l'impact (0..1, max au milieu de la frappe).
 */
export function strike(t: number): { s: number; hit: number } {
  if (t < 0.35) return { s: -smooth(t / 0.35), hit: 0 };
  if (t < 0.6) { const u = (t - 0.35) / 0.25; return { s: -1 + 2 * smooth(u), hit: Math.sin(u * Math.PI) }; }
  return { s: 1 - smooth((t - 0.6) / 0.4), hit: 0 };
}

/** Réglages de pose de l'ankylosaure, déduits de l'action. */
interface AnkyloLook {
  /** Balancement de marche/respiration et abaissement du corps (couché, accroupi). */
  bob: number;
  drop: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  spread: number;
  headA: number;
  headDy: number;
  mouth: number;
  tailUp: number;
  tailFold: number;
  sway: number;
  eye: boolean;
}

export function ankyloModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.45 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3.2 : 1.2)) * (1 - moving) * (rest ? 1.8 : 1);
  const L: AnkyloLook = {
    bob: -Math.abs(Math.sin(walk)) * 2.5 * moving * amp * amp + breath * 1.2, drop: 0,
    legs: "walk", amp, spread: 0, headA: run ? 0.08 : 0, headDy: 0, mouth: 0, tailUp: 0, tailFold: 0,
    sway: Math.sin(time * 1.3) * 3 * (1 - moving) + Math.sin(walk) * 9 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.headA = 0.42 + chew * 0.04; L.headDy = 8; L.mouth = Math.max(0, chew) * 0.5; }
  else if (action === "drink") { L.headA = 0.55; L.headDy = 16; L.drop = 5; L.spread = 9; }
  else if (action === "rest") { L.drop = 23; L.legs = "tuck"; L.headA = 0.18; L.headDy = 12; L.sway *= 0.3; L.tailUp = -0.12; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.headA = -0.3 * k - 0.05; L.headDy = -4 * k; L.mouth = k; }
  else if (action === "defend") {
    L.drop = 7; L.headA = 0.2; L.headDy = 6; L.spread = 5;
    L.tailUp = 0.95 + Math.sin(time * 4) * 0.08; L.sway = 0;
  } else if (action === "attack") {
    const { s, hit } = strike(at);
    L.drop = 4 + hit * 3; L.headA = 0.12; L.headDy = 4; L.spread = 6;
    L.tailUp = s > 0 ? s * 1.35 : s * 0.35; L.tailFold = hit; L.sway = 0;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.1; L.tailUp = -0.08; L.sway = 0; L.bob = 0;
  }
  const P = ankyloParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc : corps aplati, pattes raides tendues vers le spectateur.
    const D = squash(P, 0.62, 2);
    for (const [hip, dir, z] of [[-55, -1, -40], [52, 1, -40], [-45, -1, 30], [62, 1, 30]] as const) {
      const up = z < 0 ? -14 : 0, fx = hip + dir * (z < 0 ? 30 : 24), fy = (z < 0 ? -10 : 12) + up;
      const m = z < 0 ? M.SkinFar : M.Skin;
      D.push(c(hip, -16, fx, fy, 13, 9, m, z, 10));
      D.push(e(fx + dir * 5, fy, 8, 7, m, z, 6));
      for (const t of [-5, 0, 5]) D.push(e(fx + dir * 12, fy + t * 0.8, 2.6, 2.2, M.Spike, z + 6, 2));
    }
    // Œil clos : un simple trait de paupière.
    D.push(c(118, -31, 126, -31, 1, 1, M.Plate, 60, 1, true));
    return D.map((p) => scalePrim(p, ANKYLO_SCALE));
  }
  return P.map((p) => scalePrim(p, ANKYLO_SCALE));
}

function ankyloParts(L: AnkyloLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop;
  const P: Prim[] = [];

  // --- Pattes (diagonales opposées en phase) ---
  const legs = [
    { hip: -55, phase: 0, far: true, front: false },
    { hip: 52, phase: Math.PI, far: true, front: true },
    { hip: -45, phase: Math.PI, far: false, front: false },
    { hip: 62, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? M.SkinFar : M.Skin;
    const z = G.far ? -60 : 24;
    if (L.legs === "tuck") {
      // Couché : pattes repliées, seuls les pieds dépassent sous le rebord.
      const fx = G.hip + (G.front ? 12 : -4);
      P.push(e(fx, -6, 18, 6, m, z, 6));
      for (const t of [-6, 2, 10]) P.push(e(fx + 14 + t * 0.4, -3, 3, 2.4, M.Spike, z + 6, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 7 * L.amp;
    const fx = G.hip + s * 14 + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : 0);
    P.push(c(G.hip, -36 + bob, fx, -8 - lift, 15, 12, m, z, 12));
    P.push(e(fx + 3, -6 - lift, 16, 7, m, z, 8));
    for (const t of [-6, 2, 10]) P.push(e(fx + 12 + t * 0.4, -3 - lift + Math.abs(t) * 0.1, 3, 2.6, M.Spike, z + 6, 2));
  }

  // --- Dôme de carapace ---
  const DX = 0, DY = -60 + bob, RX = 95, RY = 50, Z0 = 0;
  P.push(e(DX, DY, RX, RY, M.Armor, Z0, 40, undefined, -26 + bob));
  P.push(e(0, -30 + bob, 90, 13, M.Belly, 8, 10, -30 + bob));

  // Ostéodermes : trois rangées décalées qui suivent la courbe du dôme.
  const rows = [
    { s: 0.9, n: 10, r: 9 },
    { s: 0.66, n: 8, r: 10 },
    { s: 0.4, n: 6, r: 11 },
  ];
  rows.forEach((row, ri) => {
    for (let j = 0; j < row.n; j++) {
      const a = Math.PI * (0.06 + 0.88 * (j + (ri % 2) * 0.5) / row.n);
      const px = DX - Math.cos(a) * RX * row.s;
      const py = DY - Math.sin(a) * RY * row.s;
      const surf = 40 * Math.sqrt(Math.max(0, 1 - row.s * row.s));
      P.push(e(px, py, row.r, row.r * 0.7, M.Plate, Z0 + surf, 7));
    }
  });

  // Pointes dorsales le long du profil, plus longues sur les flancs.
  for (let j = 0; j < 13; j++) {
    const a = Math.PI * (0.05 + 0.9 * j / 12);
    const bx = DX - Math.cos(a) * RX * 0.97, by = DY - Math.sin(a) * RY * 0.97;
    const nx = -Math.cos(a) / RX, ny = -Math.sin(a) / RY, nl = Math.hypot(nx, ny);
    const flank = Math.abs(Math.cos(a));
    const len = 9 + flank * 12 + (j % 2) * 4;
    P.push(c(bx, by, bx + (nx / nl) * len, by + (ny / nl) * len, 5.5, 1.2, M.Spike, Z0 + 6, 5));
  }
  // Pointes latérales vers l'arrière, sous le rebord de la carapace.
  for (let x = -70; x <= 75; x += 24) {
    P.push(c(x, -30 + bob, x - 14, -19 + bob, 5, 1.2, M.Spike, 30, 4));
  }

  // --- Queue annelée et massue ---
  // La queue se courbe vers le haut (tailUp) ; tailFold = balayage vers le spectateur (raccourci, plus proche).
  const seg = (92 / 6) * (1 - L.tailFold * 0.35);
  const tail: [number, number][] = [[-88, -50 + bob]];
  for (let k = 1; k <= 6; k++) {
    const t = k / 6;
    const b = -0.065 + L.tailUp * (t + 0.15);
    const [px, py] = tail[k - 1];
    tail.push([px - Math.cos(b) * seg, py - Math.sin(b) * seg - L.bob / 6 + L.sway * (t * t - ((k - 1) / 6) ** 2)]);
  }
  const tz = L.tailFold * 34;
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 18 - k * 2, rb = 18 - (k + 1) * 2;
    P.push(c(ax, ay, bx, by, ra, rb, M.Armor, 4 + tz * k / 6, 14));
    P.push(e(bx, by - rb * 0.45, rb * 0.7, rb * 0.5, M.Plate, 4 + rb * 0.8 + tz * k / 6, 5));
    P.push(c(bx, by - rb * 0.7, bx + 4, by - rb - 6, 3.5, 1, M.Spike, 18 + tz * k / 6, 3));
  }
  const [tx, ty] = tail[6];
  const cs = 1 + L.tailFold * 0.3, cb = L.tailUp > 0.4 ? -6 : 0;
  P.push(e(tx - 12 * cs, ty + cb, 18 * cs, 15 * cs, M.Club, 8 + tz, 16));
  P.push(e(tx - 15 * cs, ty + cb - 10 * cs, 11 * cs, 8 * cs, M.Club, 14 + tz, 9));
  P.push(e(tx - 15 * cs, ty + cb + 10 * cs, 11 * cs, 8 * cs, M.Club, 14 + tz, 9));
  P.push(e(tx - 24 * cs, ty + cb, 8 * cs, 9 * cs, M.Club, 12 + tz, 8));

  // --- Cou et tête (pivot à la base du cou) ---
  const H: Prim[] = [];
  H.push(e(116, -45, 25, 18, M.Skin, 8, 18));
  H.push(e(110, -57, 17, 7, M.Plate, 22, 6));
  H.push(e(124, -56, 8, 5, M.Plate, 22, 5));
  if (L.mouth > 0.05) {
    // Bouche ouverte : mâchoire inférieure abaissée, intérieur sombre.
    H.push(e(137, -41, 13, 6, M.Skin, 10, 8));
    H.push(e(134, -33 + L.mouth * 2, 11, 2 + L.mouth * 3, M.Mouth, 20, 1));
    H.push(...turn([c(116, -34, 142, -31, 6, 3.5, M.Skin, 22, 5)], 112, -36, L.mouth * 0.35));
    H.push(c(146, -40, 153, -37, 3.5, 1.5, M.Spike, 16, 3));
  } else {
    H.push(e(139, -38, 12, 9, M.Skin, 10, 9));
    H.push(c(146, -36, 153, -33, 4, 1.5, M.Spike, 16, 3));
  }
  H.push(c(104, -56, 94, -66, 4.5, 1, M.Spike, 24, 4));
  H.push(c(108, -33, 98, -23, 4, 1, M.Spike, 24, 4));
  if (L.eye) H.push(e(122, -48, 3.5, 3.5, M.Eye, 40, 1));
  P.push(e(92, -46 + bob, 20, 17, M.Skin, 6, 18));
  P.push(...turn(H, 88, -46, L.headA, 0, bob + L.headDy));
  return P;
}

/**
 * Squelette (référence pour les autres espèces) : chaque primitive porte l'id de son os.
 * Même repère que le modèle, matière M.Bone (M.Socket pour les orbites).
 */
export function ankyloSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne : arc du cou au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    const x = 92 - t * 180;
    spine.push([x, -48 - Math.sin(t * Math.PI) * 26]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 5, 4, B, 10, 4));
  // Côtes : arcs fins qui descendent de la colonne vers le ventre.
  for (let k = 3; k <= 11; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 3, x + 4, y + 18, 1, 1, B, 8, 2, true), c(x + 4, y + 18, x + 1, -30, 1, 1, B, 8, 2, true));
  }
  // Ostéodermes : les plaques de la carapace sont de vrais os, ancrés dans la peau.
  for (let j = 0; j < 11; j++) {
    const a = Math.PI * (0.08 + 0.84 * j / 10);
    tag("carapace", e(-Math.cos(a) * 88, -60 - Math.sin(a) * 46, 6, 4, B, 14, 4));
  }
  // Bassin et membres postérieurs.
  tag("bassin", e(-50, -52, 18, 11, B, 12, 8), c(-62, -50, -36, -44, 3, 3, B, 12, 3));
  for (const [hx, z] of [[-55, 4], [-45, 16]] as const) {
    tag("patte-ar", c(hx, -48, hx + 4, -20, 5, 4, B, z, 4), c(hx + 4, -20, hx + 2, -6, 4, 3, B, z, 3), e(hx + 8, -4, 9, 3, B, z, 2));
  }
  // Omoplate et membres antérieurs.
  tag("patte-av", c(48, -66, 58, -44, 3, 3, B, 12, 3));
  for (const [hx, z] of [[52, 4], [62, 16]] as const) {
    tag("patte-av", c(hx, -44, hx + 3, -20, 4.5, 3.5, B, z, 4), c(hx + 3, -20, hx + 4, -6, 3.5, 3, B, z, 3), e(hx + 9, -4, 8, 3, B, z, 2));
  }
  // Queue : vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    tag("queue", e(-90 - t * 90, -50 + t * 6, 5 - t * 2, 4 - t * 1.5, B, 10, 3));
  }
  // Massue : boules osseuses soudées au bout de la queue.
  tag("massue", e(-192, -44, 16, 13, B, 12, 12), e(-196, -54, 9, 7, B, 14, 7), e(-196, -34, 9, 7, B, 14, 7));
  // Crâne : boîte crânienne, bec, cornes, orbite.
  tag("crane",
    e(116, -46, 22, 15, B, 12, 12), e(139, -39, 11, 7, B, 12, 7),
    c(104, -56, 94, -66, 4, 1, B, 16, 3), c(108, -33, 98, -23, 3.5, 1, B, 16, 3),
    e(122, -48, 4, 4, M.Socket, 30, 1), e(130, -40, 3, 2, M.Socket, 30, 1));
  return P.map((p) => scalePrim(p, ANKYLO_SCALE));
}

export const ANKYLO: Species = {
  id: "ankylo",
  name: "Ankylosaure",
  latin: "Ankylosaurus magniventris",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Hell Creek, Montana (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 6000,
  facts: [
    { id: "armure", title: "Un char d'assaut vivant", unlock: "discover",
      text: "Son dos est couvert d'ostéodermes : des plaques d'os qui poussent dans la peau. Même ses paupières étaient blindées." },
    { id: "squelette", title: "Des os dans la peau", unlock: "assemble",
      text: "Les plaques de la carapace ne sont pas reliées au squelette : elles sont noyées dans la peau, comme chez les crocodiles." },
    { id: "brouteur", title: "Brouteur au ras du sol", unlock: "eat",
      text: "Sa tête basse et large lui permettait de brouter fougères et petites plantes. Il ne pouvait pas atteindre les branches hautes." },
    { id: "massue", title: "La massue caudale", unlock: "defend",
      text: "Le bout de sa queue est une massue d'os soudés. Un coup bien placé pouvait briser la patte d'un tyrannosaure." },
    { id: "solitaire", title: "Plutôt solitaire", unlock: "rest",
      text: "On retrouve rarement plusieurs ankylosaures ensemble : bien protégé, il n'avait pas besoin de troupeau." },
    { id: "nid-cache", title: "Des œufs bien au chaud", unlock: "nest",
      text: "Les œufs d'ankylosaures sont très rares. Comme beaucoup de dinosaures, ils pondaient sans doute dans un trou creusé dans le sol, recouvert de terre et de plantes pour garder les œufs au chaud." },
    { id: "bebe-armure", title: "Une armure qui pousse", unlock: "baby",
      text: "Les bébés n'avaient pas encore leur blindage complet : les plaques d'os se formaient dans la peau en grandissant. Des jeunes Pinacosaurus, ses cousins, ont été retrouvés serrés en groupe." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "carapace", name: "Ostéodermes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Vertèbres de la queue" },
    { id: "massue", name: "Massue" },
  ],
  model: ankyloModel,
  skeleton: ankyloSkeleton,
  center: { x: 0, y: -55 * ANKYLO_SCALE },
  eye: { x: 122 * ANKYLO_SCALE, y: -48 * ANKYLO_SCALE },
  feet: [-55, -45, 52, 62].map((x) => x * ANKYLO_SCALE),
  halfLen: 150 * ANKYLO_SCALE,
  shadow: 0.95,
  walkSpeed: 28,
  runSpeed: 48,
  stride: 6,
  behavior: { diet: "herbivore", herd: [1, 1], browse: "low", prey: [], defense: "club", sight: 260, scavenger: false },
};
