import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, pillarLegs, quadLook, rot, squash, strike, taperedTail, type PillarLegSpec, type QuadLook } from "./kit";
import { H } from "./herbivores.mat";
import type { Pose, Species } from "./types";

/**
 * Tricératops modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Le modèle brut mesure ~375 px du bout de la queue à la pointe des cornes ; on le ramène à sa taille réelle.
 */
const LENGTH_M = 9;
export const TRIKE_SCALE = (LENGTH_M * PX_PER_M) / 375;

/** Pattes : piliers massifs, ongles en sabots. */
const LEGS: PillarLegSpec = {
  hips: [-50, 58, -40, 66], far: H.TFar, skin: H.TSkin, nail: H.THorn, swing: 16, lift: 8, frontY: -60, backY: -72,
  shoulder: [20, 24], thigh: [26, 32], thighH: 16, upper: [15, 18], upperB: 13, upperH: 13, lower: [13, 11, 11], foot: [15, 7],
  nailDx: 13, nailR: [3, 2.6], tuckDx: 16, tuckR: 22, tuckNailDx: 18,
};

export function trikeModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const L = quadLook(pose, { breath: 1.3, runHead: 0.1, swayFreq: 1.1, swayAmp: 7 });
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

function trikeParts(L: QuadLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop, X = L.dx;
  const P: Prim[] = [];
  pillarLegs(P, L, walk, moving, bob, LEGS);

  // --- Queue courte et épaisse ---
  taperedTail(P, L, bob, { x: -92, len: 82, y: -86, droop: 30, r: 26, step: 4.6, m: H.TSkin, h: 16 }, (k, ax, ay, bx, by, ra) => {
    P.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.7, 4, ra * 0.35, H.TStripe, 2 + ra * 0.9, 3));
  });

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
  T.push(...rot([c(138, -62, 180, -56, 9, 4, H.TSkin, 22, 7), c(178, -56, 190, -52, 4, 1.5, H.TBeak, 26, 3)], 132, -64, jaw));
  T.push(c(166, -72, 196, -60, 12, 3, H.TBeak, 22, 8));
  // Cornes : courte sur le nez, deux longues au-dessus des yeux (la lointaine plus haute, derrière).
  T.push(c(166, -80, 175, -97, 6, 1.5, H.THorn, 30, 4));
  T.push(c(134, -106, 190, -142, 7, 1.5, H.THorn, 6, 5));
  T.push(c(140, -100, 202, -130, 7.5, 1.5, H.THorn, 34, 5));
  T.push(e(138, -98, 10, 6, H.TSkin, 30, 5));
  if (L.eye) T.push(e(142, -90, 3.5, 3.5, M.Eye, 50, 1));
  P.push(...rot(T, 94, -84, L.headA, X, bob + L.headDy + 20));
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
    { id: "oeufs-mous", title: "Des œufs à coquille molle", unlock: "nest",
      text: "On n'a jamais trouvé d'œuf de tricératops. Mais son cousin Protoceratops pondait des œufs à coquille souple, comme les tortues : ils étaient sûrement enterrés sous la terre et les plantes pour rester humides et au chaud." },
    { id: "cornes-jeune", title: "Des cornes qui se retournent", unlock: "baby",
      text: "Chez les jeunes tricératops, les grandes cornes pointaient vers l'arrière. En grandissant, elles se redressaient puis se courbaient vers l'avant : on peut deviner l'âge d'un crâne à la forme de ses cornes." },
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
