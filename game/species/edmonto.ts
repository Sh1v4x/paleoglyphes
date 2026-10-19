import { BIOME } from "../world/biomes";
import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, squash, strike, turn } from "./ankylo";
import { H } from "./herbivores.mat";
import type { Pose, Species } from "./types";

/**
 * Édmontosaure (hadrosaure « à bec de canard ») modélisé en primitives (px locaux, regard vers la droite,
 * origine au sol sous le ventre). Marche à quatre pattes, court sur les deux pattes arrière.
 * Le modèle brut mesure ~500 px du bout de la queue au bec.
 */
const LENGTH_M = 12;
export const EDMONTO_SCALE = (LENGTH_M * PX_PER_M) / 500;

/** Hanche : pivot du corps quand il se cabre. */
const HIP_X = -30, HIP_Y = -120;

interface EdmontoLook {
  bob: number;
  drop: number;
  /** Tangage du corps autour de la hanche (négatif = cabré, bipède). */
  pitch: number;
  /** Pattes avant : 1 = au sol, 0 = repliées sous la poitrine. */
  arms: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  spread: number;
  headA: number;
  headDy: number;
  mouth: number;
  /** Sac nasal gonflé (cri). */
  sac: number;
  sway: number;
  eye: boolean;
}

export function edmontoModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.6 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3.4 : 1.4)) * (1 - moving) * (rest ? 1.8 : 1);
  const L: EdmontoLook = {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp * amp + breath * 1.3, drop: 0, pitch: 0, arms: 1,
    legs: "walk", amp, spread: 0, headA: 0, headDy: 0, mouth: 0, sac: 0,
    sway: Math.sin(time * 1.2) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  // Course : bipède, corps à l'horizontale, bras repliés, tête tendue.
  if (run) { L.pitch = -0.12; L.arms = 0; L.headA = 0.18; }
  if (action === "eat") { L.headA = 0.78 + chew * 0.04; L.headDy = 12; L.mouth = Math.max(0, chew) * 0.6; L.spread = 6; }
  else if (action === "drink") { L.headA = 0.9; L.headDy = 18; L.drop = 6; L.spread = 14; }
  else if (action === "rest") { L.drop = 76; L.legs = "tuck"; L.headA = 0.35; L.headDy = 8; L.sway *= 0.3; }
  else if (action === "call") {
    // Tête levée, bouche ouverte et sac de peau gonflé autour des narines (hypothèse).
    const k = Math.sin(Math.min(1, at * 1.3) * Math.PI); L.headA = -0.35 * k; L.headDy = -6 * k; L.mouth = k; L.sac = k;
  } else if (action === "defend") {
    // Dressé sur ses pattes arrière, aux aguets, queue qui fouette.
    L.pitch = -0.3; L.arms = 0; L.headA = -0.12; L.sway = Math.sin(time * 5) * 10;
  } else if (action === "attack") {
    // Se cabre puis retombe de tout son poids sur les pattes avant.
    const { s, hit } = strike(at);
    L.pitch = s < 0 ? s * 0.42 : -0.42 * (1 - s) + hit * 0.06; L.arms = s < 0.3 ? 0 : 1;
    L.headA = 0.1 + Math.max(0, s) * 0.2; L.mouth = Math.max(0, -s) * 0.6;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.4; L.headDy = 20; L.sway = 0; L.bob = 0;
  }
  const P = edmontoParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc, cou rejeté, pattes raides.
    const D = squash(P, 0.55, 2);
    for (const [hip, dir, far, len] of [[-30, -1, true, 36], [80, 1, true, 30], [-20, -1, false, 44], [88, 1, false, 30]] as const) {
      const fx = hip + dir * len, fy = far ? -40 : 14, m = far ? H.EFar : H.ESkin, z = far ? -40 : 40;
      D.push(c(hip, -40, fx, fy, hip < 0 ? 18 : 8, hip < 0 ? 8 : 5, m, z, 10));
      D.push(e(fx + dir * 6, fy, 9, 5, m, z, 5));
    }
    D.push(c(146, -50, 154, -50, 1, 1, H.EStripe, 80, 1, true));
    return D.map((p) => scalePrim(p, EDMONTO_SCALE));
  }
  return P.map((p) => scalePrim(p, EDMONTO_SCALE));
}

function edmontoParts(L: EdmontoLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop;
  const P: Prim[] = [];

  // --- Pattes arrière : puissantes, trois doigts à sabots ---
  for (const G of [{ dx: 0, phase: 0, far: true }, { dx: 10, phase: Math.PI, far: false }]) {
    const m = G.far ? H.EFar : H.ESkin, z = G.far ? -70 : 40;
    const hx = HIP_X + G.dx, hy = HIP_Y + 10 + bob;
    if (L.legs === "tuck") {
      P.push(e(hx + 6, -24, 34, 22, m, z - 4, 18));
      P.push(e(hx + 34, -6, 22, 6, m, z, 6));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 10 * L.amp;
    const fx = hx + 8 + s * 24, fy = -4 - lift;
    const ax = fx - 12, ay = fy - 30 + lift * 0.2;
    const kx = (hx + ax) / 2 + 16, ky = (hy + ay) / 2;
    P.push(e(hx + 2, hy - 6, 32, 42, m, z - 2, 24));
    P.push(c(hx, hy, kx, ky, 20, 12, m, z, 14));
    P.push(c(kx, ky, ax, ay, 11, 8, m, z + 2, 9));
    P.push(c(ax, ay, fx, fy, 8, 7, m, z + 3, 7));
    P.push(e(fx + 8, fy + 1, 13, 5, m, z + 3, 5));
    for (const t of [-4, 3, 10]) P.push(e(fx + 16 + t * 0.3, fy + 1, 3, 2.4, H.EBill, z + 8, 2));
  }

  // --- Corps, queue, cou, tête et bras : tout ce qui bascule autour de la hanche ---
  const B: Prim[] = [];
  // Bras fins : au sol en marche, repliés quand il se dresse.
  for (const G of [{ dx: 0, phase: Math.PI, far: true }, { dx: 8, phase: 0, far: false }]) {
    if (L.legs !== "walk") break;
    const m = G.far ? H.EFar : H.ESkin, z = G.far ? -70 : 36;
    const sx = 76 + G.dx, sy = -88;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 8;
    const gx = sx + 8 + s * 18 + (G.far ? -L.spread * 0.5 : L.spread), gy = -4 - lift - bob;
    const ex = L.arms ? (sx + gx) / 2 + 6 : sx + 14, ey = L.arms ? (sy + gy) / 2 : sy + 26;
    const hx = L.arms ? gx : sx + 26, hy = L.arms ? gy : sy + 34;
    B.push(c(sx, sy, ex, ey, 10, 6, m, z, 7));
    B.push(c(ex, ey, hx, hy, 6, 4.5, m, z + 2, 5));
    B.push(e(hx + 4, hy, 7, 3.5, m, z + 2, 3));
  }

  // Queue longue et raide (tendons ossifiés), à peine balancée ; elle reste à l'horizontale quand il se dresse.
  const Q: Prim[] = [];
  const tail: [number, number][] = [];
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tail.push([-70 - t * 220, -124 + t * 6 + L.sway * t * t - (L.legs === "tuck" ? -t * 30 : 0)]);
  }
  for (let k = 0; k < 7; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 30 - k * 3.8, rb = 30 - (k + 1) * 3.8;
    Q.push(c(ax, ay, bx, by, ra, Math.max(3, rb), H.ESkin, 2, 18));
    Q.push(e((ax + bx) / 2, (ay + by) / 2 + ra * 0.55, (bx - ax) * -0.45, ra * 0.3, H.EBelly, 4 + ra * 0.7, 4));
    if (k % 2 === 0) Q.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.2, 4, ra * 0.7, H.EStripe, 4 + ra, 3));
    Q.push(e(ax, ay - ra * 0.92, 3.5, 3, H.EScale, 6 + ra * 0.6, 3));
  }

  // Corps : hanches hautes, poitrine plus basse, ventre pâle.
  B.push(e(-36, -120, 64, 50, H.ESkin, 4, 44));
  B.push(e(40, -104, 68, 44, H.ESkin, 0, 42));
  B.push(e(8, -72, 82, 12, H.EBelly, 12, 12, -72));
  // Rayures du dos et du flanc.
  for (let j = 0; j < 6; j++) {
    const x = -78 + j * 28, top = x < 0 ? -168 : -146;
    B.push(e(x, top + 22, 4, 18, H.EStripe, 40, 4));
  }
  // Crête dorsale charnue (vue sur les « momies ») et tubercules du flanc.
  for (let j = 0; j < 9; j++) {
    const x = -88 + j * 20, top = -120 - 50 * Math.sqrt(Math.max(0, 1 - ((x + 36) / 64) ** 2));
    const y = -104 - 44 * Math.sqrt(Math.max(0, 1 - ((x - 40) / 68) ** 2));
    B.push(e(x, Math.min(top, y) + 1, 4, 3.5, H.EScale, 30, 3));
  }
  for (const [sx, sy] of [[-50, -100], [-20, -112], [10, -94], [40, -108], [-36, -138], [66, -90], [-6, -134], [24, -122]] as const) {
    B.push(e(sx, sy, 5, 4, H.EScale, 40, 3));
  }

  // Cou en S, puis tête (pivot à la base du cou).
  B.push(c(86, -104, 116, -126, 26, 18, H.ESkin, 6, 20));
  const T: Prim[] = [];
  T.push(c(112, -130, 142, -138, 18, 16, H.ESkin, 8, 16));
  T.push(c(138, -138, 186, -122, 16, 10, H.ESkin, 12, 14));
  // Crête de chair façon « crête de coq » (momie d'Edmontosaurus).
  T.push(e(146, -152, 14, 6, H.EComb, 24, 5));
  T.push(e(156, -150, 7, 4, H.EComb, 26, 3));
  if (L.sac > 0.05) T.push(e(178, -132 - L.sac * 3, 10 + L.sac * 6, 5 + L.sac * 5, H.EComb, 30, 6));
  if (L.mouth > 0.05) T.push(e(176, -114 + L.mouth * 3, 18, 2 + L.mouth * 4, M.Mouth, 28, 1));
  T.push(...turn([c(140, -124, 192, -112, 8, 4, H.ESkin, 24, 6), e(196, -110, 10, 3.5, H.EBill, 28, 3)], 138, -126, L.mouth * 0.3));
  // Bec de canard : large, plat, débordant.
  T.push(e(198, -117, 16, 6, H.EBill, 26, 5));
  T.push(e(150, -126, 10, 8, H.ESkin, 18, 6));
  if (L.eye) T.push(e(150, -138, 3.5, 3.5, M.Eye, 50, 1));
  B.push(...turn(T, 100, -118, L.headA, 0, L.headDy));

  // Bascule autour de la hanche, puis respiration et appuis.
  P.push(...turn(Q, HIP_X, HIP_Y, -L.pitch * 0.4, 0, bob));
  P.push(...turn(B, HIP_X, HIP_Y, L.pitch, 0, bob));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function edmontoSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne : du cou à la hanche, puis tendons ossifiés en treillis le long du dos.
  for (let k = 0; k <= 12; k++) {
    const t = k / 12, x = 96 - t * 160;
    tag("vertebres", e(x, -110 - Math.sin(t * Math.PI * 0.8) * 32, 5, 4, B, 10, 4));
  }
  for (let k = 2; k <= 9; k++) {
    const t = k / 12, x = 96 - t * 160, y = -110 - Math.sin(t * Math.PI * 0.8) * 32;
    tag("cotes", c(x, y + 3, x + 5, y + 22, 1, 1, B, 8, 2, true), c(x + 5, y + 22, x + 1, -92, 1, 1, B, 8, 2, true));
  }
  tag("bassin", e(-30, -132, 30, 12, B, 12, 8), c(-56, -124, -2, -120, 3, 3, B, 12, 3), c(-18, -122, -4, -102, 3, 2, B, 12, 3));
  for (const [hx, z] of [[-30, 4], [-20, 16]] as const) {
    tag("patte-ar", c(hx, -124, hx + 14, -72, 7, 6, B, z, 5), c(hx + 14, -72, hx - 2, -34, 5, 4, B, z, 4),
      c(hx - 2, -34, hx + 8, -5, 4, 3, B, z, 3), e(hx + 18, -4, 11, 3, B, z, 2));
  }
  for (const [hx, z] of [[78, 4], [86, 16]] as const) {
    tag("patte-av", c(hx - 8, -118, hx, -100, 3, 3, B, z, 3), c(hx, -100, hx + 10, -52, 3.5, 3, B, z, 3),
      c(hx + 10, -52, hx + 12, -6, 3, 2.5, B, z, 2), e(hx + 16, -4, 6, 2, B, z, 2));
  }
  for (let k = 0; k <= 11; k++) {
    const t = k / 11;
    tag("queue", e(-70 - t * 220, -128 + t * 8, 5 - t * 2.5, 4 - t * 2, B, 10, 3));
  }
  tag("queue", c(-80, -136, -230, -126, 1, 1, B, 9, 2, true));
  tag("cou", ...[0, 1, 2, 3].map((k) => e(98 + k * 9, -114 - k * 6, 4.5, 4, B, 10, 4)));
  tag("crane",
    c(122, -134, 186, -120, 13, 8, B, 12, 9), e(198, -116, 13, 5, B, 14, 4), c(140, -124, 190, -113, 5, 3, B, 12, 4),
    e(150, -137, 5, 5, M.Socket, 30, 1), e(176, -124, 6, 3, M.Socket, 30, 1));
  // Batteries dentaires : des centaines de dents en colonnes serrées dans la mâchoire.
  tag("dents", ...[0, 1, 2, 3, 4, 5].map((k) => c(150 + k * 5, -128, 150 + k * 5, -120, 1, 1, B, 30, 1, true)));
  return P.map((p) => scalePrim(p, EDMONTO_SCALE));
}

export const EDMONTO: Species = {
  id: "edmonto",
  name: "Édmontosaure",
  latin: "Edmontosaurus annectens",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Hell Creek, Montana et Dakota (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 7500,
  facts: [
    { id: "bec-canard", title: "Un bec de canard géant", unlock: "discover",
      text: "C'est un hadrosaure, un dinosaure « à bec de canard ». Il pouvait marcher à quatre pattes pour brouter et se dresser sur deux pattes pour courir." },
    { id: "dents", title: "Mille dents de rechange", unlock: "assemble",
      text: "Ses mâchoires contenaient des batteries de plus de mille dents empilées. Dès qu'une dent s'usait, une nouvelle poussait en dessous." },
    { id: "momie", title: "Des « momies » de dinosaure", unlock: "rest",
      text: "On a trouvé des édmontosaures fossilisés avec l'empreinte de leur peau écailleuse. L'un d'eux portait même une crête de chair sur la tête, comme un coq !" },
    { id: "troupeau", title: "D'immenses troupeaux", unlock: "herd",
      text: "Des gisements contiennent des milliers d'os d'édmontosaures. Ils vivaient en grands troupeaux et migraient peut-être au fil des saisons." },
    { id: "survivant", title: "Rescapé d'un T. rex", unlock: "flee",
      text: "Une queue d'édmontosaure porte une morsure de tyrannosaure... cicatrisée ! L'animal a échappé à son prédateur et a survécu longtemps après." },
    { id: "brouteur", title: "En haut comme en bas", unlock: "eat",
      text: "Il broutait les plantes basses, mais pouvait aussi se dresser pour atteindre les branches. Ses joues gardaient la nourriture pendant qu'il mâchait." },
    { id: "cri", title: "Un nez qui chante ?", unlock: "call",
      text: "Il n'avait pas de crête creuse comme d'autres hadrosaures. Mais un grand creux autour de ses narines abritait peut-être un sac de peau gonflable pour lancer des appels." },
    { id: "colonie", title: "Des nids en colonie", unlock: "nest",
      text: "Son cousin Maiasaura, « la bonne mère lézard », nichait en colonies : des dizaines de nids en terre, espacés d'environ une longueur d'adulte. Les œufs étaient couverts de plantes qui chauffaient en pourrissant." },
    { id: "migration", title: "Migrateur ou résident ?", unlock: "migrate",
      text: "Des édmontosaures vivaient en Alaska, près du pôle, où l'hiver plongeait tout dans la nuit pendant des mois. Ont-ils migré vers le sud chaque hiver, comme les caribous ? Des calculs montrent qu'un troupeau pouvait parcourir ces distances. Mais on a aussi trouvé là-bas des os de bébés dinosaures : certains restaient peut-être toute l'année. Le débat continue !" },
    { id: "croissance-eclair", title: "Une croissance éclair", unlock: "baby",
      text: "À l'éclosion, un bébé hadrosaure n'était pas plus long qu'un bras. Il grandissait très vite et atteignait presque sa taille adulte en quelques années, à l'abri du troupeau." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "dents", name: "Batteries dentaires" },
    { id: "cou", name: "Vertèbres du cou" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Queue et tendons ossifiés" },
  ],
  model: edmontoModel,
  skeleton: edmontoSkeleton,
  center: { x: 0, y: -115 * EDMONTO_SCALE },
  eye: { x: 150 * EDMONTO_SCALE, y: -138 * EDMONTO_SCALE },
  feet: [-22, -12, 86, 94].map((x) => x * EDMONTO_SCALE),
  halfLen: 230 * EDMONTO_SCALE,
  shadow: 0.85,
  walkSpeed: 34,
  runSpeed: 82,
  stride: 6.5,
  behavior: { diet: "herbivore", herd: [4, 7], browse: "both", prey: [], defense: "flee", sight: 340, scavenger: false },
  // Ses troupeaux montaient jusqu'en Alaska (os de la formation de Prince Creek) : en été polaire, le
  // troupeau monte en toundra, et redescend passer l'hiver dans les forêts et les marais (hypothèse
  // de migration, voir le fait « Migrateur ou résident ? »).
  biomes: [BIOME.HellCreek, BIOME.Swamp, BIOME.Tundra],
  migration: { summer: [BIOME.Tundra], winter: [BIOME.HellCreek, BIOME.Swamp] },
};
