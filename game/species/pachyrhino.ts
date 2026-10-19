import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { c, e, squash, strike, turn } from "./ankylo";
import { PR } from "./pachyrhino.mat";
import type { Pose, Species } from "./types";

/**
 * Pachyrhinosaure modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Pas de grandes cornes : une bosse osseuse plate sur le nez, deux plus petites au-dessus des yeux, et une
 * collerette courte surmontée de deux pointes courbes. Le modèle brut mesure ~340 px ; on le ramène à 6 m.
 */
const LENGTH_M = 6;
export const PACHYRHINO_SCALE = (LENGTH_M * PX_PER_M) / 340;

interface PachyrhinoLook {
  bob: number;
  drop: number;
  /** Avancée du corps (poussée). */
  dx: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  spread: number;
  headA: number;
  headDy: number;
  mouth: number;
  sway: number;
  eye: boolean;
}

export function pachyrhinoModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3.4 : 1.2)) * (1 - moving) * (rest ? 1.8 : 1);
  const L: PachyrhinoLook = {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp * amp + breath * 1.3, drop: 0, dx: 0,
    legs: "walk", amp, spread: 0, headA: run ? 0.12 : 0, headDy: 0, mouth: 0,
    sway: Math.sin(time * 1.2) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.headA = 0.52 + chew * 0.04; L.headDy = 8; L.mouth = Math.max(0, chew) * 0.6; }
  else if (action === "drink") { L.headA = 0.64; L.headDy = 12; L.drop = 5; L.spread = 10; }
  else if (action === "rest") { L.drop = 30; L.legs = "tuck"; L.headA = 0.24; L.headDy = 8; L.sway *= 0.3; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.headA = -0.3 * k; L.headDy = -4 * k; L.mouth = k; }
  else if (action === "defend") {
    // Tête très basse, bosse en avant comme un bélier, pointes de la collerette dressées ; piétine.
    L.drop = 7; L.headA = 0.42 + Math.sin(time * 3) * 0.03; L.headDy = 8; L.spread = 8; L.sway = 0;
  } else if (action === "attack") {
    // Coup de bosse : recul, puis poussée tête basse droit devant (front contre front).
    const { s, hit } = strike(at);
    L.dx = s * 16; L.drop = 6 + hit * 3; L.spread = 6 + s * 6;
    L.headA = 0.44 + Math.max(0, s) * 0.06 - Math.min(0, s) * 0.08; L.headDy = 8 - hit * 2;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.15; L.sway = 0; L.bob = 0;
  }
  const P = pachyrhinoParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc : corps aplati, pattes raides tendues.
    const D = squash(P, 0.6, 2);
    for (const [hip, dir, far] of [[-46, -1, true], [52, 1, true], [-36, -1, false], [60, 1, false]] as const) {
      const fx = hip + dir * (far ? 32 : 24), fy = far ? -24 : 11, m = far ? PR.Far : PR.Skin, z = far ? -40 : 34;
      D.push(c(hip, -20, fx, fy, 15, 10, m, z, 12));
      D.push(e(fx + dir * 5, fy, 8, 7, m, z, 6));
      for (const t of [-5, 0, 5]) D.push(e(fx + dir * 12, fy + t * 0.9, 2.6, 2.2, PR.Spike, z + 6, 2));
    }
    D.push(c(126, -46, 134, -46, 1, 1, PR.Mottle, 80, 1, true));
    return D.map((p) => scalePrim(p, PACHYRHINO_SCALE));
  }
  return P.map((p) => scalePrim(p, PACHYRHINO_SCALE));
}

function pachyrhinoParts(L: PachyrhinoLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop, X = L.dx;
  const P: Prim[] = [];

  // --- Pattes : piliers trapus, ongles en sabots ---
  const legs = [
    { hip: -46, phase: 0, far: true, front: false },
    { hip: 52, phase: Math.PI, far: true, front: true },
    { hip: -36, phase: Math.PI, far: false, front: false },
    { hip: 60, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? PR.Far : PR.Skin;
    const z = G.far ? -70 : 30;
    const hx = G.hip + X;
    if (L.legs === "tuck") {
      const fx = hx + (G.front ? 14 : -2);
      P.push(e(fx, -7, 20, 7, m, z, 7));
      for (const t of [-6, 1, 8]) P.push(e(fx + 16 + t * 0.4, -4, 2.8, 2.4, PR.Spike, z + 6, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 7 * L.amp;
    const fx = G.hip + s * 14 + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : -L.spread * 0.3) + X * 0.2;
    const hy = (G.front ? -56 : -66) + bob;
    // Cuisse ou épaule, puis colonne jusqu'au pied (coude écarté à l'avant).
    P.push(e(hx, hy, G.front ? 18 : 24, G.front ? 22 : 29, m, z - 6, 15));
    const kx = (hx + fx) / 2 + (G.front ? 6 : -2), ky = (hy - 8 - lift) / 2;
    P.push(c(hx, hy + 6, kx, ky, G.front ? 14 : 17, 12, m, z, 12));
    P.push(c(kx, ky, fx, -9 - lift, 12, 10, m, z + 2, 10));
    P.push(e(fx + 3, -7 - lift, 14, 7, m, z + 2, 8));
    for (const t of [-6, 1, 8]) P.push(e(fx + 12 + t * 0.4, -4 - lift, 2.8, 2.4, PR.Spike, z + 8, 2));
  }

  // --- Queue courte, portée bas ---
  const tail: [number, number][] = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    tail.push([-86 - t * 74 + X, -80 + bob * (1 - t) + L.drop * t + t * 34 + L.sway * t * t]);
  }
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 24 - k * 4.2, rb = 24 - (k + 1) * 4.2;
    P.push(c(ax, ay, bx, by, ra, Math.max(3, rb), PR.Skin, 2, 15));
    if (k % 2 === 0) P.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.5, ra * 0.5, ra * 0.3, PR.Mottle, 2 + ra * 0.9, 3));
  }

  // --- Corps : tonneau trapu, dos plus rond que celui du tricératops ---
  P.push(e(-6 + X, -78 + bob, 92, 42, PR.Skin, 0, 42));
  P.push(e(-36 + X, -86 + bob, 54, 34, PR.Skin, 6, 38));
  P.push(e(2 + X, -44 + bob, 78, 11, PR.Belly, 10, 11, -44 + bob));
  // Grandes taches sombres sur le dos (camouflage dans la toundra).
  for (const [sx, sy, rx, ry] of [[-70, -104, 14, 8], [-36, -112, 16, 8], [0, -108, 15, 7], [34, -100, 13, 7], [-52, -90, 9, 5], [14, -92, 10, 5]] as const) {
    P.push(e(sx + X, sy + bob, rx, ry, PR.Mottle, 36, 4));
  }
  // Écailles en rosette sur le flanc.
  for (const [sx, sy, r] of [[-56, -74, 6], [-26, -66, 7], [4, -72, 6], [30, -64, 7], [-42, -54, 5], [14, -52, 5], [-76, -66, 5]] as const) {
    P.push(e(sx + X, sy + bob, r, r * 0.75, PR.Scale, 40, 4));
  }

  // --- Cou court, puis tête (pivot à la base du cou) ---
  P.push(e(84 + X, -66 + bob, 22, 24, PR.Skin, 8, 22));
  const T: Prim[] = [];
  // Collerette : courte et dressée, ourlée de petites cornes.
  const FX = 80, FY = -126, FR = 28;
  T.push(c(112, -88, FX, FY, 20, FR, PR.Frill, 10, 16));
  for (let j = 0; j < 6; j++) {
    const a = (Math.PI / 180) * (150 + j * 22);
    const bx = FX + Math.cos(a) * FR * 0.95, by = FY + Math.sin(a) * FR * 0.95;
    T.push(c(bx, by, bx + Math.cos(a) * 6, by + Math.sin(a) * 6, 3.5, 1.2, PR.Spike, 24, 3));
  }
  // Bandes de parade sur la collerette.
  T.push(e(80, -130, 15, 14, PR.Pattern, 26, 6));
  T.push(e(81, -130, 9, 8, PR.Frill, 30, 4));
  T.push(e(81, -130, 4, 4, PR.Pattern, 34, 3));
  // Deux grandes pointes courbes au sommet : partent vers le haut puis se recourbent vers l'arrière.
  // La lointaine est décalée et derrière la collerette.
  for (const [ox, z] of [[-6, 4], [0, 36]] as const) {
    T.push(c(92 + ox, -150, 90 + ox, -172, 6, 4, PR.Spike, z, 5));
    T.push(c(90 + ox, -172, 76 + ox, -186, 4, 1.5, PR.Spike, z, 4));
  }
  // Petite corne au milieu de la collerette (« licorne » du pariétal).
  T.push(c(102, -138, 110, -150, 3.5, 1.2, PR.Spike, 30, 3));
  // Face, joue, mâchoire, bec.
  T.push(c(112, -90, 160, -70, 23, 14, PR.Skin, 14, 18));
  T.push(e(126, -68, 15, 13, PR.Skin, 18, 12));
  T.push(c(128, -68, 133, -54, 5, 1.5, PR.Spike, 30, 3));
  const jaw = L.mouth * 0.32;
  if (L.mouth > 0.05) T.push(e(152, -58 + L.mouth * 3, 16, 3 + L.mouth * 4, M.Mouth, 26, 1));
  T.push(...turn([c(132, -60, 170, -54, 8, 4, PR.Skin, 22, 7), c(168, -54, 180, -50, 4, 1.5, PR.Beak, 26, 3)], 126, -62, jaw));
  T.push(c(158, -68, 186, -58, 11, 3, PR.Beak, 22, 8));
  // Bosse nasale : énorme coussin d'os rugueux, plat, du museau jusqu'entre les yeux.
  T.push(e(152, -86, 22, 10, PR.Boss, 40, 10));
  T.push(e(162, -84, 12, 8, PR.Boss, 44, 8));
  // Petites bosses au-dessus des yeux.
  T.push(e(132, -100, 9, 6, PR.Boss, 40, 6));
  if (L.eye) T.push(e(134, -88, 3.5, 3.5, M.Eye, 50, 1));
  P.push(...turn(T, 88, -80, L.headA, X, bob + L.headDy + 20));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function pachyrhinoSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne : du cou au bassin, point haut au-dessus des hanches.
  for (let k = 0; k <= 13; k++) {
    const t = k / 13, x = 84 - t * 168;
    tag("vertebres", e(x, -88 - Math.sin(t * Math.PI * 0.9) * 30 + t * 4, 5, 4, B, 10, 4));
  }
  for (let k = 3; k <= 9; k++) {
    const t = k / 13, x = 84 - t * 168, y = -88 - Math.sin(t * Math.PI * 0.9) * 30;
    tag("cotes", c(x, y + 3, x + 5, y + 24, 1, 1, B, 8, 2, true), c(x + 5, y + 24, x + 1, -50, 1, 1, B, 8, 2, true));
  }
  tag("bassin", e(-44, -98, 24, 13, B, 12, 8), c(-64, -94, -22, -87, 3, 3, B, 12, 3));
  for (const [hx, z] of [[-46, 4], [-36, 16]] as const) {
    tag("patte-ar", c(hx, -90, hx + 3, -42, 6, 5, B, z, 4), c(hx + 3, -42, hx, -8, 5, 4, B, z, 3), e(hx + 8, -5, 9, 3, B, z, 2));
  }
  tag("patte-av", c(48, -104, 56, -66, 4, 3, B, 12, 3));
  for (const [hx, z] of [[52, 4], [60, 16]] as const) {
    tag("patte-av", c(hx, -66, hx + 6, -36, 5, 4, B, z, 4), c(hx + 6, -36, hx + 2, -8, 4, 3.5, B, z, 3), e(hx + 8, -5, 8, 3, B, z, 2));
  }
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tag("queue", e(-88 - t * 72, -86 + t * 32, 5 - t * 2.5, 4 - t * 1.8, B, 10, 3));
  }
  // Crâne : collerette (pariétal percé de deux fenêtres) et ses pointes courbes, bec.
  tag("collerette",
    c(112, -90, 86, -134, 8, 16, B, 12, 6), e(88, -128, 6, 8, M.Socket, 30, 1),
    c(94, -146, 92, -168, 4, 3, B, 14, 4), c(92, -168, 78, -182, 3, 1.2, B, 14, 3),
    c(102, -138, 110, -150, 3, 1, B, 14, 3),
    ...Array.from({ length: 5 }, (_, j) => {
      const a = (Math.PI / 180) * (160 + j * 24);
      return e(86 + Math.cos(a) * 26, -134 + Math.sin(a) * 26, 3.5, 2.5, B, 14, 3);
    }));
  tag("crane",
    c(112, -90, 160, -70, 17, 10, B, 12, 10), c(158, -68, 186, -58, 8, 2, B, 14, 5), c(132, -60, 176, -53, 5, 2, B, 12, 4),
    e(134, -88, 5, 5, M.Socket, 30, 1), e(150, -74, 4, 3, M.Socket, 30, 1));
  tag("bosse", e(152, -86, 20, 8, B, 16, 8), e(132, -100, 8, 5, B, 16, 5));
  return P.map((p) => scalePrim(p, PACHYRHINO_SCALE));
}

export const PACHYRHINO: Species = {
  id: "pachyrhino",
  name: "Pachyrhinosaure",
  latin: "Pachyrhinosaurus perotorum",
  period: "Crétacé supérieur, 70 Ma",
  place: "Formation de Prince Creek, Alaska (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 3000,
  facts: [
    { id: "nez-epais", title: "Le lézard au nez épais", unlock: "discover",
      text: "Son nom veut dire « lézard au nez épais ». Au lieu d'une corne sur le nez, il portait une énorme bosse d'os, plate et rugueuse, et deux plus petites au-dessus des yeux." },
    { id: "pointes", title: "Une collerette à pointes", unlock: "assemble",
      text: "Sa collerette, plus courte que celle du tricératops, était surmontée de deux grandes pointes courbes et de petites cornes. Chaque espèce de pachyrhinosaure avait son propre arrangement de pointes." },
    { id: "poussee", title: "Bosse contre bosse", unlock: "attack",
      text: "La bosse était sans doute couverte d'une épaisse couche de corne. Les mâles s'en servaient peut-être pour se pousser front contre front, comme le font aujourd'hui les bœufs musqués." },
    { id: "nanuq", title: "Gare au petit tyran", unlock: "defend",
      text: "En Alaska, il croisait Nanuqsaurus, un cousin du tyrannosaure plus petit que lui. Serrés en troupeau, tête basse, les pachyrhinosaures étaient difficiles à attaquer." },
    { id: "troupeau", title: "Des troupeaux entiers", unlock: "herd",
      text: "Au Canada, le gisement de Pipestone Creek contient des milliers d'os de pachyrhinosaures de tous les âges, morts ensemble : la preuve qu'ils vivaient en grands troupeaux." },
    { id: "nuit-polaire", title: "Dinosaure du Grand Nord", unlock: "rest",
      text: "Décrit en 2011 grâce à des fossiles d'Alaska, il vivait tout près du pôle Nord. L'hiver, le soleil disparaissait pendant des semaines : il faisait plus doux qu'aujourd'hui, mais il pouvait neiger." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "bosse", name: "Bosse nasale" },
    { id: "collerette", name: "Collerette à pointes" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Vertèbres de la queue" },
  ],
  model: pachyrhinoModel,
  skeleton: pachyrhinoSkeleton,
  center: { x: 0, y: -80 * PACHYRHINO_SCALE },
  eye: { x: 134 * PACHYRHINO_SCALE, y: -88 * PACHYRHINO_SCALE },
  feet: [-46, -36, 52, 60].map((x) => x * PACHYRHINO_SCALE),
  halfLen: 168 * PACHYRHINO_SCALE,
  shadow: 0.9,
  walkSpeed: 30,
  runSpeed: 64,
  stride: 6.8,
  behavior: { diet: "herbivore", herd: [3, 6], browse: "low", prey: [], defense: "horns", sight: 300, scavenger: false },
  biomes: [BIOME.Tundra],
};
