import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { EL } from "./elasmosaurus.mat";
import { lerp } from "../math";
import { c, e, flipY, rot, win } from "./kit";
import type { Pose, Species } from "./types";

/**
 * Elasmosaure modélisé en primitives (px locaux, regard vers la droite).
 * Origine = point de la ligne de flottaison (y = 0) sous le centre du tronc, comme le mosasaure : le corps
 * est immergé (y > 0), seul le haut du dos affleure. Le cou (plus de la moitié de l'animal) est une chaîne
 * de segments dont la courbure dépend de l'action ; walk/run = « vol sous-marin » (les deux paires de
 * nageoires rament en alternance, au rythme de `walk`), idle = flotte, rest = dérive cou relâché,
 * eat/drink = le cou plonge et la tête happe un poisson, call = tête sortie pour respirer,
 * attack = cou replié puis détendu d'un coup, defend = cou ramené en S et nageoires qui battent,
 * dead = ventre en l'air, cou pendant.
 * Le modèle brut mesure ~351 px du bout de la queue au bout du museau (cou tendu).
 */
const LENGTH_M = 10.3;
export const ELASMOSAURUS_SCALE = (LENGTH_M * PX_PER_M) / 351;

/** Centre du tronc sous la ligne de flottaison. */
const CY = 14;
/** Cou : nombre de segments (~5 vertèbres chacun), longueur d'un segment, base (épaules). */
const NECK_N = 15;
const NECK_SEG = 15;
const NECK_X = 26, NECK_Y = CY - 3;

/** Réglages de pose, déduits de l'action. */
interface ElasmoRig {
  /** Cou : angle à la base (rad, - = vers le haut), courbure linéaire puis quadratique le long du cou. */
  a0: number;
  curve: number;
  bend: number;
  /** Ondulation du cou : amplitude (rad) et phase. */
  wave: number;
  wph: number;
  /** Tête : rotation en plus du dernier segment, ouverture de la gueule. */
  head: number;
  jaw: number;
  closed: boolean;
  /** Nageoires avant / arrière (rad, + = pointe vers le haut), côté lointain en plus. */
  front: number;
  frontFar: number;
  rear: number;
  rearFar: number;
  /** Queue : battement (px au bout). */
  tail: number;
  dx: number;
  dy: number;
}

function elasmoRig({ action, actionT: t, time, walk, moving }: Pose): ElasmoRig {
  const swim = action === "walk" || action === "run";
  const fast = action === "run";
  const amp = swim ? lerp(0.12, fast ? 0.7 : 0.5, moving) : 0.1;
  const ph = swim ? walk : time * 1.1;
  const s = Math.sin(t * Math.PI * 2);
  const r: ElasmoRig = {
    // Flotte : cou en arc doux, qui ondule lentement.
    a0: -0.24, curve: 0.5, bend: 0, wave: 0.05, wph: time * 0.9,
    head: Math.sin(time * 0.8) * 0.04, jaw: 0, closed: false,
    // Vol sous-marin : les nageoires avant et arrière battent en alternance, comme des ailes.
    front: Math.sin(ph) * amp - 0.05, frontFar: Math.sin(ph + 0.3) * amp - 0.1,
    rear: Math.sin(ph + Math.PI) * amp * 0.9, rearFar: Math.sin(ph + Math.PI + 0.3) * amp * 0.9,
    tail: Math.sin(time * 1.3) * 2, dx: 0, dy: swim ? -Math.cos(ph * 2) * amp * 3 : Math.sin(time * 0.9) * 0.6,
  };
  if (swim) Object.assign(r, { a0: -0.06, curve: 0.1, wave: 0.03 + 0.03 * moving, wph: walk * 0.5, tail: Math.sin(walk) * 3 });
  switch (action) {
    case "eat":
    case "drink": {
      // Le cou plonge vers le banc, la tête happe par saccades (eat : un poisson entre les dents).
      const dart = Math.abs(Math.sin(t * Math.PI * 3));
      Object.assign(r, { a0: -0.1, curve: 0.25 + 0.35 * dart, bend: 0.2, head: 0.1 - 0.2 * dart, jaw: action === "eat" ? (1 - dart) * 0.6 : 0.15 * Math.abs(s) });
      break;
    }
    case "rest":
      // Dérive : le dos sort un peu de l'eau, le cou pend mollement, nageoires étalées, yeux clos.
      Object.assign(r, {
        a0: 0.02, curve: 0.15, bend: 0.25, wave: 0.03, wph: time * 0.5, dy: -3, closed: true, tail: Math.sin(time * 0.6),
        front: 0.25 + Math.sin(time * 0.5) * 0.04, frontFar: 0.2, rear: 0.15, rearFar: 0.12,
      });
      break;
    case "call": {
      // Remonte respirer : cou presque horizontal, seul le bout se relève pour sortir la tête.
      const k = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      Object.assign(r, { a0: lerp(r.a0, 0.02, k), curve: lerp(r.curve, 0, k), bend: -0.4 * k, head: 0.25 * k, jaw: 0.3 * k * (0.6 + 0.4 * Math.abs(s)), dy: -3 * k });
      break;
    }
    case "attack": {
      // Replie le cou en S (0-0.3), le détend d'un coup vers l'avant (0.35-0.55) et claque des mâchoires.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.45));
      const lunge = win(t, 0.35, 0.5) * (1 - win(t, 0.7, 1));
      Object.assign(r, {
        a0: -0.24 - 0.45 * wind + 0.2 * lunge, curve: 0.5 + 0.9 * wind - 0.45 * lunge, bend: -0.3 * wind,
        head: -0.15 * wind + 0.1 * lunge, jaw: Math.max(wind, lunge) * 0.8 * (1 - win(t, 0.52, 0.58) * 0.95),
        dx: lunge * 14 - wind * 4, front: -0.5 * lunge + 0.35 * wind, frontFar: -0.5 * lunge + 0.3 * wind, rear: 0.3 * lunge, rearFar: 0.3 * lunge,
      });
      break;
    }
    case "defend": {
      // Recule : cou ramené en S contre le corps, nageoires qui battent vite, gueule entrouverte.
      const f = Math.sin(time * 9) * 0.5;
      Object.assign(r, { a0: -0.6, curve: 1.6, bend: -0.6, head: -0.2, jaw: 0.35 + 0.1 * s, front: f, frontFar: f, rear: -f, rearFar: -f, tail: Math.sin(time * 9) * 4 });
      break;
    }
    case "dead":
      Object.assign(r, { a0: -0.05, curve: -0.2, bend: -0.25, wave: 0, head: -0.2, jaw: 0.25, closed: true, front: 0.4, frontFar: 0.5, rear: 0.3, rearFar: 0.35, tail: 0, dy: 0 });
      break;
    default:
      break;
  }
  return r;
}

/** Nœuds du cou (de la base à la tête) et angle du dernier segment. */
function neckChain(r: ElasmoRig): { X: number[]; Y: number[]; a: number } {
  const X = [NECK_X + r.dx], Y = [NECK_Y + r.dy];
  let a = r.a0;
  for (let i = 0; i < NECK_N; i++) {
    const u = (i + 0.5) / NECK_N;
    a = r.a0 + r.curve * u + r.bend * u * u + r.wave * Math.sin(r.wph - i * 0.6) * u;
    X.push(X[i] + Math.cos(a) * NECK_SEG);
    Y.push(Y[i] + Math.sin(a) * NECK_SEG);
  }
  return { X, Y, a };
}

/** Une nageoire : bras court puis longue pale étroite en hydroptère, pointée vers l'arrière, tournée de `a`. */
function flipper(ax: number, ay: number, len: number, a: number, m: number, z: number): Prim[] {
  const ex = ax - 12 * len, ey = ay + 6 * len, tx = ax - 56 * len, ty = ay + 16 * len;
  return rot([
    c(ax, ay, ex, ey, 6.5, 7.5, m, z, 6),
    c(ex, ey, tx, ty, 7.5, 1.6, m, z + 1, 5),
  ], ax, ay, a);
}

/** Tête (repère local : origine au bout du cou, museau vers +x). */
function head(r: ElasmoRig, eat: boolean, t: number): Prim[] {
  const H: Prim[] = [];
  H.push(e(5, 0, 9, 5.5, EL.Skin, 4, 6));
  H.push(e(5, -3, 7, 2, EL.Back, 8, 3));
  H.push(c(10, -1, 24, 1, 4, 2, EL.Skin, 5, 4));
  if (r.closed) H.push(c(4, -2.5, 8, -2.5, 1, 1, EL.Lid, 20, 1, true));
  else H.push(e(6, -2.5, 2, 2, M.Eye, 20, 1));
  if (r.jaw > 0.08) {
    H.push(e(14, 3, 10, 1 + r.jaw * 6, M.Mouth, 3, 2));
    // Longues dents en aiguille de la mâchoire supérieure, pointées vers le bas et l'avant.
    for (let x = 9; x <= 23; x += 3.5) H.push(c(x, 1.5, x + 1, 5, 1, 1, EL.Tooth, 14, 1, true));
  }
  // Mâchoire inférieure, articulée sous l'œil.
  const J: Prim[] = [c(1, 3.5, 22, 3, 3.5, 1.6, EL.Skin, 4, 3), c(2, 5, 16, 4.5, 2, 1.2, EL.Belly, 7, 2)];
  if (r.jaw > 0.08) for (let x = 10; x <= 21; x += 3.5) J.push(c(x, 2.5, x + 1, -1, 1, 1, EL.Tooth, 14, 1, true));
  else {
    // Gueule fermée : les dents s'entrecroisent et dépassent des lèvres, comme une nasse.
    J.push(c(6, 2, 23, 1.5, 1, 1, EL.Lid, 16, 1, true));
    for (const x of [12, 17, 22]) J.push(c(x, 0, x, 4, 1, 1, EL.Tooth, 18, 1, true));
  }
  // Poisson pris entre les dents, avalé à la fin du repas.
  if (eat && t < 0.75) J.push(e(24, 2, 7, 2.6, EL.Fish, 12, 3), c(17, 2, 13, 0, 2, 1, EL.Fish, 11, 2), c(17, 2, 13, 4, 2, 1, EL.Fish, 11, 2));
  H.push(...rot(J, 1, 3, r.jaw * 0.5));
  return H;
}

export function elasmosaurusModel(pose: Pose): Prim[] {
  const r = elasmoRig(pose);
  const P: Prim[] = [];
  const cy = CY + r.dy, x0 = r.dx;

  // --- Nageoires du côté lointain (dans l'ombre, derrière le corps) ---
  P.push(...flipper(x0 + 26, cy + 3, 1, r.frontFar, EL.Far, -30));
  P.push(...flipper(x0 - 18, cy + 4, 0.88, r.rearFar, EL.Far, -30));

  // --- Queue courte et effilée ---
  const tw = r.tail;
  P.push(c(x0 - 28, cy + 1, x0 - 54, cy + 3 + tw * 0.4, 11, 5.5, EL.Skin, 0, 9));
  P.push(c(x0 - 54, cy + 3 + tw * 0.4, x0 - 76, cy + 5 + tw, 5.5, 1.2, EL.Skin, 0, 5));
  P.push(c(x0 - 30, cy - 6, x0 - 70, cy + 2 + tw, 3, 1, EL.Back, 5, 3));

  // --- Tronc large et aplati, en goutte : dos sombre, ventre pâle (contre-ombrage), taches claires ---
  P.push(e(x0, cy, 40, 17, EL.Skin, 0, 17));
  P.push(e(x0 + 2, cy - 9, 34, 7, EL.Back, 8, 7, undefined, cy - 6));
  P.push(e(x0, cy + 9, 34, 7, EL.Belly, 4, 8, cy + 5));
  for (const [sx, sy] of [[18, -9], [-4, -11], [-22, -8], [6, -6]] as const) P.push(e(x0 + sx, cy + sy, 2.4, 1.6, EL.Spot, 16, 1));

  // --- Cou : chaîne de capsules qui s'affine vers la tête, dessus sombre et dessous pâle ---
  const { X, Y, a } = neckChain(r);
  for (let i = 0; i < NECK_N; i++) {
    const ra = lerp(12, 5, i / NECK_N), rb = lerp(12, 5, (i + 1) / NECK_N);
    const ax = X[i], ay = Y[i], bx = X[i + 1], by = Y[i + 1];
    const dl = Math.hypot(bx - ax, by - ay) || 1;
    // Normale « vers le haut » du segment (à gauche du sens de marche, écran y vers le bas).
    const nx = (by - ay) / dl, ny = -(bx - ax) / dl;
    P.push(c(ax, ay, bx, by, ra, rb, EL.Skin, 2, ra * 0.9));
    P.push(c(ax + nx * ra * 0.45, ay + ny * ra * 0.45, bx + nx * rb * 0.45, by + ny * rb * 0.45, ra * 0.5, rb * 0.5, EL.Back, 2 + ra * 0.4, ra * 0.5));
    P.push(c(ax - nx * ra * 0.5, ay - ny * ra * 0.5, bx - nx * rb * 0.5, by - ny * rb * 0.5, ra * 0.45, rb * 0.45, EL.Belly, 2 + ra * 0.4, ra * 0.5));
  }

  // --- Tête : petite, au bout du cou ---
  const hx = X[NECK_N], hy = Y[NECK_N];
  const H = head(r, pose.action === "eat", pose.actionT).map((p) => {
    if (p.k === "c") return { ...p, ax: p.ax + hx, ay: p.ay + hy, bx: p.bx + hx, by: p.by + hy };
    return { ...p, x: p.x + hx, y: p.y + hy };
  });
  P.push(...rot(H, hx, hy, a + r.head));

  // --- Souffle quand la tête crève la surface ---
  if (pose.action === "call" && pose.actionT > 0.2 && pose.actionT < 0.8) {
    const u = (pose.actionT - 0.2) / 0.6;
    P.push(e(hx + 14, hy - 12 - u * 10, 3 + u * 3, 2 + u * 2, EL.Bubble, 40, 2));
  }

  // --- Nageoires proches : avant et arrière, presque aussi longues ---
  P.push(...flipper(x0 + 24, cy + 7, 1, r.front, EL.Fin, 34));
  P.push(...flipper(x0 - 20, cy + 8, 0.88, r.rear, EL.Fin, 34));

  if (pose.action === "dead") return flipY(P, CY, 6).map((p) => scalePrim(p, ELASMOSAURUS_SCALE));
  return P.map((p) => scalePrim(p, ELASMOSAURUS_SCALE));
}

/** Position de l'œil au repos (px bruts), tirée de la chaîne du cou en « idle ». */
const EYE = (() => {
  const r = elasmoRig({ walk: 0, moving: 0, time: 0, action: "idle", actionT: 0 });
  const { X, Y, a } = neckChain(r);
  const ca = Math.cos(a + r.head), sa = Math.sin(a + r.head);
  return { x: X[NECK_N] + 6 * ca + 2.5 * sa, y: Y[NECK_N] + 6 * sa - 2.5 * ca };
})();

/**
 * Squelette (format : voir ankyloSkeleton), flottant au repos, regard à droite.
 * Cou de ~70 vertèbres (une perle sur deux dessinée), côtes et gastralia en panier sous le tronc.
 */
export function elasmosaurusSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const r = elasmoRig({ walk: 0, moving: 0, time: 0, action: "idle", actionT: 0 });
  r.wave = 0;
  const { X, Y, a } = neckChain(r);

  // Cou : vertèbres en chapelet, de plus en plus petites vers la tête.
  for (let i = 0; i < NECK_N; i++) {
    for (const u of [0.25, 0.75]) {
      const x = lerp(X[i], X[i + 1], u), y = lerp(Y[i], Y[i + 1], u), rr = lerp(4.5, 2, (i + u) / NECK_N);
      tag("cou", e(x, y, rr * 0.9, rr, B, 10, 2), c(x, y - rr, x - 1, y - rr - 2.5, 1, 1, B, 12, 1, true));
    }
  }
  // Crâne : petit, grandes orbites, longues dents en aiguille entrecroisées.
  const hx = X[NECK_N], hy = Y[NECK_N];
  const S: Prim[] = [
    e(hx + 5, hy, 8, 4.5, B, 12, 5), c(hx + 10, hy - 1, hx + 23, hy + 1, 3, 1.5, B, 12, 3),
    c(hx + 1, hy + 4, hx + 22, hy + 3, 2, 1.2, B, 12, 2),
    e(hx + 6, hy - 1.5, 2.5, 2.2, M.Socket, 30, 1), e(hx + 0, hy - 1, 1.8, 1.6, M.Socket, 30, 1),
    ...[11, 14, 17, 20, 23].map((d) => c(hx + d, hy + 1, hx + d + 0.5, hy + 5, 1, 1, M.Tooth, 20, 1, true)),
  ];
  tag("crane", ...rot(S, hx, hy, a + r.head));
  // Côtes et gastralia : panier d'os sous le tronc (les gastralia ferment le ventre).
  for (let x = 24; x >= -20; x -= 8) {
    const d = 1 - Math.abs(x - 2) / 30;
    tag("cotes", c(x, CY - 8, x - 3, CY + 6 + d * 4, 1, 1, B, 8, 2, true));
    tag("cotes", c(x - 4, CY + 11 + d * 2, x + 3, CY + 12 + d * 2, 1, 1, B, 8, 2, true));
  }
  // Colonne du dos : vertèbres et épines.
  for (let x = 28; x >= -26; x -= 7) tag("dos", e(x, CY - 7, 3.5, 3, B, 10, 3), c(x, CY - 10, x - 2, CY - 14, 1, 1, B, 12, 1, true));
  // Ceintures : grandes plaques plates (coracoïdes et pubis) qui ancraient les muscles des nageoires.
  tag("ceintures", e(22, CY + 10, 10, 3, B, 14, 3), e(-16, CY + 11, 9, 3, B, 14, 3));
  // Nageoires : humérus / fémur trapus, puis très longues rangées de phalanges.
  for (const [id, ax, ay, s] of [["nageoires-av", 24, CY + 8, 1], ["nageoires-ar", -20, CY + 9, 0.88]] as const) {
    tag(id, c(ax, ay, ax - 12 * s, ay + 5 * s, 3.5, 3, B, 16, 3));
    for (let f = 0; f < 3; f++) for (let j = 0; j < 5; j++) tag(id, e(ax - (17 + j * 8 + f * 2) * s, ay + (6 + j * 2 + f * 2) * s, 2.4, 1.2, B, 16, 1));
  }
  // Queue : courte, vertèbres de plus en plus petites.
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    tag("queue", e(-32 - t * 44, CY - 4 + t * 8, 3.4 - t * 2, 2.6 - t, B, 10, 2));
  }
  return P.map((p) => scalePrim(p, ELASMOSAURUS_SCALE));
}

export const ELASMOSAURUS: Species = {
  id: "elasmosaurus",
  name: "Elasmosaure",
  latin: "Elasmosaurus platyurus",
  period: "Crétacé supérieur, 80 Ma",
  place: "Formation de Pierre Shale, Kansas (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 2000,
  facts: [
    { id: "cou", title: "Un cou de 7 mètres", unlock: "discover",
      text: "Sur ses 10 mètres de long, l'élasmosaure en avait environ 7 rien que pour le cou ! Il comptait plus de 70 vertèbres cervicales, alors qu'une girafe n'en a que 7." },
    { id: "queue", title: "La tête au bout de la queue", unlock: "assemble",
      text: "En 1868, le paléontologue Edward Drinker Cope a monté le squelette à l'envers : il a mis la tête au bout de la queue ! Son rival Othniel Marsh s'en est moqué. Ce fut le début de la « guerre des os » entre les deux savants." },
    { id: "dents", title: "Une nasse à poissons", unlock: "eat",
      text: "Sa petite tête portait de longues dents fines comme des aiguilles, qui s'entrecroisaient quand la gueule se fermait. Parfait pour piéger des poissons glissants et des calmars." },
    { id: "cygne", title: "Pas un cou de cygne", unlock: "call",
      text: "On l'a souvent dessiné le cou dressé hors de l'eau comme un cygne. En réalité, ce cou très lourd était peu souple : il le tenait plutôt à l'horizontale, et ne sortait que la tête pour respirer." },
    { id: "cailloux", title: "Des cailloux dans le ventre", unlock: "rest",
      text: "On a retrouvé des galets, appelés gastrolithes, dans le ventre de plusieurs plésiosaures. Servaient-ils de lest pour mieux plonger, ou à broyer la nourriture ? Les chercheurs en discutent encore." },
    { id: "bebe", title: "Un bébé né dans l'eau", unlock: "baby",
      text: "En 2011, des chercheurs ont décrit un plésiosaure fossile avec un grand bébé dans le ventre. Les plésiosaures ne pondaient donc pas d'œufs : ils donnaient naissance à un seul gros petit, directement en mer." },
    { id: "reptile", title: "Pas un dinosaure", unlock: "hunt",
      text: "L'élasmosaure n'est pas un dinosaure mais un reptile marin, un plésiosaure. Il « volait » sous l'eau en ramant avec ses quatre grandes nageoires, comme une tortue de mer." },
  ],
  bones: [
    { id: "crane", name: "Crâne et dents" },
    { id: "cou", name: "Cou (vertèbres cervicales)" },
    { id: "dos", name: "Colonne du dos" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "ceintures", name: "Ceintures (épaules et bassin)" },
    { id: "nageoires-av", name: "Nageoires avant" },
    { id: "nageoires-ar", name: "Nageoires arrière" },
    { id: "queue", name: "Queue" },
  ],
  model: elasmosaurusModel,
  skeleton: elasmosaurusSkeleton,
  center: { x: 0, y: CY * ELASMOSAURUS_SCALE },
  eye: { x: EYE.x * ELASMOSAURUS_SCALE, y: EYE.y * ELASMOSAURUS_SCALE },
  feet: [24, -20].map((x) => x * ELASMOSAURUS_SCALE),
  halfLen: 175 * ELASMOSAURUS_SCALE,
  shadow: 0.3,
  walkSpeed: 35,
  runSpeed: 110,
  stride: 3,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: [], defense: "flee", sight: 460, scavenger: false },
  habitat: "sea",
  birth: "live",
};
