import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { c, e, turn } from "./ankylo";
import { DE } from "./deinosuchus.mat";
import { lerp, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Deinosuchus modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Alligatoroïde géant, très long et très bas : crâne large et lourd, grosses dents émoussées,
 * dos blindé d'ostéodermes, pattes écartées sur les côtés, queue puissante à double crête.
 * Couché (idle, rest), le ventre touche le sol : dans l'eau peu profonde, seuls le dos, les yeux
 * et les narines dépassent. Le modèle brut mesure ~400 px du bout de la queue au museau.
 */
const LENGTH_M = 10;
export const DEINOSUCHUS_SCALE = (LENGTH_M * PX_PER_M) / 400;
const EYE = { x: 126, y: -44 };

/** Réglages de pose, déduits de l'action. */
interface CrocRig {
  /** Hauteur du ventre au-dessus du sol (0 = couché, ~16 = « marche haute »). */
  lift: number;
  bob: number;
  /** Avancée du corps (bond de l'embuscade). */
  dx: number;
  legs: "walk" | "flat" | "none";
  amp: number;
  /** Tête : rotation autour du cou (- = museau levé), décalage vertical. */
  head: number;
  headDy: number;
  /** Ouverture de la gueule 0..1. */
  jaw: number;
  /** Queue relevée (rad) et balancement. */
  tailUp: number;
  sway: number;
  eye: boolean;
}

function crocRig({ action, actionT: t, time, walk, moving }: Pose): CrocRig {
  const run = action === "run";
  const amp = run ? 1.6 : 1;
  const breath = Math.sin((time * Math.PI * 2) / 3.5) * (1 - moving);
  const r: CrocRig = {
    lift: lerp(2, run ? 11 : 16, moving), bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp + breath,
    dx: 0, legs: moving > 0.05 ? "walk" : "flat", amp, head: run ? -0.04 : 0, headDy: 0, jaw: 0,
    tailUp: 0, sway: Math.sin(time * 0.8) * 4 * (1 - moving) + Math.sin(walk) * 7 * moving * amp, eye: true,
  };
  switch (action) {
    case "eat": {
      // Gueule refermée sur un morceau, la tête secoue pour l'arracher.
      const shake = Math.sin(t * Math.PI * 10);
      Object.assign(r, { lift: 4, head: 0.06 + shake * 0.1, headDy: 2, jaw: 0.25 + Math.abs(shake) * 0.1, sway: shake * 6 });
      break;
    }
    case "drink":
      Object.assign(r, { lift: 3, head: 0.12, headDy: 6 });
      break;
    case "rest":
      // À plat au soleil, gueule entrouverte pour se rafraîchir, yeux clos.
      Object.assign(r, { lift: 0, bob: r.bob * 0.6, jaw: 0.3, eye: false, sway: r.sway * 0.3 });
      break;
    case "call": {
      // Beuglement : tête et queue relevées, gueule ouverte, le dos vibre.
      const k = Math.sin(Math.min(1, t * 1.3) * Math.PI);
      Object.assign(r, { lift: 3, head: -0.3 * k, headDy: -3 * k, jaw: 0.65 * k, tailUp: 0.18 * k, bob: Math.sin(time * 30) * 0.8 * k });
      break;
    }
    case "defend":
      // Menace : corps dressé sur les pattes, gueule béante, queue arquée prête à fouetter.
      Object.assign(r, {
        lift: 16, legs: "walk", head: -0.12, headDy: -2, jaw: 0.85 + Math.sin(time * 3) * 0.05,
        tailUp: 0.2, sway: Math.sin(time * 4) * 6,
      });
      break;
    case "attack": {
      // Embuscade : immobile et ramassé (0-0.3), bond explosif gueule grande ouverte (0.3-0.55),
      // claquement (0.55-0.62), puis retour en arrière.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.3, 0.4));
      const lunge = win(t, 0.3, 0.5) * (1 - win(t, 0.7, 1));
      const open = win(t, 0.25, 0.45) * (1 - win(t, 0.55, 0.62));
      Object.assign(r, {
        lift: 2 + lunge * 12, dx: lunge * 46 - wind * 8, legs: "walk", head: -0.16 * open + 0.08 * win(t, 0.6, 0.7),
        headDy: -4 * open, jaw: open, tailUp: -0.04 + 0.12 * lunge, sway: lunge * 10,
      });
      break;
    }
    case "dead":
      Object.assign(r, { lift: 0, bob: 0, legs: "none", jaw: 0.12, eye: false, sway: 0 });
      break;
    default:
      break;
  }
  return r;
}

export function deinosuchusModel(pose: Pose): Prim[] {
  const r = crocRig(pose);
  const P = crocParts(r, pose.walk, pose.action === "walk" || pose.action === "run" ? pose.moving : 0);
  if (pose.action === "dead") {
    // Sur le dos : ventre pâle en l'air, pattes raides tendues vers le ciel.
    const D = flipY(P, -22);
    for (const [hx, d, far] of [[-58, -1, true], [56, 1, true], [-48, -1, false], [66, 1, false]] as const) {
      const m = far ? DE.Far : DE.Skin, z = far ? -40 : 30, fx = hx + d * 10, fy = -60;
      D.push(c(hx, -38, fx, fy, 10, 7, m, z, 8));
      D.push(e(fx + d * 4, fy - 3, 8, 4, m, z, 4));
      D.push(c(fx + d * 8, fy - 4, fx + d * 13, fy - 8, 2, 1, DE.Claw, z + 4, 2));
    }
    return D.map((p) => scalePrim(p, DEINOSUCHUS_SCALE));
  }
  return P.map((p) => scalePrim(p, DEINOSUCHUS_SCALE));
}

/** Retourne verticalement autour de y = cy (sur le dos). */
function flipY(ps: Prim[], cy: number): Prim[] {
  const f = (y: number) => 2 * cy - y;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: f(p.ay), by: f(p.by) };
    if (p.k === "cut") return { ...p, y: f(p.y) };
    return { ...p, y: f(p.y), yMin: p.yMax === undefined ? undefined : f(p.yMax), yMax: p.yMin === undefined ? undefined : f(p.yMin) };
  });
}

function crocParts(L: CrocRig, walk: number, moving: number): Prim[] {
  const X = L.dx;
  const by = -22 - L.lift + L.bob; // centre du tronc
  const P: Prim[] = [];

  // --- Pattes écartées sur les côtés (diagonales opposées en phase) ---
  const legs = [
    { hip: -58, phase: 0, far: true, front: false },
    { hip: 56, phase: Math.PI, far: true, front: true },
    { hip: -48, phase: Math.PI, far: false, front: false },
    { hip: 66, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    if (L.legs === "none") continue;
    const m = G.far ? DE.Far : DE.Skin;
    const z = G.far ? -40 : 30;
    const hx = G.hip + X, hy = by + 6;
    if (L.legs === "flat") {
      // Couché : coude et genou écartés, pied à plat devant (avant) ou derrière (arrière).
      const fx = hx + (G.front ? 14 : -10);
      P.push(c(hx, hy, fx, -6, G.front ? 10 : 13, 8, m, z, 8));
      P.push(e(fx + 4, -4, 12, 4, m, z + 2, 4));
      P.push(c(fx + 12, -4, fx + 17, -2, 2, 1, DE.Claw, z + 6, 2));
      continue;
    }
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lf = Math.max(0, Math.cos(walk + G.phase)) * moving * 6 * L.amp;
    const fx = hx + s * 16 + (G.front ? 4 : -2);
    // Coude (genou) sorti sur le côté, à hauteur du ventre ; avant-bras presque vertical.
    const kx = (hx + fx) / 2 + (G.front ? -4 : 6), ky = by + 14;
    P.push(c(hx, hy, kx, ky, G.front ? 11 : 14, 9, m, z, 9));
    P.push(c(kx, ky, fx, -5 - lf, 9, 6, m, z + 2, 7));
    P.push(e(fx + 5, -4 - lf, 11, 4, m, z + 2, 4));
    P.push(c(fx + 12, -4 - lf, fx + 17, -2 - lf, 2, 1, DE.Claw, z + 6, 2));
  }

  // --- Queue : longue, puissante, double crête d'écailles, bandes sombres ---
  const n = 8;
  const tail: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    tail.push([-82 - t * 130 + X, lerp(by - 2, -6, Math.pow(t, 0.7)) - L.tailUp * 70 * t * t + L.sway * t * t]);
  }
  for (let k = 0; k < n; k++) {
    const [ax, ay] = tail[k], [bx, by2] = tail[k + 1];
    const ra = 20 - k * 2.1, rb = 20 - (k + 1) * 2.1;
    const mx = (ax + bx) / 2, my = (ay + by2) / 2, mr = (ra + rb) / 2;
    P.push(c(ax, ay, bx, by2, ra, rb, DE.Skin, 2, mr * 0.9));
    if (k % 2) P.push(c(mx + 2, my - mr * 0.7, mx, my + mr * 0.5, 2.5, 2, DE.Band, 2 + mr * 0.8, 2));
    P.push(c(mx + 3, my - mr + 2, mx - 1, my - mr - 4, 3.5, 1, DE.Scute, 4 + mr, 3));
  }

  // --- Tronc : long et bas, ventre pâle, ostéodermes en rangées sur le dos ---
  P.push(e(X, by, 92, 22, DE.Skin, 0, 22));
  P.push(e(X + 4, by + 12, 84, 10, DE.Belly, 6, 8, by + 10));
  for (let j = 0; j < 10; j++) {
    const x = -78 + j * 17, top = by - 22 * Math.sqrt(Math.max(0, 1 - (x / 92) ** 2));
    P.push(e(x + X, top + 1, 5, 3, DE.Scute, 18, 5));
    P.push(e(x + X + 8, top + 8, 4, 2.5, DE.Scute, 20, 4));
  }

  // --- Cou épais, puis crâne géant (pivot à la base du cou) ---
  P.push(c(70 + X, by - 2, 104 + X, by - 2, 21, 18, DE.Skin, 4, 20));
  P.push(...turn(crocHead(L), 100, -24, L.head, X, by + 22 + L.headDy));
  return P;
}

/** Tête au repos (tronc à by = -22) : mâchoire supérieure et inférieure s'ouvrent chacune de leur côté. */
function crocHead(L: CrocRig): Prim[] {
  const open = L.jaw > 0.08;
  const U: Prim[] = [
    // Crâne large et lourd, museau long et arrondi au bout.
    c(98, -30, 178, -26, 14, 8, DE.Skin, 6, 13),
    e(116, -32, 20, 11, DE.Skin, 8, 13),
    e(178, -27, 12, 8, DE.Skin, 8, 9),
    // Yeux et narines en relief sur le dessus : ce qui dépasse de l'eau.
    e(124, -40, 8, 5, DE.Skin, 14, 6),
    e(186, -33, 4, 2.5, DE.Lid, 18, 2),
    e(150, -34, 18, 3, DE.Scute, 14, 2),
    L.eye ? e(EYE.x, EYE.y, 4, 5, DE.Eye, 30, 1) : c(EYE.x - 5, EYE.y + 1, EYE.x + 4, EYE.y + 1, 1, 1, DE.Lid, 30, 1, true),
  ];
  // Grosses dents émoussées : visibles même gueule fermée.
  for (const x of open ? [118, 130, 142, 154, 166, 178] : [132, 150, 168]) U.push(e(x, -15, 2.6, 5, DE.Tooth, 20, 2));
  const J: Prim[] = [
    c(96, -14, 182, -17, 10, 6, DE.Skin, 4, 9),
    c(98, -9, 176, -13, 6, 3, DE.Belly, 8, 4),
  ];
  if (open) for (const x of [124, 136, 148, 160, 172]) J.push(e(x, -23, 2.4, 5, DE.Tooth, 16, 2));
  else J.push(c(108, -19, 184, -21, 1, 1, DE.Lid, 18, 1, true));
  const H: Prim[] = [];
  if (open) H.push(...turn([e(140, -19, 38, 3 + L.jaw * 13, DE.Mouth, 1, 2)], 100, -22, L.jaw * 0.13));
  H.push(...turn(U, 100, -24, -L.jaw * 0.22));
  H.push(...turn(J, 100, -20, L.jaw * 0.5));
  return H;
}

/** Squelette (format : voir ankyloSkeleton). Couché, regard à droite. */
export function deinosuchusSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const by = -26;

  // Crâne géant : museau large, orbites sur le dessus, narine au bout, grosses dents émoussées.
  tag("crane",
    c(100, -30, 178, -26, 9, 5, B, 12, 8), e(116, -32, 16, 8, B, 12, 8), e(176, -26, 9, 5, B, 12, 6),
    e(EYE.x, EYE.y + 4, 4, 3, M.Socket, 30, 1), e(108, -34, 4, 2.5, M.Socket, 30, 1), e(184, -30, 3, 2, M.Socket, 30, 1),
    ...[120, 132, 144, 156, 168, 178].map((x) => e(x, -20, 2.2, 3, M.Tooth, 20, 2)));
  tag("machoire", c(96, -14, 182, -16, 5, 3, B, 12, 4), e(100, -16, 3, 3, M.Socket, 30, 1));
  // Colonne : du cou au bassin.
  for (let x = 92; x >= -78; x -= 12) tag("vertebres", e(x, by - 8, 4.5, 3.5, B, 10, 3));
  // Côtes : courtes et arquées sur le tronc bas.
  for (let x = 74; x >= -40; x -= 12) tag("cotes", c(x, by - 5, x - 3, by + 8, 1, 1, B, 8, 2, true), c(x - 3, by + 8, x - 8, -8, 1, 1, B, 8, 2, true));
  // Ostéodermes : vraies plaques d'os, en rangées sur le dos.
  for (let x = 80; x >= -76; x -= 13) tag("osteodermes", e(x, by - 17, 5, 2.5, B, 14, 3));
  tag("bassin", e(-56, by - 4, 14, 8, B, 12, 6), c(-66, by - 4, -46, by + 6, 2.5, 2, B, 12, 2));
  // Pattes écartées : épaule, bras, cuisse, jambe, doigts.
  tag("pattes", c(60, by - 6, 64, by + 4, 3, 3, B, 12, 2));
  for (const [hx, front] of [[64, true], [-52, false]] as const) {
    const fx = hx + (front ? 14 : -10);
    tag("pattes", c(hx, by + 2, hx + (front ? 2 : -4), -10, front ? 3.5 : 4.5, 3, B, 16, 3), c(hx + (front ? 2 : -4), -10, fx, -4, 3, 2.5, B, 16, 2),
      ...[-2, 2, 6].map((d) => c(fx + 2, -3, fx + 12, -3 + d * 0.4, 1, 1, B, 16, 1, true)));
  }
  // Queue : longues vertèbres caudales qui s'affinent, épines dorsales.
  for (let k = 0; k <= 12; k++) {
    const t = k / 12, x = -88 - t * 122, y = lerp(by - 6, -6, Math.pow(t, 0.7));
    tag("queue", e(x, y, 4.5 - t * 2.5, 3.5 - t * 1.5, B, 10, 3), c(x, y - 3, x - 2, y - 9 + t * 5, 1, 1, B, 12, 1, true));
  }
  return P.map((p) => scalePrim(p, DEINOSUCHUS_SCALE));
}

export const DEINOSUCHUS: Species = {
  id: "deinosuchus",
  name: "Deinosuchus",
  latin: "Deinosuchus riograndensis",
  period: "Crétacé supérieur, 80 Ma",
  place: "Formation d'Aguja, Texas (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 5000,
  facts: [
    { id: "crocodile-terrible", title: "Le crocodile terrible", unlock: "discover",
      text: "Son nom veut dire « crocodile terrible ». Avec 8 à 12 mètres de long selon les estimations, c'est l'un des plus grands crocodiliens qui aient jamais vécu : plus long qu'un autobus !" },
    { id: "pas-dinosaure", title: "Pas un dinosaure !", unlock: "assemble",
      text: "Le Deinosuchus n'est pas un dinosaure : c'est un alligatoroïde, un cousin géant des alligators d'aujourd'hui. Son dos était blindé de grosses plaques d'os, les ostéodermes, et son crâne pouvait dépasser 1,5 mètre." },
    { id: "morsures", title: "Des traces de dents", unlock: "attack",
      text: "On a trouvé des os de dinosaures à bec de canard et des carapaces de tortues marqués de grosses traces de dents. Les savants pensent qu'elles viennent du Deinosuchus : il s'attaquait parfois à des dinosaures !" },
    { id: "embuscade", title: "Chasseur à l'affût", unlock: "hunt",
      text: "Comme les crocodiles actuels, il attendait sans doute immobile dans l'eau, seuls les yeux et les narines dépassant, avant de bondir sur un animal venu boire. On le déduit de ses cousins vivants." },
    { id: "marais", title: "Le roi des marais côtiers", unlock: "rest",
      text: "Il vivait dans les marais et les estuaires au bord d'une grande mer intérieure qui coupait l'Amérique du Nord en deux. On a trouvé ses fossiles au Texas, mais aussi sur la côte atlantique, jusqu'en Caroline du Nord et en Géorgie." },
    { id: "beuglement", title: "Un beuglement dans le marais", unlock: "call",
      text: "Les alligators d'aujourd'hui beuglent tête et queue levées, si fort que l'eau vibre sur leur dos. Son cousin géant faisait peut-être de même, mais on ne peut pas entendre un fossile : c'est une hypothèse." },
  ],
  bones: [
    { id: "crane", name: "Crâne géant" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "osteodermes", name: "Ostéodermes" },
    { id: "bassin", name: "Bassin" },
    { id: "pattes", name: "Pattes" },
    { id: "queue", name: "Vertèbres de la queue" },
  ],
  model: deinosuchusModel,
  skeleton: deinosuchusSkeleton,
  center: { x: 0, y: -22 * DEINOSUCHUS_SCALE },
  eye: { x: EYE.x * DEINOSUCHUS_SCALE, y: EYE.y * DEINOSUCHUS_SCALE },
  feet: [-58, -48, 56, 66].map((x) => x * DEINOSUCHUS_SCALE),
  halfLen: 200 * DEINOSUCHUS_SCALE,
  shadow: 0.7,
  walkSpeed: 18,
  runSpeed: 90,
  stride: 5,
  behavior: { diet: "carnivore", herd: [1, 1], browse: null, prey: ["edmonto", "ornithomimus", "trike", "pachy"], defense: "bite", sight: 360, scavenger: true },
  biomes: [BIOME.Swamp],
};
