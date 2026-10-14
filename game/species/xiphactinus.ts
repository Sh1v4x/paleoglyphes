import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { MR } from "./marine.mat";
import { XR } from "./xiphactinus.mat";
import { c, e, lerp, rot, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Xiphactinus, poisson osseux géant, modélisé en primitives (px locaux, regard vers la droite).
 * Origine = point de la ligne de flottaison (y = 0) au-dessus du centre du corps : le poisson nage
 * entièrement sous l'eau, seule la pointe de la dorsale effleure la surface.
 * walk/run = nage (battements de queue rythmés par `walk`), idle = sur place (pectorales qui godillent),
 * eat = gobe un Gillicus, attack = charge gueule grande ouverte, call = saut hors de l'eau (actionT 0..1 =
 * jaillit, culmine, replonge), rest = dérive, defend = demi-tour éclair, dead = ventre en l'air en surface.
 * Le modèle brut mesure ~250 px du bout de la mâchoire à la pointe de la queue.
 */
const LENGTH_M = 5;
export const XIPHACTINUS_SCALE = (LENGTH_M * PX_PER_M) / 250;

/** Colonne au repos (de la nuque à la queue) : abscisses des nœuds et demi-hauteur du corps. */
const SX = [96, 70, 42, 14, -14, -42, -68, -90, -106];
const SR = [24, 27, 28, 27, 24, 19, 13, 8, 6];
const CY = 32;
const EYE = { x: 116, y: CY - 10 };

/** Réglages de pose, déduits de l'action. */
interface XiphRig {
  /** Ondulation : phase et amplitude (px au bout de la queue). */
  ph: number;
  amp: number;
  /** Pectorales (rad). */
  pec: number;
  dx: number;
  dy: number;
  /** Rotation de tout le corps (rad, - = museau vers le haut), autour du centre. */
  tilt: number;
  jaw: number;
  /** Raccourci horizontal (demi-tour) : 1 = de profil. */
  sx: number;
}

function xiphRig({ action, actionT: t, time, walk, moving }: Pose): XiphRig {
  const swim = action === "walk" || action === "run";
  const fast = action === "run";
  const r: XiphRig = {
    ph: swim ? walk : time * 1.6, amp: swim ? lerp(3, fast ? 22 : 14, moving) : 4,
    pec: swim ? 0.15 * moving : Math.sin(time * 3) * 0.25, dx: 0, dy: 0, tilt: 0, jaw: 0.05, sx: 1,
  };
  switch (action) {
    case "eat":
      // Engloutit sa proie par bouchées : la gueule s'ouvre et se referme, le corps pousse en avant.
      Object.assign(r, { jaw: Math.abs(Math.sin(t * Math.PI * 3)) * 0.7, dx: Math.sin(t * Math.PI * 6) * 2, amp: 7 });
      break;
    case "rest":
      Object.assign(r, { amp: 1.5, ph: time * 0.7, pec: Math.sin(time * 0.8) * 0.1, dy: 6, tilt: 0.05, jaw: 0 });
      break;
    case "call": {
      // Saut : jaillit museau en l'air, décrit un arc et replonge tête la première.
      const u = Math.min(1, Math.max(0, t));
      Object.assign(r, { tilt: lerp(-0.75, 0.75, u), dy: -Math.sin(u * Math.PI) * 112, amp: 10, ph: time * 10, pec: -0.4, jaw: 0.15 });
      break;
    }
    case "attack": {
      // Recule (0-0.3) gueule béante, fonce (0.3-0.55), mâchoires qui claquent, puis revient.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.3, 0.45));
      const lunge = win(t, 0.3, 0.5) * (1 - win(t, 0.7, 1));
      Object.assign(r, {
        dx: lunge * 36 - wind * 10, jaw: Math.max(wind, lunge) * (1 - win(t, 0.52, 0.58) * 0.95), amp: 8 + 16 * lunge,
        ph: time * 4 + t * 12, pec: -0.5 * lunge + 0.3 * wind, tilt: -0.08 * wind,
      });
      break;
    }
    case "defend": {
      // Demi-tour éclair : le corps se plie en C et se présente presque de face.
      const k = Math.sin(Math.min(1, t * 1.4) * Math.PI);
      Object.assign(r, { sx: 1 - 0.6 * k, amp: 22 * k + 4, ph: Math.PI / 2, pec: 0.6 * k, jaw: 0.1 });
      break;
    }
    case "dead":
      Object.assign(r, { amp: 0, pec: 0.5, jaw: 0.35 });
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

/** Raccourcit horizontalement autour de x = 0 (poisson vu de trois quarts pendant un virage). */
function squeezeX(ps: Prim[], s: number): Prim[] {
  if (s >= 0.999) return ps;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ax: p.ax * s, bx: p.bx * s, ra: p.ra * Math.max(s, 0.7), rb: p.rb * Math.max(s, 0.7) };
    return { ...p, x: p.x * s, rx: p.rx * Math.max(s, 0.55) };
  });
}

/** Petit Gillicus (la proie) : corps argenté et queue fourchue, tête vers la gauche. */
function gillicus(x: number, y: number, z: number): Prim[] {
  return [
    c(x, y, x + 26, y + 2, 7, 3, XR.Silver, z, 6),
    e(x + 4, y - 3, 10, 3, XR.Back, z + 3, 2),
    c(x + 26, y + 2, x + 34, y - 6, 2.5, 1, XR.Fin, z, 2),
    c(x + 26, y + 2, x + 34, y + 9, 2.5, 1, XR.Fin, z, 2),
  ];
}

export function xiphactinusModel(pose: Pose): Prim[] {
  const r = xiphRig(pose);
  const n = SX.length - 1;
  // Ondulation : nulle à la tête, forte à la queue (nage « thunniforme » des grands chasseurs).
  const wave = (k: number) => r.amp * Math.pow(k / n, 2) * Math.sin(r.ph - k * 0.6);
  const X = SX.map((x) => x + r.dx);
  const Y = SY(wave);
  const P: Prim[] = [];

  // --- Pectorale lointaine, derrière le corps ---
  const pec = (ox: number, oy: number, m: number, z: number, a: number) =>
    rot([c(ox, oy, ox - 46, oy + 18, 5, 1.5, m, z, 4), c(ox - 2, oy + 4, ox - 34, oy + 20, 4, 1.2, m, z, 3)], ox, oy, a);
  P.push(...pec(X[1] + 14, Y[1] + 14, XR.Fin, -30, -r.pec * 0.7));

  // --- Nageoires impaires : dorsale et anale reculées (comme chez le brochet), pelviennes ---
  const fin = (k: number, up: boolean, len: number) => {
    const fx = (X[k] + X[k + 1]) / 2, fy = (Y[k] + Y[k + 1]) / 2 + (up ? -1 : 1) * (SR[k] - 3);
    const s = up ? -1 : 1;
    P.push(c(fx + 8, fy, fx - 14, fy + s * len, 6, 1.5, XR.Fin, -4, 5), c(fx - 6, fy, fx - 16, fy + s * len * 0.8, 4, 1, XR.Fin, -4, 4));
  };
  fin(4, true, 24);
  fin(4, false, 18);
  fin(2, false, 12);

  // --- Corps : flancs argentés, dos bleu sombre, ventre blanc (contre-ombrage) ---
  for (let k = 0; k < n; k++) {
    const ax = X[k], ay = Y[k], bx = X[k + 1], by = Y[k + 1], ra = SR[k], rb = SR[k + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mr = (ra + rb) / 2, hl = Math.abs(ax - bx) / 2;
    P.push(c(ax, ay, bx, by, ra, rb, XR.Silver, 0, mr * 0.9));
    P.push(e(mx, my - mr * 0.62, hl * 1.25, mr * 0.42, XR.Back, mr * 0.55, mr * 0.45, undefined, my - mr * 0.35));
    P.push(e(mx, my + mr * 0.6, hl * 1.2, mr * 0.45, XR.Belly, mr * 0.5, mr * 0.45, my + mr * 0.3));
  }

  // --- Queue fourchue (homocerque), qui suit l'angle du pédoncule ---
  const tx = X[n], ty = Y[n];
  const ta = Math.atan2(Y[n] - Y[n - 1], X[n - 1] - X[n]) * 0.6;
  P.push(...rot([
    e(tx - 6, ty, 10, 9, XR.Fin, 2, 5),
    c(tx - 4, ty - 4, tx - 32, ty - 38, 9, 2.5, XR.Fin, 1, 5),
    c(tx - 4, ty + 4, tx - 32, ty + 38, 9, 2.5, XR.Fin, 1, 5),
  ], tx, ty, -ta));

  // --- Tête de bouledogue : front bombé, grand œil, mâchoire inférieure relevée vers le haut ---
  const hx = X[0] + 12, hy = Y[0];
  if (pose.action === "eat") {
    // Le Gillicus disparaît peu à peu dans la gueule (la tête passe devant lui).
    P.push(...gillicus(hx + 18 + 24 * (1 - pose.actionT), hy + 2, 6));
  }
  P.push(e(hx - 2, hy, 26, 24, XR.Silver, 1, 22));
  P.push(e(hx - 4, hy - 14, 22, 10, XR.Back, 12, 8, undefined, hy - 8));
  P.push(c(hx - 10, hy - 14, hx - 14, hy + 16, 1, 1, XR.Mouth, 26, 1, true));
  P.push(c(hx - 4, hy - 16, hx + 22, hy - 8, 9, 5, XR.Back, 8, 8));
  P.push(e(EYE.x + r.dx, hy - 10, 4, 4, M.Eye, 30, 1));
  if (r.jaw > 0.12) {
    P.push(e(hx + 14, hy + 2, 14, 3 + r.jaw * 12, XR.Mouth, 14, 3));
    P.push(e(hx + 20, hy - 3, 2, 3.4, XR.Fang, 24, 2), e(hx + 10, hy - 1, 1.8, 3, XR.Fang, 24, 2));
  } else P.push(e(hx + 19, hy - 3, 1.6, 2.8, XR.Fang, 24, 2));
  // Mâchoire inférieure : énorme, presque verticale à l'avant, garnie de crocs.
  const J: Prim[] = [
    c(hx - 6, hy + 14, hx + 26, hy - 2, 9, 4, XR.Silver, 10, 8),
    c(hx - 4, hy + 19, hx + 24, hy + 3, 5, 2, XR.Belly, 14, 4),
    e(hx + 25, hy - 6, 1.8, 3.4, MR.MToothUp, 26, 2),
  ];
  if (r.jaw > 0.12) J.push(e(hx + 17, hy - 2, 1.6, 3, MR.MToothUp, 26, 2), e(hx + 9, hy + 2, 1.5, 2.6, MR.MToothUp, 26, 2));
  P.push(...rot(J, hx - 6, hy + 12, r.jaw * 0.7));

  // --- Pectorale proche : longue, avec un premier rayon épais en forme de sabre ---
  P.push(...pec(X[1] + 10, Y[1] + 16, XR.Fin, 34, r.pec));
  P.push(...rot([c(X[1] + 10, Y[1] + 15, X[1] - 36, Y[1] + 32, 1, 1, XR.Back, 42, 1, true)], X[1] + 10, Y[1] + 16, r.pec));

  // --- Gerbes d'eau au départ et à l'arrivée du saut ---
  const out: Prim[] = [];
  if (pose.action === "call") {
    const t = pose.actionT;
    for (const [t0, x0] of [[0, 30], [1, -30]] as const) {
      const s = 1 - Math.min(1, Math.abs(t - t0) / 0.22);
      if (s <= 0) continue;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * (0.15 + 0.7 * (i / 4));
        out.push(e(x0 + Math.cos(a) * 26 * (1.4 - s), -Math.sin(-a) * 22 * (1.3 - s * 0.6), 3, 3, XR.Belly, 60, 2));
      }
      out.push(e(x0, -2, 30 * s + 6, 4, XR.Belly, 58, 3));
    }
  }

  let B = squeezeX(P, r.sx);
  B = rot(B, 0, CY, r.tilt, 0, r.dy);
  if (pose.action === "dead") B = flipY(B, CY, -8);
  return [...B, ...out].map((p) => scalePrim(p, XIPHACTINUS_SCALE));
}

/** Ordonnées de la colonne pour une ondulation donnée. */
function SY(wave: (k: number) => number): number[] {
  return SX.map((x, k) => CY + wave(k) + Math.max(0, -x - 40) * 0.04);
}

/** Squelette (format : voir ankyloSkeleton), de profil, avec le Gillicus avalé dans l'estomac. */
export function xiphactinusSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const hx = 108, hy = CY;

  // Crâne : front haut, grande orbite, opercule, crocs de la mâchoire supérieure.
  tag("crane",
    e(hx - 4, hy - 4, 20, 16, B, 12, 10), c(hx - 2, hy - 14, hx + 22, hy - 8, 6, 4, B, 12, 5),
    e(EYE.x, hy - 10, 5, 5, M.Socket, 30, 1), c(hx - 14, hy - 12, hx - 18, hy + 14, 1, 1, B, 18, 1, true),
    e(hx + 20, hy - 3, 2, 3.6, M.Tooth, 20, 2), e(hx + 12, hy - 1, 1.8, 3, M.Tooth, 20, 2));
  // Mâchoire inférieure relevée et ses grands crocs.
  tag("machoire", c(hx - 6, hy + 14, hx + 26, hy - 2, 5, 3, B, 12, 4),
    e(hx + 25, hy - 7, 2, 4, MR.MToothUp, 20, 2), e(hx + 17, hy - 3, 1.8, 3.4, MR.MToothUp, 20, 2), e(hx + 9, hy + 1, 1.6, 3, MR.MToothUp, 20, 2));
  // Colonne : une longue file de vertèbres, avec leurs épines.
  for (let x = 86; x >= -100; x -= 9) {
    const y = CY + Math.max(0, -x - 40) * 0.04;
    const k = Math.max(0.3, 1 - Math.max(0, -x) / 130);
    tag("vertebres", e(x, y, 3.5, 3, B, 10, 3), c(x, y - 3, x - 5, y - 6 - 16 * k, 1, 1, B, 12, 1, true));
  }
  // Côtes : longues et fines, qui enserrent l'estomac.
  for (let x = 80; x >= -20; x -= 10) {
    const d = 1 - Math.abs(x - 30) / 80;
    tag("cotes", c(x, CY + 3, x - 8, CY + 14 + 10 * d, 1, 1, B, 8, 1, true));
  }
  // Nageoires : pectorale en sabre, pelviennes, dorsale et anale, faites de rayons.
  tag("nageoires", c(82, CY + 16, 36, CY + 34, 2, 1, B, 14, 2), c(80, CY + 19, 46, CY + 36, 1, 1, B, 14, 1, true));
  for (let i = 0; i < 4; i++) {
    tag("nageoires", c(-20 - i * 4, CY - 18, -34 - i * 5, CY - 40 + i * 3, 1, 1, B, 14, 1, true));
    tag("nageoires", c(-22 - i * 4, CY + 20, -34 - i * 5, CY + 36 - i * 3, 1, 1, B, 14, 1, true));
  }
  // Queue : fourche de rayons portée par l'éventail des dernières vertèbres.
  tag("queue", e(-104, CY + 2.6, 5, 5, B, 12, 3),
    ...[-34, -22, -10, 10, 22, 34].map((d) => c(-106, CY + 2.6 + d * 0.1, -134, CY + 2.6 + d, 1, 1, B, 14, 1, true)));
  // Le célèbre « poisson dans le poisson » : un Gillicus avalé tête la première, resté dans l'estomac.
  tag("gillicus", e(56, CY + 14, 5, 4, B, 16, 3),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => e(48 - k * 7, CY + 14 + k * 0.4, 2.2, 1.8, B, 16, 2)),
    c(-6, CY + 17, -14, CY + 10, 1, 1, B, 16, 1, true), c(-6, CY + 17, -14, CY + 24, 1, 1, B, 16, 1, true));
  return P.map((p) => scalePrim(p, XIPHACTINUS_SCALE));
}

export const XIPHACTINUS: Species = {
  id: "xiphactinus",
  name: "Xiphactinus",
  latin: "Xiphactinus audax",
  period: "Crétacé supérieur, 90-70 Ma",
  place: "Craie de Niobrara, Kansas (Voie maritime intérieure, États-Unis)",
  lengthM: LENGTH_M,
  massKg: 450,
  facts: [
    { id: "geant", title: "Un poisson géant", unlock: "discover",
      text: "Xiphactinus était un poisson osseux de 5 mètres, aussi long qu'un grand requin blanc d'aujourd'hui ! Ce n'est ni un dinosaure ni un reptile : c'est un vrai poisson, avec des écailles et des branchies." },
    { id: "poisson-dans-poisson", title: "Le poisson dans le poisson", unlock: "assemble",
      text: "Le fossile le plus célèbre, trouvé au Kansas, est un Xiphactinus de 4 mètres avec un poisson de presque 2 mètres, un Gillicus, entier dans son estomac. Il est sans doute mort d'avoir avalé une proie trop grosse !" },
    { id: "gueule", title: "Une tête de bouledogue", unlock: "eat",
      text: "Sa mâchoire inférieure remontait presque à la verticale, garnie de crocs pointus. Il avalait ses proies entières, la tête la première, comme le font encore les tarpons." },
    { id: "chasseur", title: "Un chasseur fulgurant", unlock: "attack",
      text: "Avec son corps fuselé et sa queue fourchue, Xiphactinus était taillé pour la vitesse. Il fonçait sur les bancs de poissons et attrapait des proies presque aussi longues que lui." },
    { id: "saut", title: "Des sauts hors de l'eau", unlock: "call",
      text: "Comme les tarpons, ses cousins actuels, il bondissait peut-être hors de l'eau. Son nom veut dire « rayon-épée » : le premier rayon de ses nageoires pectorales était épais comme une lame." },
    { id: "fraie", title: "Des millions d'œufs", unlock: "nest",
      text: "Les poissons comme Xiphactinus ne faisaient pas de nid : les femelles lâchaient sans doute des quantités d'œufs minuscules dans l'eau, qui dérivaient au gré des courants." },
    { id: "alevins", title: "Petit poisson deviendra grand", unlock: "baby",
      text: "Les bébés, appelés alevins, étaient minuscules et servaient de repas à beaucoup d'animaux. Ceux qui survivaient grandissaient vite pour devenir à leur tour les rois de la mer intérieure." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne" },
    { id: "cotes", name: "Côtes" },
    { id: "nageoires", name: "Nageoires" },
    { id: "queue", name: "Queue fourchue" },
    { id: "gillicus", name: "Gillicus (dernier repas)" },
  ],
  model: xiphactinusModel,
  skeleton: xiphactinusSkeleton,
  center: { x: 0, y: CY * XIPHACTINUS_SCALE },
  eye: { x: EYE.x * XIPHACTINUS_SCALE, y: EYE.y * XIPHACTINUS_SCALE },
  feet: [70, -42].map((x) => x * XIPHACTINUS_SCALE),
  halfLen: 125 * XIPHACTINUS_SCALE,
  shadow: 0.3,
  walkSpeed: 45,
  runSpeed: 160,
  stride: 5,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: [], defense: "flee", sight: 420, scavenger: false },
  habitat: "sea",
  birth: "live",
};
