import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { NM } from "./nanuq.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Nanuqsaurus (Nanuqsaurus hoglundi), tyrannosaure polaire de l'Alaska, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Deux fois plus court que le
 * T. rex et bien plus léger : crâne plus fin, pattes longues de coureur, queue mince, et une courte
 * toison de duvet ébouriffé sur le cou et le dos (hypothèse plausible pour un animal du Grand Nord).
 * Le modèle brut mesure ~330 px de la queue au museau.
 */
const LENGTH_M = 6;
export const NANUQ_SCALE = (LENGTH_M * PX_PER_M) / 330;

function nanuqRig({ action, actionT: t, time }: Pose): TheroRig {
  const r = { ...REST_RIG };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      // Coureur : corps plus horizontal, grandes foulées.
      Object.assign(r, { pitch: 0.1, neck: 0.2, head: -0.1, stride: 1.4, tailUp: 5 });
      break;
    case "eat": {
      // Arrache la viande : la tête tire en arrière et secoue.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.5 - tug * 0.08, neck: 0.5 - tug * 0.25, head: 0.2 + Math.sin(t * Math.PI * 6) * 0.05, jaw: 0.2 + tug * 0.5, dy: 22, stance: 12 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.42, neck: 0.48 + s * 0.04, head: 0.12, jaw: 0.08, dy: 18, stance: 8 });
      break;
    case "rest": {
      // Couché, le cou replié contre le corps (garde la chaleur), respiration lente.
      const br = Math.sin(time * 1.7) * 0.03;
      Object.assign(r, { dy: 62, pitch: 0.04, neck: 0.36 + br, head: 0.1, curl: 0.3, legs: "sit", closed: true });
      break;
    }
    case "attack": {
      // 0-0.35 armé (tête en arrière, gueule ouverte), 0.35-0.6 fente rapide en avant, 0.6-1 claque et secoue.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.5));
      const lunge = win(t, 0.35, 0.55);
      const shake = win(t, 0.6, 0.7) * Math.sin(t * 50) * 0.07;
      Object.assign(r, {
        dx: lunge * 28, dy: lunge * 8,
        pitch: -0.1 * wind + 0.24 * lunge,
        neck: -0.3 * wind + 0.36 * lunge + shake,
        head: -0.1 * wind + 0.1 * lunge,
        jaw: Math.max(wind, lunge) * (1 - win(t, 0.55, 0.62) * 0.85),
        tailUp: 10 * lunge, stance: 22 * lunge,
      });
      break;
    }
    case "defend":
      // Tête basse, gueule ouverte, queue levée, pieds campés.
      Object.assign(r, { pitch: 0.12, neck: 0.16, head: -0.04, jaw: 0.7 + 0.3 * s, tailUp: 14, stance: 18, dy: 8 });
      break;
    case "call":
      // Cri dans le froid : tête levée, gueule grande ouverte.
      Object.assign(r, { pitch: -0.14, neck: -0.55 - 0.05 * s, head: -0.35, jaw: 0.75 + 0.25 * Math.abs(s), tailUp: 6 });
      break;
    case "dead":
      Object.assign(r, { dy: 70, pitch: 0.03, neck: 0.46, head: 0.2, jaw: 0.25, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

const HIP = { x: 0, y: -100 };
const NECK = { x: 52, y: -112 };
const NAPE = { x: 80, y: -134 };
export const NANUQ_EYE = { x: 110, y: -142 };

/**
 * Mèche de duvet : court trait couché vers l'arrière (glyphe choisi selon la direction).
 * `a` = rotation que subira la mèche (tangage + cou) : on la compense pour garder le même glyphe à l'écran.
 */
function tuft(x: number, y: number, dx: number, dy: number, z: number, a = 0): Prim {
  const co = Math.cos(a), si = Math.sin(a);
  return c(x, y, x + dx * co + dy * si, y - dx * si + dy * co, 1, 1, NM.Fuzz, z, 1, true);
}

export function nanuqModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = nanuqRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 2) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 4 * moving * r.stride + breath * 1.5;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Longues pattes de coureur (cinématique inverse), métatarse allongé ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 16 * r.stride;
    const m = L.far ? NM.Far : NM.Coat;
    const z = L.far ? -60 : 38;
    const hx = HIP.x + (L.far ? 6 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 10 + sw * 44 + (L.far ? -r.stance : r.stance), fy = -5 - lift;
    let mx = 14, my = 30 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 30 + (L.far ? 8 : 0); fy = -5; mx = 30; my = 5; }
    else if (r.legs === "lie") { fx = hx + 78 + (L.far ? -12 : 0); fy = -6 - (L.far ? 0 : 5); mx = 26; my = 4; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 6, ax, ay, 40, 40);
    // Cuisse musclée mais plus fine que celle du T. rex, jambe, métatarse, trois orteils griffus.
    P.push(e(hx + 2, hy + 2, 20, 30, m, z - 6, 18));
    P.push(c(hx, hy + 8, kx, ky, 17, 10, m, z, 14));
    P.push(c(kx, ky, ax, ay, 10, 7, m, z + 4, 8));
    P.push(c(ax, ay, fx, fy, 7, 5.5, m, z + 6, 6));
    P.push(e(fx + 5, fy + 1, 11, 4.5, m, z + 6, 5));
    for (const [tx, ty] of [[18, 2], [13, 3], [7, 4]] as const) {
      P.push(c(fx + tx - 4, fy + ty - 1, fx + tx + 4, fy + ty + 1, 1, 1, NM.Claw, z + 12, 2, true));
    }
    // Mèche de duvet sur la cuisse.
    if (!L.far) P.push(tuft(lerp(hx, kx, 0.5) - 12, lerp(hy + 8, ky, 0.5), -5, 6, z + 24));
  }

  // --- Corps, queue, cou, tête, bras : au repos, puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Queue mince, en balancier (compense le tangage, reste au-dessus du sol).
  const sway = Math.sin(time * 1.2) * 3 * (1 - moving) + Math.sin(walk) * 7 * moving;
  const tail: [number, number][] = [[-32, -106]];
  let ang = Math.PI + 0.12 + r.tailUp * 0.008 - r.pitch * 0.85;
  for (let k = 1; k <= 8; k++) {
    ang -= r.curl * 0.3 + sway * 0.003 * k - r.tailUp * 0.0015;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 18, Math.min(py + Math.sin(ang) * 18, -Math.max(3, 24 - k * 3) - by - 2)]);
  }
  for (let k = 0; k < 8; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(5.5, 24 - k * 3), rb = Math.max(5.5, 24 - (k + 1) * 3);
    B.push(c(ax, ay, qx, qy, ra, rb, NM.Coat, 2, ra * 0.8));
    // Anneaux sombres sur le dessus, duvet ébouriffé sur la base de la queue.
    if (k < 7 && k % 2 === 0) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.5, Math.max(2.5, ra * 0.35), ra * 0.45, NM.Back, 2 + ra * 0.7, 4));
    if (k < 3 && k % 2 === 0) B.push(tuft(ax, ay - ra - 1, -6, -5, 40, r.pitch));
  }

  // Corps : plus court et léger que celui du T. rex, dos sombre, ventre pâle.
  B.push(e(14, -104, 54, 30, NM.Coat, 0, 30));
  B.push(e(26, -90, 44, 12, NM.Belly, 8, 14, -92));
  B.push(e(4, -128, 48, 9, NM.Back, 14, 9, undefined, -128));
  // Robe tachetée : marques sombres en travers du dos, taches claires sur le flanc.
  for (let k = 0; k < 5; k++) B.push(e(-30 + k * 18, -124 + Math.abs(k - 2) * 2, 4, 9, NM.Back, 24, 4));
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 4 - j; i++) {
      const x = -24 + i * 22 + j * 12, y = -112 + j * 12;
      const ex2 = (x - 14) / 54, ey2 = (y + 104) / 30;
      B.push(e(x, y, 4, 3, NM.Mottle, 30 * Math.sqrt(Math.max(0, 1 - ex2 * ex2 - ey2 * ey2)) + 1, 3));
    }
  }
  // Bord du dos en duvet ébouriffé.
  for (let x = -24; x <= 52; x += 15) {
    const t2 = (x - 14) / 54;
    B.push(tuft(x, -104 - 30 * Math.sqrt(Math.max(0, 1 - t2 * t2)) + 2, -6, -6, 40, r.pitch));
  }

  // Petits bras à deux doigts.
  for (const far of [true, false]) {
    const m = far ? NM.Far : NM.Coat;
    const z = far ? -26 : 42;
    const sx = 54 + (far ? -5 : 0), sy = -96;
    const swing = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const ex = sx + 6, ey = sy + 11;
    const wx = ex + 10, wy = ey - 3 + swing;
    B.push(c(sx, sy, ex, ey, 5, 3.5, m, z, 5));
    B.push(c(ex, ey, wx, wy, 3, 2.5, m, z, 3));
    B.push(c(wx, wy, wx + 4, wy + 4, 1, 1, NM.Claw, z + 6, 1, true));
    B.push(c(wx, wy - 2, wx + 5, wy + 1, 1, 1, NM.Claw, z + 6, 1, true));
  }

  // Cou et tête.
  const hb = Math.sin(walk * 2) * 2 * moving;
  const H: Prim[] = [];
  const hx = 104, hy = -136 + hb;
  // Crâne plus bas et étroit que celui du T. rex, museau long et fin, rugosités sur le dessus.
  H.push(e(hx - 2, hy, 22, 15, NM.Coat, 8, 16));
  H.push(e(hx + 22, hy + 4, 26, 9, NM.Coat, 8, 12));
  H.push(e(hx - 10, hy + 7, 11, 10, NM.Coat, 14, 12));
  H.push(c(hx - 14, hy - 13, hx + 44, hy - 5, 2.5, 2, NM.Back, 20, 3));
  H.push(e(hx + 4, hy - 14, 6, 3.5, NM.Brow, 24, 4));
  H.push(e(hx + 22, hy - 5, 3.5, 2.2, NM.Brow, 22, 3));
  H.push(e(hx + 34, hy - 3, 3.5, 2.2, NM.Brow, 22, 3));
  if (r.closed) H.push(c(NANUQ_EYE.x - 3, NANUQ_EYE.y + hb, NANUQ_EYE.x + 3, NANUQ_EYE.y + hb, 1, 1, CM.Lid, 40, 1, true));
  else H.push(e(NANUQ_EYE.x, NANUQ_EYE.y + hb, 3.2, 2.8, M.Eye, 40, 1));
  H.push(e(hx + 46, hy, 2.2, 1.6, M.Socket, 26, 1));
  // Gueule ouverte : intérieur sombre, langue, mâchoire inférieure abaissée.
  if (r.jaw > 0.1) H.push(e(hx + 14, hy + 14, 34, 11, NM.Mouth, 20, 4, hy + 11));
  for (let x = hx + 4; x <= hx + 44; x += 6) H.push(e(x, hy + 12, 2, 2.6, NM.Tooth, 30, 2));
  const J: Prim[] = [c(hx - 14, hy + 11, hx + 44, hy + 15, 8, 4.5, NM.Coat, 10, 7)];
  J.push(c(hx - 10, hy + 17, hx + 38, hy + 18, 3, 2, NM.Belly, 18, 3));
  if (r.jaw > 0.1) {
    J.push(e(hx + 10, hy + 8, 20, 3.5, CM.RexTongue, 24, 3));
    for (let x = hx + 6; x <= hx + 40; x += 7) J.push(e(x, hy + 7, 1.8, 2.2, CM.ToothUp, 26, 2));
  } else J.push(c(hx - 6, hy + 10, hx + 48, hy + 13, 1, 1, M.Mouth, 18, 1, true));
  H.push(...rot(J, hx - 12, hy + 9, r.jaw * 0.45));
  // Cou : collerette de duvet sur la nuque et sous la gorge.
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 20, 13, NM.Coat, 6, 18),
    e(NECK.x + 14, NECK.y - 16, 3.5, 7, NM.Back, 26, 4),
  ];
  for (let k = 0; k <= 2; k++) {
    const t2 = k / 2, rr = 20 - 7 * t2;
    const px = lerp(NECK.x, NAPE.x, t2), py = lerp(NECK.y, NAPE.y + hb, t2);
    N.push(tuft(px - 0.62 * rr, py - 0.79 * rr + 1, -6, -6, 40, r.pitch + r.neck));
    if (k > 0) N.push(tuft(px + 0.62 * rr - 2, py + 0.79 * rr - 2, -4, 7, 40, r.pitch + r.neck));
  }
  N.push(...rot(H, NAPE.x, NAPE.y, r.head));
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, NANUQ_SCALE));
}

/** Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite. */
export function nanuqSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : bas et allongé, grandes fenêtres (orbite, antorbitaire, temporale), arcade sur l'œil.
  tag("crane",
    e(104, -137, 22, 13, B, 14, 10), e(128, -132, 24, 8, B, 14, 8),
    c(92, -150, 150, -139, 2.5, 2, B, 16, 3), e(108, -150, 5, 3, B, 20, 4),
    e(112, -142, 4, 4, M.Socket, 30, 1), e(128, -134, 8, 3.5, M.Socket, 30, 1), e(96, -138, 4, 5, M.Socket, 30, 1),
    ...[114, 120, 126, 132, 138, 144].map((x) => e(x, -122, 2, 2.8, M.Tooth, 20, 2)));
  // Mâchoire inférieure (dentaire), plus fine que celle du T. rex.
  tag("machoire", c(90, -120, 150, -116, 7, 4, B, 12, 5), e(98, -118, 5, 3, M.Socket, 30, 1),
    ...[118, 125, 132, 139, 146].map((x) => e(x, -125, 1.8, 2.2, CM.ToothUp, 20, 2)));
  // Colonne : cou en S puis dos jusqu'au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    spine.push(t < 0.3 ? [88 - t * 120, -136 + t * 73] : [52 - (t - 0.3) * 123, -114 + (t - 0.3) * 11]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 4.5, 3.5, B, 10, 4), c(x, y - 3, x - 2, y - 11, 1, 1, B, 12, 1, true));
  // Côtes et gastralia.
  for (let k = 5; k <= 13; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 3, x + 5, y + 22, 1, 1, B, 8, 2, true), c(x + 5, y + 22, x + 2, -78, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion, pubis terminé par une « botte », ischion.
  tag("bassin", e(-2, -110, 28, 10, B, 12, 8), c(5, -102, 18, -66, 3.5, 2.5, B, 12, 4), e(20, -64, 8, 3.5, B, 12, 4), c(-7, -102, -22, -76, 3.5, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, deux doigts.
  tag("bras", c(56, -110, 40, -118, 2.5, 2, B, 14, 3), c(54, -98, 60, -87, 2.5, 2, B, 16, 3), c(60, -87, 70, -89, 2, 1.5, B, 16, 2),
    c(70, -89, 74, -85, 1, 1, B, 18, 1, true), c(70, -91, 75, -88, 1, 1, B, 18, 1, true));
  // Pattes : fémur, tibia plus long (coureur), métatarse allongé, orteils.
  for (const [hx, z] of [[6, 4], [0, 18]] as const) {
    tag("pattes", c(hx, -100, hx + 22, -66, 5, 4, B, z, 5), c(hx + 22, -66, hx + 2, -34, 4, 3, B, z, 4),
      c(hx + 2, -34, hx + 14, -5, 3, 2.5, B, z, 3), c(hx + 12, -4, hx + 32, -3, 2, 1.2, B, z, 2));
  }
  // Queue : vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    tag("queue", e(-36 - t * 140, -106 + t * 6, 4.5 - t * 2.5, 3.5 - t * 1.5, B, 10, 3), c(-36 - t * 140, -109 + t * 6, -38 - t * 140, -116 + t * 9, 1, 1, B, 12, 1, true));
  }
  return P.map((p) => scalePrim(p, NANUQ_SCALE));
}

export const NANUQ: Species = {
  id: "nanuq",
  name: "Nanuqsaurus",
  latin: "Nanuqsaurus hoglundi",
  period: "Crétacé supérieur, 70 Ma",
  place: "Formation de Prince Creek, Alaska (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 800,
  facts: [
    { id: "ours", title: "Le lézard ours polaire", unlock: "discover",
      text: "« Nanuq » veut dire « ours polaire » en iñupiaq, la langue des Inuits du nord de l'Alaska. Nanuqsaurus est donc le « lézard ours polaire » : un tyrannosaure du Grand Nord !" },
    { id: "crane", title: "Quelques morceaux de crâne", unlock: "assemble",
      text: "Il a été décrit en 2014 à partir de quelques fragments de crâne et de mâchoire trouvés au bord de la rivière Colville, en Alaska. Les savants ont reconstitué le reste en le comparant à ses cousins." },
    { id: "nuit", title: "Des mois dans le noir", unlock: "rest",
      text: "Il vivait tout près du pôle Nord. En hiver, le soleil ne se levait pas pendant des semaines et il pouvait neiger. Pourtant le climat était plus doux qu'aujourd'hui : il y avait des forêts de conifères." },
    { id: "taille", title: "Un tyran de poche", unlock: "hunt",
      text: "Avec ses 6 mètres environ, il faisait la moitié de la longueur d'un T. rex. Une hypothèse : dans le Grand Nord, la nourriture manquait une partie de l'année, et un corps plus petit avait besoin de moins manger. D'autres savants pensent que les os trouvés viennent d'un jeune." },
    { id: "voisins", title: "Des voisins à cornes et à bec", unlock: "eat",
      text: "Il partageait la toundra avec le Pachyrhinosaure, un cératopsien au nez bosselé, et l'Edmontosaure, un dinosaure à bec de canard. Ces herbivores étaient sans doute ses proies." },
    { id: "duvet", title: "Un manteau de duvet ?", unlock: "call",
      text: "Certains cousins des tyrannosaures avaient des plumes duveteuses. Pour un chasseur du froid, une petite toison isolante est une idée plausible, mais aucune empreinte de peau de Nanuqsaurus ne l'a encore prouvé." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras à deux doigts" },
    { id: "pattes", name: "Longues pattes" },
    { id: "queue", name: "Queue" },
  ],
  model: nanuqModel,
  skeleton: nanuqSkeleton,
  center: { x: 12 * NANUQ_SCALE, y: -104 * NANUQ_SCALE },
  eye: { x: NANUQ_EYE.x * NANUQ_SCALE, y: NANUQ_EYE.y * NANUQ_SCALE },
  feet: [10, 16].map((x) => x * NANUQ_SCALE),
  halfLen: 160 * NANUQ_SCALE,
  shadow: 0.6,
  walkSpeed: 44,
  runSpeed: 130,
  stride: 6.5,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: ["pachyrhino", "edmonto"], defense: "bite", sight: 500, scavenger: true },
  biomes: [BIOME.Tundra],
};
