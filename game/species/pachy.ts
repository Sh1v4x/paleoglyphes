import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, squash, strike, turn } from "./ankylo";
import { H } from "./herbivores.mat";
import type { Pose, Species } from "./types";

/**
 * Pachycéphalosaure modélisé en primitives (px locaux, regard vers la droite, origine au sol sous la hanche).
 * Bipède au crâne en dôme épais, couronné de bosses et de pointes.
 * Le modèle brut mesure ~280 px du bout de la queue au museau.
 */
const LENGTH_M = 4.5;
export const PACHY_SCALE = (LENGTH_M * PX_PER_M) / 280;

const HIP_X = 0, HIP_Y = -80;

interface PachyLook {
  bob: number;
  drop: number;
  /** Bascule du buste autour de la hanche (positif = penché en avant). */
  pitch: number;
  /** Avancée du corps (charge). */
  dx: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  headA: number;
  mouth: number;
  tailUp: number;
  sway: number;
  eye: boolean;
}

export function pachyModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 2.8 : 1)) * (1 - moving) * (rest ? 1.5 : 1);
  const L: PachyLook = {
    bob: -Math.abs(Math.cos(walk)) * 3 * moving * amp + breath, drop: 0, pitch: run ? 0.12 : 0, dx: 0,
    legs: "walk", amp, headA: run ? 0.1 : 0, mouth: 0, tailUp: 0,
    sway: Math.sin(time * 1.5) * 3 * (1 - moving) + Math.sin(walk) * 5 * moving, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.pitch = 0.42; L.headA = 0.75 + chew * 0.05; L.mouth = Math.max(0, chew) * 0.6; L.drop = 6; L.tailUp = -0.25; }
  else if (action === "drink") { L.pitch = 0.5; L.headA = 0.95; L.drop = 10; L.tailUp = -0.3; }
  else if (action === "rest") { L.drop = 54; L.legs = "tuck"; L.pitch = 0.05; L.headA = 0.2; L.tailUp = 0.25; L.sway *= 0.3; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.pitch = -0.15 * k; L.headA = -0.55 * k; L.mouth = k; }
  else if (action === "defend") {
    // Dôme pointé vers l'adversaire, accroupi, queue tendue en balancier.
    L.drop = 8; L.pitch = 0.3; L.headA = 0.9 + Math.sin(time * 4) * 0.05; L.tailUp = -0.3;
  } else if (action === "attack") {
    // Coup de tête : recul, puis charge dôme en avant, corps à l'horizontale.
    const { s, hit } = strike(at);
    L.dx = s * 16; L.drop = 6 + hit * 2; L.pitch = 0.3 + Math.max(0, s) * 0.2 - Math.max(0, -s) * 0.15;
    L.headA = 0.9 + Math.max(0, s) * 0.35; L.tailUp = -0.3 - Math.max(0, s) * 0.2;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.pitch = 0.1; L.headA = 0.5; L.sway = 0; L.bob = 0;
  }
  const P = pachyParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc, pattes raides.
    const D = squash(P, 0.5, 2);
    for (const [hx, far] of [[0, true], [6, false]] as const) {
      const m = far ? H.PFar : H.PSkin, z = far ? -40 : 40, fy = far ? -18 : 6;
      D.push(c(hx, -38, hx + 30, fy, 12, 6, m, z, 8));
      D.push(c(hx + 30, fy, hx + 44, fy - 2, 5, 3, m, z, 4));
      D.push(c(hx + 44, fy - 2, hx + 52, fy, 1, 1, M.Claw, z + 6, 2, true));
    }
    return D.map((p) => scalePrim(p, PACHY_SCALE));
  }
  return P.map((p) => scalePrim(p, PACHY_SCALE));
}

function pachyParts(L: PachyLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop, X = L.dx;
  const P: Prim[] = [];

  // --- Pattes : cuisse, jambe, métatarse, orteils ---
  for (const G of [{ dx: 4, phase: 0, far: true }, { dx: 0, phase: Math.PI, far: false }]) {
    const m = G.far ? H.PFar : H.PSkin, z = G.far ? -40 : 26;
    const hx = HIP_X + G.dx + X, hy = HIP_Y + 4 + bob;
    if (L.legs === "tuck") {
      // Accroupi : cuisse repliée, pied à plat vers l'avant.
      P.push(e(hx + 4, -16, 22, 15, m, z, 14));
      P.push(c(hx - 10, -6, hx + 26, -5, 6, 4, m, z + 2, 4));
      P.push(c(hx + 26, -5, hx + 34, -4, 1, 1, M.Claw, z + 6, 2, true));
      continue;
    }
    if (L.legs === "none") continue;
    const ph = walk + G.phase;
    const sw = Math.sin(ph) * moving * L.amp;
    const lift = Math.max(0, Math.cos(ph)) * moving * 9 * L.amp;
    const fx = hx + 6 + sw * 22 - X * 0.5, fy = -3 - lift;
    const ax = fx - 10, ay = fy - 18 + lift * 0.3;
    const kx = (hx + ax) / 2 + 14, ky = (hy + ay) / 2 - 2;
    P.push(e(hx + 2, hy - 2, 20, 25, m, z - 4, 16));
    P.push(c(hx, hy + 4, kx, ky, 14, 9, m, z, 11));
    P.push(c(kx, ky, ax, ay, 9, 6, m, z + 2, 7));
    P.push(c(ax, ay, fx, fy, 6, 5, m, z + 3, 5));
    P.push(c(fx - 2, fy, fx + 13, fy + 1, 5, 3, m, z + 3, 4));
    P.push(c(fx + 13, fy + 1, fx + 17, fy + 2, 1, 1, M.Claw, z + 8, 2, true));
  }

  // --- Queue raide, en balancier ---
  const Q: Prim[] = [];
  const tail: [number, number][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    tail.push([-24 - t * 128, -86 + t * 4 + L.sway * t * t]);
  }
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 17 - k * 2.4, rb = 17 - (k + 1) * 2.4;
    Q.push(c(ax, ay, bx, by, ra, Math.max(2, rb), H.PSkin, 2, 12));
    if (k % 2 === 0) Q.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.3, 3, ra * 0.6, H.PStripe, 2 + ra, 3));
  }
  P.push(...turn(Q, HIP_X, HIP_Y, -L.tailUp, X, bob));

  // --- Buste : corps, bras, cou et tête, qui basculent autour de la hanche ---
  const B: Prim[] = [];
  B.push(e(16, -86, 50, 27, H.PSkin, 0, 26));
  B.push(e(22, -68, 38, 8, H.PBelly, 8, 8, -68));
  for (let j = 0; j < 5; j++) B.push(e(-18 + j * 15, -104, 3, 8, H.PStripe, 24, 3));
  for (const [sx, sy] of [[-10, -90], [14, -94], [36, -86], [4, -76]] as const) B.push(e(sx, sy, 3.5, 3, H.PFar, 28, 2));
  // Petits bras à cinq doigts.
  B.push(c(54, -80, 62, -66, 5, 3.5, H.PSkin, 20, 4));
  B.push(c(62, -66, 72, -66, 3.5, 2.5, H.PSkin, 22, 3));
  B.push(c(72, -66, 76, -62, 1, 1, M.Claw, 26, 2, true));
  B.push(c(54, -92, 78, -104, 14, 11, H.PSkin, 6, 12));

  // Tête : dôme osseux massif, bosses et pointes à l'arrière et sur le museau.
  const T: Prim[] = [];
  T.push(c(84, -104, 120, -94, 12, 6, H.PSkin, 8, 10));
  if (L.mouth > 0.05) T.push(e(110, -90 + L.mouth * 2, 10, 1.5 + L.mouth * 3, M.Mouth, 20, 1));
  T.push(...turn([c(88, -94, 116, -88, 5, 3, H.PSkin, 18, 4)], 86, -96, L.mouth * 0.35));
  T.push(e(122, -95, 4, 4, H.PKnob, 18, 3));
  T.push(e(91, -119, 25, 22, H.PDome, 14, 22, undefined, -105));
  // Motif du dôme : bandes et taches.
  T.push(e(82, -128, 5, 8, H.PDomePat, 36, 2));
  T.push(e(97, -131, 4, 8, H.PDomePat, 36, 2));
  T.push(e(91, -111, 21, 3.5, H.PDomePat, 32, 2));
  // Couronne de bosses et de pointes autour de l'arrière du crâne.
  for (let j = 0; j < 6; j++) {
    const a = (Math.PI / 180) * (110 + j * 18);
    const bx = 91 + Math.cos(a) * 24, by = -107 + Math.sin(a) * 10;
    const len = j >= 3 ? 9 : 5;
    T.push(c(bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len * 0.6, 3.5, 1, H.PKnob, 26, 3));
  }
  for (const nx of [106, 113]) T.push(c(nx, -102, nx + 2, -107, 2.5, 1, H.PKnob, 22, 2));
  if (L.eye) T.push(e(104, -107, 3, 3, M.Eye, 40, 1));
  B.push(...turn(T, 80, -102, L.headA));
  P.push(...turn(B, HIP_X, HIP_Y, L.pitch, X, bob));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function pachySkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  for (let k = 0; k <= 10; k++) {
    const t = k / 10, x = 74 - t * 98;
    tag("vertebres", e(x, -96 - Math.sin(t * Math.PI) * 12, 4, 3.5, B, 10, 3));
  }
  for (let k = 2; k <= 7; k++) {
    const t = k / 10, x = 74 - t * 98, y = -96 - Math.sin(t * Math.PI) * 12;
    tag("cotes", c(x, y + 3, x + 4, y + 16, 1, 1, B, 8, 2, true), c(x + 4, y + 16, x + 1, -68, 1, 1, B, 8, 2, true));
  }
  tag("bassin", e(0, -86, 18, 9, B, 12, 6), c(-14, -84, 14, -80, 2.5, 2.5, B, 12, 2));
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("patte-ar", c(hx, -80, hx + 14, -50, 5, 4, B, z, 4), c(hx + 14, -50, hx - 4, -22, 4, 3, B, z, 3),
      c(hx - 4, -22, hx + 6, -4, 3, 2.5, B, z, 2), c(hx + 6, -4, hx + 20, -3, 2.5, 2, B, z, 2));
  }
  tag("bras", c(54, -82, 62, -66, 2.5, 2, B, 12, 2), c(62, -66, 74, -64, 2, 1.5, B, 12, 2));
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    tag("queue", e(-26 - t * 124, -88 + t * 4, 4 - t * 2, 3.5 - t * 1.5, B, 10, 3));
  }
  // Treillis de tendons ossifiés qui raidissent la queue.
  tag("queue", c(-30, -94, -130, -88, 1, 1, B, 9, 2, true), c(-30, -82, -130, -80, 1, 1, B, 9, 2, true));
  // Le dôme : jusqu'à 25 cm d'os massif.
  tag("dome", e(92, -118, 20, 17, B, 14, 18, undefined, -106));
  tag("crane", c(84, -104, 120, -94, 9, 4, B, 12, 6), c(88, -94, 116, -88, 3, 2, B, 12, 3),
    ...[0, 1, 2, 3, 4].map((j) => {
      const a = (Math.PI / 180) * (115 + j * 20);
      return e(92 + Math.cos(a) * 22, -108 + Math.sin(a) * 10, 3, 2.5, B, 16, 2);
    }),
    e(104, -107, 3.5, 3.5, M.Socket, 30, 1));
  return P.map((p) => scalePrim(p, PACHY_SCALE));
}

export const PACHY: Species = {
  id: "pachy",
  name: "Pachycéphalosaure",
  latin: "Pachycephalosaurus wyomingensis",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Hell Creek, Montana et Dakota (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 400,
  facts: [
    { id: "tete-epaisse", title: "Tête épaisse", unlock: "discover",
      text: "Son nom veut dire « lézard à tête épaisse ». Le haut de son crâne forme un dôme d'os massif qui pouvait atteindre 25 cm d'épaisseur." },
    { id: "dome-os", title: "Un casque d'os plein", unlock: "assemble",
      text: "On retrouve souvent son dôme seul : très solide, il se fossilise mieux que le reste du squelette. Il est entouré de bosses et de pointes osseuses." },
    { id: "coup-de-tete", title: "Coups de tête ?", unlock: "attack",
      text: "On a longtemps imaginé des duels front contre front, comme les béliers. Certains dômes portent des blessures guéries, signe qu'ils s'en servaient vraiment." },
    { id: "flanc", title: "Ou coups dans les flancs", unlock: "defend",
      text: "D'autres chercheurs pensent qu'il frappait plutôt les flancs de ses rivaux ou de ses ennemis : un dôme arrondi glisse quand deux têtes se cognent." },
    { id: "croissance", title: "Les jeunes avaient des pointes", unlock: "herd",
      text: "Stygimoloch et Dracorex, aux longues cornes et au dôme plat, sont peut-être des jeunes pachycéphalosaures : leur crâne changeait beaucoup en grandissant." },
    { id: "regime", title: "Que mangeait-il ?", unlock: "eat",
      text: "Ses petites dents en forme de feuille coupaient feuilles, graines et fruits. Certains pensent qu'il croquait aussi des insectes, mais il était surtout herbivore." },
    { id: "oeuf-mystere", title: "Un œuf encore inconnu", unlock: "nest",
      text: "Aucun œuf de pachycéphalosaure n'a encore été trouvé ! On pense qu'il pondait comme ses cousins à bec, dans un nid creusé au sol. À toi peut-être de découvrir le premier." },
    { id: "tete-plate", title: "Le dôme pousse plus tard", unlock: "baby",
      text: "Les jeunes pachycéphalosaures avaient la tête presque plate. Leur dôme ne gonflait qu'en grandissant, pendant que les pointes autour de leur crâne raccourcissaient." },
  ],
  bones: [
    { id: "dome", name: "Dôme crânien" },
    { id: "crane", name: "Crâne et mâchoires" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Queue" },
  ],
  model: pachyModel,
  skeleton: pachySkeleton,
  center: { x: 10 * PACHY_SCALE, y: -84 * PACHY_SCALE },
  eye: { x: 104 * PACHY_SCALE, y: -107 * PACHY_SCALE },
  feet: [8, 12].map((x) => x * PACHY_SCALE),
  halfLen: 135 * PACHY_SCALE,
  shadow: 0.7,
  walkSpeed: 32,
  runSpeed: 78,
  stride: 8,
  behavior: { diet: "herbivore", herd: [2, 3], browse: "low", prey: [], defense: "headbutt", sight: 300, scavenger: false },
};
