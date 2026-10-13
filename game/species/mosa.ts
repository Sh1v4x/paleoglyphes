import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { MR } from "./marine.mat";
import { c, e, lerp, rot, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Mosasaure modélisé en primitives (px locaux, regard vers la droite).
 * Origine = point de la ligne de flottaison (y = 0) sous le centre du corps : le corps est immergé
 * (y > 0), seul le haut du dos affleure ; la tête ne sort de l'eau que pour « call » et « dead ».
 * Le modèle brut mesure ~395 px du bout du museau à la pointe de la nageoire caudale.
 */
const LENGTH_M = 13;
export const MOSA_SCALE = (LENGTH_M * PX_PER_M) / 395;

/** Colonne au repos : abscisses des nœuds (du cou à la queue) et rayon du corps à chaque nœud. */
const SX = [138, 110, 78, 44, 10, -24, -58, -90, -118, -144, -166];
const SR = [17, 20, 22, 23, 22, 19, 15, 11.5, 8.5, 6.5, 5];
const SY = SX.map((x) => 18 + Math.max(0, -x - 30) * 0.05);
const EYE = { x: 160, y: 6 };

/** Réglages de pose, déduits de l'action. */
interface MosaRig {
  /** Ondulation : phase, amplitude (px au bout de la queue). */
  ph: number;
  amp: number;
  /** Battement des nageoires (rad). */
  fin: number;
  dx: number;
  dy: number;
  /** Tête : rotation autour du cou (- = museau vers le haut), soulèvement de l'avant du corps. */
  head: number;
  lift: number;
  jaw: number;
  closed: boolean;
}

function mosaRig({ action, actionT: t, time, walk, moving }: Pose): MosaRig {
  const swim = action === "walk" || action === "run";
  const fast = action === "run";
  const r: MosaRig = {
    ph: swim ? walk : time * 1.4, amp: swim ? lerp(3, fast ? 20 : 13, moving) : 3,
    fin: swim ? Math.sin(walk + 0.6) * (fast ? 0.5 : 0.35) * moving : Math.sin(time * 1.2) * 0.12,
    dx: 0, dy: 0, head: Math.sin(time * 0.9) * 0.02, lift: 0, jaw: 0, closed: false,
  };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "eat": {
      // Croque puis avale : la tête se relève par saccades pour faire glisser la proie.
      const chomp = Math.abs(Math.sin(t * Math.PI * 5));
      Object.assign(r, { jaw: chomp * 0.7, head: -0.08 - Math.max(0, s) * 0.12 });
      break;
    }
    case "rest":
      Object.assign(r, { amp: 1.2, ph: time * 0.6, fin: Math.sin(time * 0.5) * 0.05, dy: 5, closed: true });
      break;
    case "call": {
      // Tête dressée hors de l'eau, gueule ouverte.
      const k = Math.sin(Math.min(1, t * 1.3) * Math.PI);
      Object.assign(r, { head: -0.55 * k, lift: 14 * k, jaw: (0.6 + 0.25 * Math.abs(s)) * k, amp: 2 });
      break;
    }
    case "attack": {
      // Recule (0-0.35) gueule grande ouverte, bondit en avant (0.35-0.6), claque et secoue.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.5));
      const lunge = win(t, 0.35, 0.55) * (1 - win(t, 0.75, 1));
      Object.assign(r, {
        dx: lunge * 30 - wind * 8, head: -0.14 * wind + 0.06 * lunge + win(t, 0.6, 0.7) * Math.sin(t * 50) * 0.05,
        jaw: Math.max(wind, lunge) * (1 - win(t, 0.55, 0.62) * 0.9), amp: 6 + 10 * lunge, ph: time * 3 + t * 8, fin: -0.4 * lunge,
      });
      break;
    }
    case "defend":
      // Fouette l'eau de la queue, gueule entrouverte.
      Object.assign(r, { amp: 18, ph: time * 9, jaw: 0.3 + 0.1 * s, fin: Math.sin(time * 9) * 0.3 });
      break;
    case "dead":
      Object.assign(r, { amp: 0, fin: 0.3, head: 0.1, jaw: 0.25, closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Retourne verticalement autour de y = cy (ventre en l'air), puis décale. */
function flipY(ps: Prim[], cy: number, dy: number): Prim[] {
  const f = (y: number) => 2 * cy - y + dy;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: f(p.ay), by: f(p.by) };
    if (p.k === "cut") return { ...p, y: f(p.y) };
    return { ...p, y: f(p.y), yMin: p.yMax === undefined ? undefined : f(p.yMax), yMax: p.yMin === undefined ? undefined : f(p.yMin) };
  });
}

export function mosaModel(pose: Pose): Prim[] {
  const r = mosaRig(pose);
  const n = SX.length - 1;
  // Ondulation : vague qui se propage de la tête vers la queue et s'amplifie vers l'arrière.
  const wave = (k: number) => r.amp * (0.06 + Math.pow(k / n, 1.7)) * Math.sin(r.ph - k * 0.75);
  const X = SX.map((x) => x + r.dx);
  const Y = SY.map((y, k) => y + r.dy + wave(k) - r.lift * Math.max(0, 1 - k / 4));
  const at = (x: number) => {
    for (let k = 0; k < n; k++) if (x <= X[k] && x >= X[k + 1]) return lerp(Y[k], Y[k + 1], (X[k] - x) / (X[k] - X[k + 1]));
    return x > X[0] ? Y[0] : Y[n];
  };
  const P: Prim[] = [];

  // --- Nageoires : avant (pagaie longue) et arrière, lointaines puis proches ---
  for (const far of [true, false]) {
    const m = far ? MR.MFinFar : MR.MFin;
    const z = far ? -40 : 34;
    const o = far ? -6 : 0;
    for (const [fx, len, w, ph] of [[100, 1, 1, 0], [-26, 0.72, 0.75, 0.8]] as const) {
      const ax = fx + o + r.dx, ay = at(fx) + 14 * w;
      const a = r.fin * (far ? -1 : 1) * (ph ? -1 : 1);
      P.push(...rot([
        c(ax, ay, ax - 20 * len, ay + 22 * len, 7 * w, 9 * w, m, z, 6),
        e(ax - 25 * len, ay + 26 * len, 11 * w, 6 * w, m, z + 2, 5),
        c(ax - 6, ay + 8, ax - 26 * len, ay + 28 * len, 1, 1, MR.MStripe, z + 8, 1, true),
      ], ax, ay, a));
    }
  }

  // --- Corps : capsules le long de la colonne, ventre pâle, dos sombre, bandes et écailles ---
  for (let k = 0; k < n; k++) {
    const ax = X[k], ay = Y[k], bx = X[k + 1], by = Y[k + 1], ra = SR[k], rb = SR[k + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mr = (ra + rb) / 2, hl = Math.abs(ax - bx) / 2;
    P.push(c(ax, ay, bx, by, ra, rb, MR.MSkin, 0, mr * 0.9));
    P.push(e(mx, my + mr * 0.55, hl * 1.25, mr * 0.5, MR.MBelly, mr * 0.25, mr * 0.55, my + mr * 0.2));
    P.push(e(mx, my - mr * 0.72, hl * 1.2, mr * 0.32, MR.MBack, mr * 0.45, mr * 0.45, undefined, my - mr * 0.5));
    if (k >= 1 && k <= 7 && k % 2) P.push(c(mx + 4, my - mr * 0.5, mx, my + mr * 0.15, mr * 0.12 + 1.5, 1.5, MR.MStripe, mr * 0.75, 2));
    if (k <= 6) P.push(e(mx - hl * 0.4, my - mr * 0.1, 2.5, 1.8, MR.MScale, mr * 0.88, 2), e(mx + hl * 0.4, my + mr * 0.1, 2.5, 1.8, MR.MScale, mr * 0.88, 2));
  }

  // --- Nageoire caudale en croissant (lobe inférieur porté par les vertèbres coudées) ---
  const tx = X[n], ty = Y[n];
  const ta = Math.atan2(Y[n] - Y[n - 1], X[n - 1] - X[n]) * 0.8;
  P.push(...rot([
    c(tx + 4, ty + 1, tx - 34, ty + 38, 8, 2, MR.MFluke, 2, 6),
    c(tx + 2, ty - 1, tx - 36, ty - 26, 7, 1.5, MR.MFluke, 2, 5),
    e(tx - 9, ty + 3, 12, 10, MR.MFluke, 1, 7),
    c(tx + 2, ty + 1, tx - 30, ty + 34, 1, 1, MR.MBack, 9, 1, true),
  ], tx, ty, -ta));

  // --- Tête : crâne allongé, museau pointu, mâchoires à dents coniques ---
  const H: Prim[] = [];
  const hx = 140 + r.dx, hy = Y[0] - 2;
  H.push(c(hx + 6, hy, hx - 22, hy + 2, 16, 19, MR.MSkin, 0, 16));
  H.push(e(hx + 12, hy - 4, 20, 12, MR.MSkin, 2, 12));
  H.push(c(hx + 10, hy - 6, hx + 56, hy + 2, 10, 3.5, MR.MSkin, 3, 9));
  H.push(e(hx + 14, hy - 12, 18, 5, MR.MBack, 8, 5, undefined, hy - 9));
  H.push(e(hx + 44, hy - 4, 2, 1.2, M.Socket, 14, 1));
  if (r.closed) H.push(c(EYE.x - 3 + r.dx, hy - 10, EYE.x + 3 + r.dx, hy - 10, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(EYE.x + r.dx, hy - 10, 3, 4, M.Eye, 20, 1));
  // Gorge pâle, intérieur de la gueule, dents de la mâchoire supérieure.
  H.push(e(hx - 10, hy + 12, 22, 8, MR.MBelly, 6, 8, hy + 8));
  if (r.jaw > 0.08) {
    H.push(e(hx + 26, hy + 8, 30, 4 + r.jaw * 12, MR.MMouth, 2, 3, hy + 4));
    for (let x = hx + 12; x <= hx + 52; x += 6.5) H.push(e(x, hy + 6, 2.2, 3.4, MR.MTooth, 14, 2));
  } else for (const x of [hx + 22, hx + 34, hx + 46]) H.push(e(x, hy + 7, 1.6, 2.4, MR.MTooth, 14, 2));
  // Mâchoire inférieure (articulée au milieu, comme celle des serpents et des varans).
  const J: Prim[] = [
    c(hx - 6, hy + 8, hx + 52, hy + 6, 9, 3, MR.MSkin, 3, 8),
    c(hx - 4, hy + 13, hx + 46, hy + 9, 4, 2, MR.MBelly, 8, 3),
  ];
  if (r.jaw > 0.08) {
    for (let x = hx + 14; x <= hx + 48; x += 6.5) J.push(e(x, hy + 2, 2, 3, MR.MToothUp, 12, 2));
    J.push(e(hx + 18, hy + 4, 18, 2.5, MR.MTongue, 9, 2));
  } else J.push(c(hx + 4, hy + 5, hx + 54, hy + 4, 1, 1, MR.MLip, 16, 1, true));
  H.push(...rot(J, hx - 6, hy + 6, r.jaw * 0.55));
  P.push(...rot(H, hx - 18, hy + 2, r.head));

  if (pose.action === "dead") return flipY(P, 18, -16).map((p) => scalePrim(p, MOSA_SCALE));
  return P.map((p) => scalePrim(p, MOSA_SCALE));
}

/** Squelette (format : voir ankyloSkeleton). Nageant à plat, regard à droite. */
export function mosaSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const hx = 140, hy = 16;

  // Crâne : museau pointu, grandes orbites, narines reculées, dents coniques et dents du palais.
  tag("crane",
    e(hx + 10, hy - 4, 18, 9, B, 12, 8), c(hx + 10, hy - 5, hx + 56, hy + 2, 8, 3, B, 12, 6),
    e(EYE.x, hy - 8, 4, 3.5, M.Socket, 30, 1), e(hx + 38, hy - 4, 7, 2, M.Socket, 30, 1), e(hx + 2, hy - 6, 4, 3, M.Socket, 30, 1),
    ...[12, 19, 26, 33, 40, 47].map((d) => e(hx + d, hy + 5, 1.8, 2.8, M.Tooth, 20, 2)),
    ...[2, 8].map((d) => e(hx + d, hy + 3, 1.4, 2, M.Tooth, 20, 2)));
  // Mâchoire inférieure, avec son articulation au milieu (point d'ouverture supplémentaire).
  tag("machoire", c(hx - 8, hy + 10, hx + 52, hy + 8, 5, 2.5, B, 12, 4), e(hx + 18, hy + 9, 2.5, 2.5, M.Socket, 30, 1),
    ...[14, 21, 28, 35, 42, 48].map((d) => e(hx + d, hy + 4, 1.8, 2.6, MR.MToothUp, 20, 2)));
  // Colonne : vertèbres du cou au bassin, épines dorsales.
  for (let x = 128; x >= -30; x -= 11) {
    const y = 16 + Math.max(0, -x - 30) * 0.05;
    tag("vertebres", e(x, y, 4.5, 3.5, B, 10, 3), c(x, y - 3, x - 3, y - 10, 1, 1, B, 12, 1, true));
  }
  // Côtes : longues et arquées sur le tronc.
  for (let x = 116; x >= -16; x -= 11) {
    const d = 1 - Math.abs(x - 50) / 110;
    tag("cotes", c(x, 19, x - 4, 19 + 10 + d * 6, 1, 1, B, 8, 2, true), c(x - 4, 29 + d * 6, x - 10, 32 + d * 8, 1, 1, B, 8, 2, true));
  }
  // Nageoires : humérus trapu, avant-bras, puis une pagaie de nombreuses petites phalanges.
  for (const [ax, ay, s] of [[100, 32, 1], [-26, 30, 0.72]] as const) {
    tag("nageoires", c(ax, ay, ax - 5 * s, ay + 8 * s, 4 * s, 3.5 * s, B, 14, 3), c(ax - 5 * s, ay + 8 * s, ax - 10 * s, ay + 14 * s, 3, 2.5, B, 14, 2));
    for (let f = 0; f < 3; f++) for (let j = 0; j < 3; j++) {
      tag("nageoires", e(ax - (12 + j * 6 + f * 3) * s, ay + (16 + j * 5 + f * 2) * s, 2, 1.6, B, 14, 1));
    }
  }
  // Bassin : petits os qui ne touchent plus la colonne (vestigial).
  tag("bassin", c(-20, 22, -26, 34, 2.5, 2, B, 12, 2), c(-28, 26, -36, 32, 2, 1.5, B, 12, 2));
  // Queue : vertèbres caudales, puis coude vers le bas qui portait le lobe inférieur de la nageoire.
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const x = -40 - t * 126, y = 18 + Math.max(0, -x - 30) * 0.05;
    tag("queue", e(x, y, 4 - t * 2, 3 - t, B, 10, 3), c(x, y + 2, x - 2, y + 9 - t * 3, 1, 1, B, 12, 1, true));
  }
  for (let k = 1; k <= 5; k++) {
    const x = -166 - k * 6, y = 25 + k * 5;
    tag("queue", e(x, y, 2, 1.6, B, 10, 2), c(x, y - 2, x - 4, y - 8, 1, 1, B, 12, 1, true));
  }
  return P.map((p) => scalePrim(p, MOSA_SCALE));
}

export const MOSA: Species = {
  id: "mosa",
  name: "Mosasaure",
  latin: "Mosasaurus hoffmannii",
  period: "Crétacé supérieur, 70-66 Ma",
  place: "Carrières de Maastricht (Pays-Bas) ; mers d'Europe et d'Amérique du Nord",
  lengthM: LENGTH_M,
  massKg: 10000,
  facts: [
    { id: "lezard", title: "Un lézard géant des mers", unlock: "discover",
      text: "Le mosasaure n'est pas un dinosaure : c'est un squamate, un lézard marin cousin des varans et des serpents. Avec 13 mètres, c'est l'un des plus grands." },
    { id: "meuse", title: "Le lézard de la Meuse", unlock: "assemble",
      text: "Son premier crâne a été trouvé vers 1764 dans une carrière près de Maastricht, aux Pays-Bas, au bord de la Meuse. « Mosasaurus » veut dire « lézard de la Meuse »." },
    { id: "machoire", title: "Une gueule de serpent", unlock: "eat",
      text: "Sa mâchoire inférieure avait une articulation en plus, au milieu, et son palais portait deux rangées de dents. Comme un serpent, il « marchait » sur sa proie avec ses dents pour l'avaler entière." },
    { id: "air", title: "Il respirait de l'air", unlock: "call",
      text: "Pas de branchies : le mosasaure avait des poumons. Il devait remonter à la surface pour respirer, comme les baleines et les dauphins aujourd'hui." },
    { id: "bebes", title: "Des bébés nés en mer", unlock: "rest",
      text: "Les mosasaures ne pondaient pas d'œufs sur la plage : on a trouvé des fossiles de femelles avec des petits dans le ventre. Les bébés naissaient directement dans l'eau." },
    { id: "menu", title: "Tout est au menu", unlock: "attack",
      text: "Poissons, tortues, oiseaux plongeurs, ammonites… et même d'autres mosasaures ! Des coquilles d'ammonites portent encore les trous ronds laissés par ses dents." },
    { id: "queue", title: "Une queue de requin", unlock: "defend",
      text: "Des fossiles avec l'empreinte de la peau montrent que les mosasaures avaient une nageoire en croissant au bout de la queue, comme les requins. Le bout de la colonne se courbe vers le bas pour la porter." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes" },
    { id: "nageoires", name: "Nageoires" },
    { id: "bassin", name: "Bassin (vestigial)" },
    { id: "queue", name: "Queue et nageoire caudale" },
  ],
  model: mosaModel,
  skeleton: mosaSkeleton,
  center: { x: 0, y: 18 * MOSA_SCALE },
  eye: { x: EYE.x * MOSA_SCALE, y: EYE.y * MOSA_SCALE },
  feet: [100, -26].map((x) => x * MOSA_SCALE),
  halfLen: 195 * MOSA_SCALE,
  shadow: 0.3,
  walkSpeed: 40,
  runSpeed: 150,
  stride: 3,
  behavior: { diet: "carnivore", herd: [1, 1], browse: null, prey: [], defense: "bite", sight: 500, scavenger: true },
  habitat: "sea",
};
