import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { c, e, squash, strike, turn } from "./ankylo";
import { PR } from "./protoceratops.mat";
import type { Pose, Species } from "./types";

/**
 * Protoceratops modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Petit cératopsien quadrupède sans cornes : grosse tête à bec de perroquet, large collerette tournée
 * vers l'arrière, simple bosse sur le museau, queue haute et aplatie sur les côtés.
 * Le modèle brut mesure ~230 px du bout de la queue au bec ; on le ramène à sa taille réelle.
 */
const LENGTH_M = 1.8;
export const PROTOCERATOPS_SCALE = (LENGTH_M * PX_PER_M) / 230;

interface ProtoLook {
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

export function protoceratopsModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 2.8 : 1.1)) * (1 - moving) * (rest ? 1.5 : 1);
  const L: ProtoLook = {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp + breath, drop: 0, dx: 0,
    legs: "walk", amp, spread: 0, headA: run ? 0.12 : 0, headDy: 0, mouth: 0,
    sway: Math.sin(time * 1.4) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.headA = 0.6 + chew * 0.05; L.headDy = 8; L.mouth = Math.max(0, chew) * 0.7; }
  else if (action === "drink") { L.headA = 0.72; L.headDy = 12; L.drop = 5; L.spread = 8; }
  else if (action === "rest") { L.drop = 22; L.legs = "tuck"; L.headA = 0.2; L.headDy = 6; L.sway *= 0.3; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.headA = -0.35 * k; L.headDy = -3 * k; L.mouth = k; }
  else if (action === "defend") {
    // Tête basse et bec entrouvert, collerette présentée de face : bluff avant la fuite.
    L.drop = 4; L.headA = 0.25 + Math.sin(time * 4) * 0.04; L.headDy = 4; L.spread = 6; L.sway = 0; L.mouth = 0.5;
  } else if (action === "attack") {
    // Morsure : recul, puis coup de bec vers l'avant, collerette en bouclier.
    const { s, hit } = strike(at);
    L.dx = s * 10; L.drop = 3 + hit * 2; L.spread = 4 + s * 4;
    L.headA = 0.3 - Math.max(0, s) * 0.3; L.headDy = 4 - hit * 3; L.mouth = Math.max(0, -s) * 0.9 + hit * 0.2;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.15; L.sway = 0; L.bob = 0;
  }
  const P = protoParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc : corps aplati, pattes raides tendues.
    const D = squash(P, 0.6, 2);
    for (const [hip, dir, far] of [[-30, -1, true], [32, 1, true], [-22, -1, false], [38, 1, false]] as const) {
      const fx = hip + dir * (far ? 22 : 16), fy = far ? -16 : 8, m = far ? PR.Far : PR.Skin, z = far ? -30 : 26;
      D.push(c(hip, -14, fx, fy, 9, 6, m, z, 7));
      D.push(e(fx + dir * 3, fy, 5, 4, m, z, 4));
      D.push(e(fx + dir * 8, fy, 2, 2, PR.Nail, z + 4, 2));
    }
    return D.map((p) => scalePrim(p, PROTOCERATOPS_SCALE));
  }
  return P.map((p) => scalePrim(p, PROTOCERATOPS_SCALE));
}

function protoParts(L: ProtoLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop, X = L.dx;
  const P: Prim[] = [];

  // --- Pattes : arrière longues, avant courtes et écartées ---
  const legs = [
    { hip: -30, phase: 0, far: true, front: false },
    { hip: 32, phase: Math.PI, far: true, front: true },
    { hip: -22, phase: Math.PI, far: false, front: false },
    { hip: 38, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? PR.Far : PR.Skin;
    const z = G.far ? -50 : 24;
    const hx = G.hip + X;
    if (L.legs === "tuck") {
      const fx = hx + (G.front ? 10 : -2);
      P.push(e(fx, -5, 14, 5, m, z, 5));
      P.push(e(fx + 12, -3, 2.5, 2, PR.Nail, z + 4, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 6 * L.amp;
    const fx = G.hip + s * 11 + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : -L.spread * 0.3) + X * 0.2;
    const hy = (G.front ? -44 : -52) + bob;
    // Cuisse ou épaule, puis jambe jusqu'au pied (coude écarté à l'avant).
    P.push(e(hx, hy, G.front ? 14 : 19, G.front ? 16 : 22, m, z - 4, 12));
    const kx = (hx + fx) / 2 + (G.front ? 4 : -3), ky = (hy - 6 - lift) / 2;
    P.push(c(hx, hy + 4, kx, ky, G.front ? 11 : 13, 10, m, z, 9));
    P.push(c(kx, ky, fx, -6 - lift, 10, 9, m, z + 2, 8));
    P.push(e(fx + 3, -4 - lift, 11, 5, m, z + 2, 5));
    P.push(e(fx + 12, -3 - lift, 3, 2.5, PR.Nail, z + 6, 2));
  }

  // --- Queue haute et aplatie : épines dorsales en lame ---
  const tail: [number, number][] = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    tail.push([-50 - t * 80 + X, -64 + bob * (1 - t) + L.drop * t + t * 30 + L.sway * t * t]);
  }
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 20 - k * 3.4, rb = 20 - (k + 1) * 3.4;
    P.push(c(ax, ay, bx, by, ra, Math.max(2.5, rb), PR.Skin, 2, 12));
    // Lame dorsale : la queue est plus haute que large.
    if (k < 4) P.push(c(ax, ay - ra * 0.7, bx, by - rb * 0.7, ra * 0.55, Math.max(2, rb * 0.55), PR.Skin, 1, 8));
    P.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.9, 3, ra * 0.4, PR.Stripe, 2 + ra * 0.8, 3));
  }

  // --- Corps : dos voûté au-dessus des hanches ---
  P.push(e(-2 + X, -56 + bob, 56, 30, PR.Skin, 0, 28));
  P.push(e(-26 + X, -64 + bob, 36, 27, PR.Skin, 4, 26));
  P.push(e(4 + X, -30 + bob, 46, 8, PR.Belly, 8, 8, -30 + bob));
  for (let j = 0; j < 5; j++) {
    const x = -52 + j * 20, top = -64 - 27 * Math.sqrt(Math.max(0, 1 - ((x + 20) / 62) ** 2));
    P.push(e(x + X, top + 9 + bob, 2.5, 7, PR.Stripe, 24, 3));
  }

  // --- Cou court, puis grosse tête (pivot à la base du cou) ---
  P.push(e(46 + X, -56 + bob, 18, 20, PR.Skin, 6, 18));
  const T: Prim[] = [];
  // Collerette : large plaque inclinée vers l'arrière, bord épais plus sombre, deux fenêtres.
  T.push(c(70, -62, 32, -98, 16, 30, PR.FrillEdge, 8, 14));
  T.push(c(70, -62, 34, -96, 12, 25, PR.Frill, 10, 16));
  T.push(e(36, -94, 11, 12, PR.FrillSpot, 26, 4));
  T.push(e(54, -78, 6, 6, PR.FrillSpot, 26, 3));
  // Crâne, joue évasée (pointe du jugal), bosse du museau.
  T.push(c(64, -62, 98, -56, 20, 12, PR.Skin, 14, 16));
  T.push(e(74, -46, 12, 11, PR.Skin, 18, 10));
  T.push(c(74, -42, 77, -32, 5, 1.5, PR.Bump, 28, 3));
  T.push(e(92, -68, 6, 4, PR.Bump, 26, 4));
  // Bec de perroquet : crochet supérieur, mâchoire inférieure qui pivote.
  const jaw = L.mouth * 0.35;
  if (L.mouth > 0.05) T.push(e(98, -46 + L.mouth * 2, 11, 2 + L.mouth * 4, M.Mouth, 24, 1));
  T.push(...turn([c(80, -46, 106, -44, 8, 4, PR.Skin, 20, 7), c(104, -44, 110, -42, 4, 1.5, PR.Beak, 24, 3)], 78, -48, jaw));
  T.push(c(98, -62, 114, -46, 9, 2.5, PR.Beak, 22, 7));
  if (L.eye) T.push(e(80, -64, 3.5, 3.5, M.Eye, 50, 1));
  P.push(...turn(T, 50, -54, L.headA, X, bob + L.headDy));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function protoceratopsSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne : du cou au bassin, point haut au-dessus des hanches.
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, x = 48 - t * 96;
    tag("vertebres", e(x, -56 - Math.sin(t * Math.PI * 0.9) * 18 + t * 2, 4, 3, B, 10, 3));
  }
  for (let k = 2; k <= 7; k++) {
    const t = k / 10, x = 48 - t * 96, y = -56 - Math.sin(t * Math.PI * 0.9) * 18;
    tag("cotes", c(x, y + 3, x + 3, y + 16, 1, 1, B, 8, 2, true), c(x + 3, y + 16, x + 1, -28, 1, 1, B, 8, 2, true));
  }
  tag("bassin", e(-26, -64, 16, 9, B, 12, 6), c(-40, -62, -12, -58, 2, 2, B, 12, 2));
  for (const [hx, z] of [[-30, 4], [-22, 16]] as const) {
    tag("patte-ar", c(hx, -58, hx + 2, -28, 4, 3, B, z, 3), c(hx + 2, -28, hx, -5, 3, 2.5, B, z, 2), e(hx + 5, -3, 6, 2, B, z, 2));
  }
  tag("patte-av", c(28, -62, 34, -40, 3, 2, B, 12, 2));
  for (const [hx, z] of [[32, 4], [38, 16]] as const) {
    tag("patte-av", c(hx, -40, hx + 4, -22, 3, 2.5, B, z, 3), c(hx + 4, -22, hx + 1, -5, 2.5, 2, B, z, 2), e(hx + 5, -3, 5, 2, B, z, 2));
  }
  // Queue : vertèbres hérissées de hautes épines (queue aplatie).
  for (let k = 0; k <= 7; k++) {
    const t = k / 7, x = -50 - t * 76, y = -58 + t * 28;
    tag("queue", e(x, y, 4 - t * 2, 3 - t * 1.2, B, 10, 3));
    if (k < 6) tag("queue", c(x, y - 2, x - 3, y - 10 + t * 6, 1, 1, B, 9, 2, true));
  }
  // Crâne : collerette percée de deux grandes fenêtres, bec, joue.
  tag("collerette", c(66, -60, 40, -94, 7, 14, B, 12, 6), e(46, -90, 6, 7, M.Socket, 30, 1), e(56, -76, 3, 4, M.Socket, 30, 1));
  tag("crane",
    c(66, -62, 96, -54, 11, 7, B, 12, 8), c(96, -58, 110, -46, 5, 2, B, 14, 4), c(80, -46, 106, -44, 4, 2, B, 12, 3),
    c(74, -50, 76, -38, 3, 1, B, 14, 3), e(80, -62, 4, 4, M.Socket, 30, 1), e(94, -56, 3, 2, M.Socket, 30, 1));
  return P.map((p) => scalePrim(p, PROTOCERATOPS_SCALE));
}

export const PROTOCERATOPS: Species = {
  id: "protoceratops",
  name: "Protoceratops",
  latin: "Protoceratops andrewsi",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Djadochta, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 85,
  facts: [
    { id: "premier-visage", title: "Premier visage à cornes", unlock: "discover",
      text: "Son nom veut dire « premier visage à cornes ». C'est un cousin du tricératops, mais grand comme un mouton et sans vraies cornes : juste une petite bosse sur le museau." },
    { id: "squelettes", title: "Des bébés aux adultes", unlock: "assemble",
      text: "C'est l'un des dinosaures les mieux connus : on a trouvé dans le désert de Gobi des dizaines de squelettes, des tout petits bébés jusqu'aux adultes. On peut suivre sa croissance comme dans un album photo." },
    { id: "oeufs-mous", title: "Des œufs à coquille molle", unlock: "nest",
      text: "En 2020, des savants ont montré que ses œufs avaient une coquille souple, comme le cuir, à la manière des œufs de tortue. Ils devaient être enterrés dans le sable pour rester humides." },
    { id: "combattants", title: "Les dinosaures combattants", unlock: "defend",
      text: "En 1971, on a découvert un fossile incroyable : un protoceratops et un vélociraptor figés en plein combat ! Le raptor griffe, le protoceratops lui mord le bras. Ils ont sans doute été ensevelis d'un coup par une dune qui s'est effondrée." },
    { id: "griffon", title: "Le secret du griffon ?", unlock: "call",
      text: "L'historienne Adrienne Mayor a proposé une idée : des crânes de protoceratops, avec leur bec et leur collerette, auraient pu inspirer la légende du griffon, mi-aigle mi-lion. C'est une hypothèse, discutée par les paléontologues." },
    { id: "troupeau", title: "En troupeaux", unlock: "herd",
      text: "On a trouvé plusieurs protoceratops jeunes ensevelis ensemble : ils vivaient sans doute en groupes, ce qui les protégeait mieux des prédateurs du désert." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "collerette", name: "Collerette" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Vertèbres de la queue" },
  ],
  model: protoceratopsModel,
  skeleton: protoceratopsSkeleton,
  center: { x: 0, y: -50 * PROTOCERATOPS_SCALE },
  eye: { x: 80 * PROTOCERATOPS_SCALE, y: -62 * PROTOCERATOPS_SCALE },
  feet: [-30, -22, 32, 38].map((x) => x * PROTOCERATOPS_SCALE),
  halfLen: 115 * PROTOCERATOPS_SCALE,
  shadow: 0.8,
  walkSpeed: 26,
  runSpeed: 70,
  stride: 10,
  behavior: { diet: "herbivore", herd: [3, 6], browse: "low", prey: [], defense: "flee", sight: 300, scavenger: false },
  biomes: [BIOME.Desert],
};
