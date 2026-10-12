import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, squash, strike, turn } from "./ankylo";
import { H } from "./herbivores.mat";
import type { Pose, Species } from "./types";

/**
 * Tricératops modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Le modèle brut mesure ~375 px du bout de la queue à la pointe des cornes ; on le ramène à sa taille réelle.
 */
const LENGTH_M = 9;
export const TRIKE_SCALE = (LENGTH_M * PX_PER_M) / 375;

interface TrikeLook {
  bob: number;
  drop: number;
  /** Avancée du corps (charge). */
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

export function trikeModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3.4 : 1.3)) * (1 - moving) * (rest ? 1.8 : 1);
  const L: TrikeLook = {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp * amp + breath * 1.3, drop: 0, dx: 0,
    legs: "walk", amp, spread: 0, headA: run ? 0.1 : 0, headDy: 0, mouth: 0,
    sway: Math.sin(time * 1.1) * 3 * (1 - moving) + Math.sin(walk) * 7 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.headA = 0.5 + chew * 0.04; L.headDy = 8; L.mouth = Math.max(0, chew) * 0.6; }
  else if (action === "drink") { L.headA = 0.62; L.headDy = 12; L.drop = 5; L.spread = 10; }
  else if (action === "rest") { L.drop = 34; L.legs = "tuck"; L.headA = 0.22; L.headDy = 8; L.sway *= 0.3; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.headA = -0.28 * k; L.headDy = -4 * k; L.mouth = k; }
  else if (action === "defend") {
    // Tête basse, cornes pointées, collerette dressée face au prédateur ; piétine sur place.
    L.drop = 6; L.headA = 0.3 + Math.sin(time * 3) * 0.03; L.headDy = 6; L.spread = 8; L.sway = 0;
  } else if (action === "attack") {
    // Charge : recul, puis poussée des cornes vers l'avant et vers le haut.
    const { s, hit } = strike(at);
    L.dx = s * 14; L.drop = 5 + hit * 3; L.spread = 6 + s * 6;
    L.headA = 0.36 - Math.max(0, s) * 0.22 + Math.min(0, s) * -0.05; L.headDy = 6 - hit * 4;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.15; L.sway = 0; L.bob = 0;
  }
  const P = trikeParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc : corps aplati, pattes raides tendues.
    const D = squash(P, 0.6, 2);
    for (const [hip, dir, far] of [[-50, -1, true], [58, 1, true], [-40, -1, false], [66, 1, false]] as const) {
      const fx = hip + dir * (far ? 34 : 26), fy = far ? -26 : 12, m = far ? H.TFar : H.TSkin, z = far ? -40 : 34;
      D.push(c(hip, -22, fx, fy, 16, 11, m, z, 12));
      D.push(e(fx + dir * 5, fy, 9, 8, m, z, 6));
      for (const t of [-5, 0, 5]) D.push(e(fx + dir * 13, fy + t * 0.9, 2.8, 2.4, H.THorn, z + 6, 2));
    }
    D.push(c(137, -50, 146, -50, 1, 1, H.TStripe, 80, 1, true));
    return D.map((p) => scalePrim(p, TRIKE_SCALE));
  }
  return P.map((p) => scalePrim(p, TRIKE_SCALE));
}

function trikeParts(L: TrikeLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop, X = L.dx;
  const P: Prim[] = [];

  // --- Pattes : piliers massifs, ongles en sabots ---
  const legs = [
    { hip: -50, phase: 0, far: true, front: false },
    { hip: 58, phase: Math.PI, far: true, front: true },
    { hip: -40, phase: Math.PI, far: false, front: false },
    { hip: 66, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? H.TFar : H.TSkin;
    const z = G.far ? -70 : 30;
    const hx = G.hip + X;
    if (L.legs === "tuck") {
      const fx = hx + (G.front ? 16 : -2);
      P.push(e(fx, -7, 22, 7, m, z, 7));
      for (const t of [-6, 1, 8]) P.push(e(fx + 18 + t * 0.4, -4, 3, 2.6, H.THorn, z + 6, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 8 * L.amp;
    const fx = G.hip + s * 16 + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : -L.spread * 0.3) + X * 0.2;
    const hy = (G.front ? -60 : -72) + bob;
    // Cuisse ou épaule, puis colonne jusqu'au pied (coude légèrement écarté à l'avant).
    P.push(e(hx, hy, G.front ? 20 : 26, G.front ? 24 : 32, m, z - 6, 16));
    const kx = (hx + fx) / 2 + (G.front ? 6 : -2), ky = (hy - 8 - lift) / 2;
    P.push(c(hx, hy + 6, kx, ky, G.front ? 15 : 18, 13, m, z, 13));
    P.push(c(kx, ky, fx, -9 - lift, 13, 11, m, z + 2, 11));
    P.push(e(fx + 3, -7 - lift, 15, 7, m, z + 2, 8));
    for (const t of [-6, 1, 8]) P.push(e(fx + 13 + t * 0.4, -4 - lift, 3, 2.6, H.THorn, z + 8, 2));
  }

  // --- Queue courte et épaisse ---
  const tail: [number, number][] = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    tail.push([-92 - t * 82 + X, -86 + bob * (1 - t) + L.drop * t + t * 30 + L.sway * t * t]);
  }
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 26 - k * 4.6, rb = 26 - (k + 1) * 4.6;
    P.push(c(ax, ay, bx, by, ra, Math.max(3, rb), H.TSkin, 2, 16));
    P.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.7, 4, ra * 0.35, H.TStripe, 2 + ra * 0.9, 3));
  }

  // --- Corps : bassin haut, épaules plus basses ---
  P.push(e(-8 + X, -82 + bob, 100, 44, H.TSkin, 0, 44));
  P.push(e(-42 + X, -90 + bob, 58, 36, H.TSkin, 6, 40));
  P.push(e(2 + X, -46 + bob, 84, 12, H.TBelly, 10, 12, -46 + bob));
  // Rayures sombres sur le dos, des hanches aux épaules.
  for (let j = 0; j < 7; j++) {
    const x = -92 + j * 25, top = -90 - 36 * Math.sqrt(Math.max(0, 1 - ((x + 30) / 110) ** 2));
    P.push(e(x + X, top + 14 + bob, 3.5, 11, H.TStripe, 34, 4));
  }
  // Grandes écailles en rosette sur le flanc (empreintes de peau fossiles).
  for (const [sx, sy, r] of [[-60, -82, 7], [-30, -74, 8], [0, -80, 7], [28, -72, 8], [-46, -60, 6], [12, -58, 6], [50, -78, 6], [-80, -72, 6]] as const) {
    P.push(e(sx + X, sy + bob, r, r * 0.75, H.TScale, 40, 4));
  }

  // --- Cou court, puis tête (pivot à la base du cou) ---
  P.push(e(90 + X, -70 + bob, 24, 26, H.TSkin, 8, 24));
  const T: Prim[] = [];
  // Collerette : éventail qui remonte vers l'arrière, ourlé d'épioccipitaux.
  const FX = 76, FY = -138, FR = 36;
  T.push(c(118, -92, FX, FY, 22, FR, H.TFrill, 10, 18));
  for (let j = 0; j < 9; j++) {
    const a = (Math.PI / 180) * (135 + j * 20);
    const bx = FX + Math.cos(a) * FR * 0.95, by = FY + Math.sin(a) * FR * 0.95;
    T.push(c(bx, by, bx + Math.cos(a) * 8, by + Math.sin(a) * 8, 4.5, 1.5, H.THorn, 24, 3));
  }
  // Motif de parade : ocelle sur la collerette.
  T.push(e(80, -134, 18, 19, H.TDisplay, 26, 6));
  T.push(e(81, -134, 8, 9, H.TFrill, 32, 4));
  // Face, joue, mâchoire, bec.
  T.push(c(118, -94, 170, -72, 24, 14, H.TSkin, 14, 18));
  T.push(e(132, -70, 16, 14, H.TSkin, 18, 12));
  T.push(c(134, -70, 140, -55, 5, 1.5, H.THorn, 30, 3));
  const jaw = L.mouth * 0.32;
  if (L.mouth > 0.05) T.push(e(160, -60 + L.mouth * 3, 18, 3 + L.mouth * 4, M.Mouth, 26, 1));
  T.push(...turn([c(138, -62, 180, -56, 9, 4, H.TSkin, 22, 7), c(178, -56, 190, -52, 4, 1.5, H.TBeak, 26, 3)], 132, -64, jaw));
  T.push(c(166, -72, 196, -60, 12, 3, H.TBeak, 22, 8));
  // Cornes : courte sur le nez, deux longues au-dessus des yeux (la lointaine plus haute, derrière).
  T.push(c(166, -80, 175, -97, 6, 1.5, H.THorn, 30, 4));
  T.push(c(134, -106, 190, -142, 7, 1.5, H.THorn, 6, 5));
  T.push(c(140, -100, 202, -130, 7.5, 1.5, H.THorn, 34, 5));
  T.push(e(138, -98, 10, 6, H.TSkin, 30, 5));
  if (L.eye) T.push(e(142, -90, 3.5, 3.5, M.Eye, 50, 1));
  P.push(...turn(T, 94, -84, L.headA, X, bob + L.headDy + 20));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function trikeSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne : du cou au bassin, point haut au-dessus des hanches.
  for (let k = 0; k <= 14; k++) {
    const t = k / 14, x = 90 - t * 180;
    tag("vertebres", e(x, -92 - Math.sin(t * Math.PI * 0.9) * 32 + t * 4, 5, 4, B, 10, 4));
  }
  for (let k = 3; k <= 10; k++) {
    const t = k / 14, x = 90 - t * 180, y = -92 - Math.sin(t * Math.PI * 0.9) * 32;
    tag("cotes", c(x, y + 3, x + 5, y + 26, 1, 1, B, 8, 2, true), c(x + 5, y + 26, x + 1, -52, 1, 1, B, 8, 2, true));
  }
  tag("bassin", e(-48, -104, 26, 14, B, 12, 8), c(-70, -100, -24, -92, 3, 3, B, 12, 3));
  for (const [hx, z] of [[-50, 4], [-40, 16]] as const) {
    tag("patte-ar", c(hx, -96, hx + 3, -44, 6, 5, B, z, 4), c(hx + 3, -44, hx, -8, 5, 4, B, z, 3), e(hx + 8, -5, 10, 3, B, z, 2));
  }
  tag("patte-av", c(52, -110, 62, -70, 4, 3, B, 12, 3));
  for (const [hx, z] of [[58, 4], [66, 16]] as const) {
    tag("patte-av", c(hx, -70, hx + 7, -38, 5, 4, B, z, 4), c(hx + 7, -38, hx + 2, -8, 4, 3.5, B, z, 3), e(hx + 9, -5, 9, 3, B, z, 2));
  }
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tag("queue", e(-94 - t * 80, -90 + t * 30, 5 - t * 2.5, 4 - t * 1.8, B, 10, 3));
  }
  // Crâne : collerette (os pariétal percé de deux fenêtres), cornes, bec.
  tag("collerette",
    c(118, -94, 90, -150, 9, 18, B, 12, 6), e(94, -140, 7, 10, M.Socket, 30, 1),
    ...Array.from({ length: 7 }, (_, j) => {
      const a = (Math.PI / 180) * (160 + j * 24);
      return e(90 + Math.cos(a) * 33, -150 + Math.sin(a) * 33, 4, 3, B, 14, 3);
    }));
  tag("crane",
    c(118, -94, 170, -72, 18, 10, B, 12, 10), c(166, -72, 196, -60, 9, 2, B, 14, 5), c(138, -62, 186, -55, 5, 2, B, 12, 4),
    e(142, -90, 5, 5, M.Socket, 30, 1), e(160, -78, 4, 3, M.Socket, 30, 1));
  tag("cornes", c(140, -100, 202, -130, 5, 1.2, B, 16, 4), c(166, -80, 175, -97, 4, 1.2, B, 16, 3));
  return P.map((p) => scalePrim(p, TRIKE_SCALE));
}

export const TRIKE: Species = {
  id: "trike",
  name: "Tricératops",
  latin: "Triceratops horridus",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Hell Creek, Montana et Dakota (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 9000,
  facts: [
    { id: "trois-cornes", title: "Trois cornes", unlock: "discover",
      text: "Son nom veut dire « visage à trois cornes » : deux longues cornes au-dessus des yeux, presque un mètre chacune, et une petite sur le nez." },
    { id: "collerette", title: "Une collerette osseuse", unlock: "assemble",
      text: "La collerette est un prolongement du crâne, bordée de petites bosses d'os appelées épioccipitaux. Son crâne est l'un des plus grands de tous les animaux terrestres." },
    { id: "bec", title: "Bec et ciseaux", unlock: "eat",
      text: "Il coupait les plantes avec un bec sans dents, puis les hachait avec des centaines de dents serrées en batteries, qui se remplaçaient toute sa vie." },
    { id: "parade", title: "Une collerette pour se montrer", unlock: "call",
      text: "Des traces de vaisseaux sanguins couvrent la collerette : elle était peut-être colorée et servait à impressionner ses rivaux ou à séduire." },
    { id: "cornes-defense", title: "Cornes contre dents", unlock: "defend",
      text: "On a trouvé des cornes de tricératops mordues par un tyrannosaure, et des collerettes portant des blessures de combats entre tricératops." },
    { id: "groupe", title: "En petits groupes ?", unlock: "herd",
      text: "On l'a longtemps cru solitaire, mais des gisements de plusieurs jeunes ensemble suggèrent qu'il vivait parfois en petits groupes." },
    { id: "hell-creek", title: "Star de Hell Creek", unlock: "drink",
      text: "C'est le dinosaure le plus courant de Hell Creek : on y a trouvé des centaines de crânes. Il a vécu jusqu'à la toute fin de l'ère des dinosaures." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "cornes", name: "Cornes" },
    { id: "collerette", name: "Collerette" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Vertèbres de la queue" },
  ],
  model: trikeModel,
  skeleton: trikeSkeleton,
  center: { x: 0, y: -85 * TRIKE_SCALE },
  eye: { x: 142 * TRIKE_SCALE, y: -90 * TRIKE_SCALE },
  feet: [-50, -40, 58, 66].map((x) => x * TRIKE_SCALE),
  halfLen: 180 * TRIKE_SCALE,
  shadow: 0.9,
  walkSpeed: 30,
  runSpeed: 62,
  stride: 6,
  behavior: { diet: "herbivore", herd: [2, 4], browse: "low", prey: [], defense: "horns", sight: 280, scavenger: false },
};
