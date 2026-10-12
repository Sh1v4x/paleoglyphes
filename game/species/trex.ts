import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { CM } from "./carnivores.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Tyrannosaure modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le bassin).
 * Énorme tête aux mâchoires profondes, bras minuscules à deux doigts, pattes massives, queue-balancier.
 * Le modèle brut mesure ~372 px de la queue au museau.
 */
const LENGTH_M = 12;
export const TREX_SCALE = (LENGTH_M * PX_PER_M) / 372;

function trexRig({ action, actionT: t, time }: Pose): TheroRig {
  const r = { ...REST_RIG };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.08, neck: 0.18, head: -0.08, stride: 1.25, tailUp: 4 });
      break;
    case "eat": {
      // Arrache la viande : la tête tire en arrière et secoue.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.54 - tug * 0.08, neck: 0.28 - tug * 0.2, head: 0.16 + Math.sin(t * Math.PI * 6) * 0.05, jaw: 0.2 + tug * 0.5, dy: 30, stance: 14 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.42, neck: 0.22 + s * 0.04, head: 0.06, jaw: 0.08, dy: 22, stance: 10 });
      break;
    case "rest": {
      const br = Math.sin(time * 1.6) * 0.03;
      Object.assign(r, { dy: 68, pitch: 0.04, neck: 0.32 + br, head: 0.08, curl: 0.25, legs: "sit", closed: true });
      break;
    }
    case "attack": {
      // 0-0.35 armé (tête en arrière, gueule qui s'ouvre), 0.35-0.6 fente en avant, 0.6-1 claque et secoue.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.5));
      const lunge = win(t, 0.35, 0.55);
      const shake = win(t, 0.6, 0.7) * Math.sin(t * 50) * 0.06;
      Object.assign(r, {
        dx: lunge * 26, dy: lunge * 8,
        pitch: -0.1 * wind + 0.22 * lunge,
        neck: -0.25 * wind + 0.32 * lunge + shake,
        head: -0.1 * wind + 0.1 * lunge,
        jaw: Math.max(wind, lunge) * (1 - win(t, 0.55, 0.62) * 0.85),
        tailUp: 10 * lunge, stance: 22 * lunge,
      });
      break;
    }
    case "defend":
      Object.assign(r, { pitch: 0.1, neck: 0.12, head: -0.04, jaw: 0.7 + 0.3 * s, tailUp: 14, stance: 18, dy: 8 });
      break;
    case "call":
      // Grondement, tête levée, gueule grande ouverte.
      Object.assign(r, { pitch: -0.14, neck: -0.5 - 0.05 * s, head: -0.35, jaw: 0.75 + 0.25 * Math.abs(s), tailUp: 6 });
      break;
    case "dead":
      Object.assign(r, { dy: 76, pitch: 0.03, neck: 0.42, head: 0.18, jaw: 0.25, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

const HIP = { x: 0, y: -112 };
const NECK = { x: 66, y: -126 };
const NAPE = { x: 98, y: -150 };
export const TREX_EYE = { x: 130, y: -162 };

export function trexModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = trexRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 2.2) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 4 * moving * r.stride + breath * 1.5;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Pattes massives (cinématique inverse) ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 16 * r.stride;
    const m = L.far ? CM.RexFar : CM.RexSkin;
    const z = L.far ? -70 : 44;
    const hx = HIP.x + (L.far ? 8 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 12 + sw * 40 + (L.far ? -r.stance : r.stance), fy = -6 - lift;
    let mx = 16, my = 28 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 34 + (L.far ? 10 : 0); fy = -6; mx = 36; my = 6; }
    else if (r.legs === "lie") { fx = hx + 92 + (L.far ? -14 : 0); fy = -8 - (L.far ? 0 : 6); mx = 30; my = 4; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 8, ax, ay, 52, 48);
    // Cuisse énorme, jambe, métatarse, trois orteils griffus.
    P.push(e(hx + 2, hy + 4, 28, 40, m, z - 6, 22));
    P.push(c(hx, hy + 10, kx, ky, 24, 14, m, z, 18));
    P.push(c(kx, ky, ax, ay, 13, 9, m, z + 4, 10));
    P.push(c(ax, ay, fx, fy, 9, 7, m, z + 6, 8));
    P.push(e(fx + 6, fy + 1, 14, 6, m, z + 6, 6));
    for (const [tx, ty] of [[22, 2], [16, 4], [9, 5]] as const) {
      P.push(c(fx + tx - 4, fy + ty - 1, fx + tx + 4, fy + ty + 1, 1, 1, CM.RexClaw, z + 14, 2, true));
    }
    if (!L.far) for (let k = 0; k < 3; k++) P.push(e(lerp(hx, kx, 0.3 + k * 0.2) - 6, lerp(hy + 10, ky, 0.3 + k * 0.2), 4, 3, CM.RexScale, z + 20, 4));
  }

  // --- Corps, queue, cou, tête, bras : au repos, puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Queue épaisse à la base, en balancier (compense le tangage, reste au-dessus du sol).
  const sway = Math.sin(time * 1.1) * 3 * (1 - moving) + Math.sin(walk) * 7 * moving;
  const tail: [number, number][] = [[-40, -120]];
  let ang = Math.PI + 0.1 + r.tailUp * 0.008 - r.pitch * 0.85;
  for (let k = 1; k <= 8; k++) {
    ang -= r.curl * 0.3 + sway * 0.003 * k - r.tailUp * 0.0015;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 22, Math.min(py + Math.sin(ang) * 22, -Math.max(3, 34 - k * 4) - by - 2)]);
  }
  for (let k = 0; k < 8; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(3, 34 - k * 4), rb = Math.max(3, 34 - (k + 1) * 4);
    B.push(c(ax, ay, qx, qy, ra, rb, CM.RexSkin, 2, ra * 0.8));
    // Bandes sombres sur le dessus, écailles sur le flanc.
    if (k < 7) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.6, Math.max(2.5, ra * 0.25), ra * 0.4, CM.RexBack, 2 + ra * 0.7, 4));
    if (k < 5 && k % 2) B.push(e((ax + qx) / 2 + 4, (ay + qy) / 2 + ra * 0.15, 3, 2.2, CM.RexScale, 2 + ra * 0.8, 3));
  }

  // Corps : poitrail profond, dos plus sombre, ventre pâle.
  B.push(e(18, -116, 70, 44, CM.RexSkin, 0, 42));
  B.push(e(34, -98, 58, 16, CM.RexBelly, 10, 20, -100));
  B.push(e(4, -150, 60, 12, CM.RexBack, 18, 12, undefined, -150));
  for (let k = 0; k < 7; k++) {
    const x = -46 + k * 16;
    B.push(e(x, -148 + Math.abs(x - 16) * 0.06, 4.5, 12, CM.RexBack, 30, 5));
  }
  // Écailles en bosses éparses (peau surtout écailleuse, d'après les empreintes fossiles).
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 6 - j; i++) {
      const x = -36 + i * 22 + (j % 2) * 11 + j * 8, y = -132 + j * 14;
      const ex2 = (x - 18) / 70, ey2 = (y + 116) / 44;
      const surf = 42 * Math.sqrt(Math.max(0, 1 - ex2 * ex2 - ey2 * ey2));
      B.push(e(x, y, 3.5, 2.5, CM.RexScale, surf + 1, 3));
    }
  }

  // Bras minuscules à deux doigts (mais musclés).
  for (const far of [true, false]) {
    const m = far ? CM.RexFar : CM.RexSkin;
    const z = far ? -30 : 48;
    const sx = 66 + (far ? -6 : 0), sy = -108;
    const swing = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const ex = sx + 7, ey = sy + 13;
    const wx = ex + 12, wy = ey - 3 + swing;
    B.push(c(sx, sy, ex, ey, 6, 4.5, m, z, 6));
    B.push(c(ex, ey, wx, wy, 4, 3, m, z, 4));
    B.push(c(wx, wy, wx + 5, wy + 4, 1, 1, CM.RexClaw, z + 6, 1, true));
    B.push(c(wx, wy - 2, wx + 6, wy + 1, 1, 1, CM.RexClaw, z + 6, 1, true));
  }

  // Cou et tête.
  const hb = Math.sin(walk * 2) * 2 * moving;
  const H: Prim[] = [];
  const hx = 124, hy = -151 + hb;
  // Crâne haut et large à l'arrière (vision binoculaire), museau long et profond.
  H.push(e(hx - 4, hy, 30, 21, CM.RexSkin, 8, 20));
  H.push(e(hx + 28, hy + 5, 30, 13, CM.RexSkin, 8, 15));
  H.push(e(hx - 12, hy + 9, 14, 12, CM.RexSkin, 14, 14));
  H.push(c(hx - 18, hy - 17, hx + 44, hy - 6, 3.5, 2.5, CM.RexBack, 22, 4));
  H.push(e(hx + 2, hy - 18, 7, 4, CM.RexBrow, 26, 5));
  H.push(e(hx - 16, hy - 14, 6, 4, CM.RexBrow, 24, 4));
  H.push(e(hx + 14, hy - 2, 4, 2.5, CM.RexScale, 24, 3));
  H.push(e(hx + 30, hy + 1, 4, 2.5, CM.RexScale, 22, 3));
  if (r.closed) H.push(c(TREX_EYE.x - 3, TREX_EYE.y + hb, TREX_EYE.x + 3, TREX_EYE.y + hb, 1, 1, CM.Lid, 40, 1, true));
  else H.push(e(TREX_EYE.x, TREX_EYE.y + hb, 3.5, 3, M.Eye, 40, 1));
  H.push(e(hx + 52, hy - 1, 2.5, 1.8, M.Socket, 26, 1));
  // Gueule ouverte : intérieur sombre, langue, mâchoire inférieure abaissée.
  if (r.jaw > 0.1) H.push(e(hx + 14, hy + 18, 40, 14, CM.RexMouth, 20, 4, hy + 14));
  for (let x = hx + 4; x <= hx + 52; x += 6) H.push(e(x, hy + 16, 2.4, 3.2, CM.RexTooth, 30, 2));
  const J: Prim[] = [c(hx - 18, hy + 14, hx + 50, hy + 19, 11, 6, CM.RexSkin, 10, 9)];
  J.push(c(hx - 14, hy + 22, hx + 44, hy + 23, 4, 2.5, CM.RexBelly, 18, 3));
  if (r.jaw > 0.1) {
    J.push(e(hx + 12, hy + 11, 24, 4, CM.RexTongue, 24, 3));
    for (let x = hx + 6; x <= hx + 46; x += 7) J.push(e(x, hy + 9, 2.2, 2.6, CM.ToothUp, 26, 2));
  } else J.push(c(hx - 8, hy + 13, hx + 54, hy + 16, 1, 1, M.Mouth, 18, 1, true));
  H.push(...rot(J, hx - 14, hy + 12, r.jaw * 0.45));
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 26, 17, CM.RexSkin, 6, 22),
    e(NECK.x + 18, NECK.y - 20, 4, 8, CM.RexBack, 30, 4),
    e(NECK.x + 4, NECK.y - 26, 4, 8, CM.RexBack, 30, 4),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, TREX_SCALE));
}

/** Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite. */
export function trexSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : grandes fenêtres (orbite, fenêtre antorbitaire, temporale), crête au-dessus de l'œil.
  tag("crane",
    e(122, -144, 26, 18, B, 14, 12), e(154, -138, 28, 11, B, 14, 10),
    c(110, -160, 172, -144, 3, 2, B, 16, 3), e(130, -160, 6, 3.5, B, 20, 4),
    e(134, -151, 4.5, 4.5, M.Socket, 30, 1), e(152, -142, 9, 4.5, M.Socket, 30, 1), e(114, -146, 5, 6, M.Socket, 30, 1),
    ...[134, 140, 146, 152, 158, 164, 170].map((x) => e(x, -125, 2.2, 3.2, M.Tooth, 20, 2)));
  // Mâchoire inférieure (dentaire) : épaisse, en forme de « D » allongé.
  tag("machoire", c(108, -126, 174, -121, 9, 5, B, 12, 6), e(118, -122, 6, 4, M.Socket, 30, 1),
    ...[140, 147, 154, 161, 168].map((x) => e(x, -131, 2, 2.4, CM.ToothUp, 20, 2)));
  // Colonne : cou en S puis dos jusqu'au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    spine.push(t < 0.3 ? [104 - t * 110, -144 + t * 50] : [71 - (t - 0.3) * 110, -129 + (t - 0.3) * 20]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 5, 4, B, 10, 4), c(x, y - 3, x - 2, y - 12, 1, 1, B, 12, 1, true));
  // Côtes et gastralia.
  for (let k = 5; k <= 13; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 3, x + 6, y + 26, 1, 1, B, 8, 2, true), c(x + 6, y + 26, x + 2, -82, 1, 1, B, 8, 2, true));
  }
  // Bassin : grand ilion, pubis terminé par une « botte » qui touche le sol au repos.
  tag("bassin", e(-2, -126, 34, 12, B, 12, 8), c(6, -116, 22, -74, 4, 3, B, 12, 4), e(24, -72, 10, 4, B, 12, 4), c(-8, -116, -26, -86, 4, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, deux doigts.
  tag("bras", c(70, -122, 50, -132, 3, 2, B, 14, 3), c(66, -110, 73, -97, 3, 2.5, B, 16, 3), c(73, -97, 84, -100, 2.5, 2, B, 16, 2),
    c(84, -100, 89, -96, 1, 1, B, 18, 1, true), c(84, -102, 90, -99, 1, 1, B, 18, 1, true));
  // Pattes : fémur, tibia, métatarse, orteils.
  for (const [hx, z] of [[8, 4], [0, 18]] as const) {
    tag("pattes", c(hx, -112, hx + 26, -70, 6, 5, B, z, 5), c(hx + 26, -70, hx - 2, -34, 5, 4, B, z, 4),
      c(hx - 2, -34, hx + 14, -6, 4, 3, B, z, 3), c(hx + 12, -5, hx + 36, -4, 2.5, 1.5, B, z, 2));
  }
  // Queue : vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    tag("queue", e(-42 - t * 172, -122 + t * 4, 5 - t * 3, 4 - t * 2, B, 10, 3), c(-42 - t * 172, -125 + t * 4, -44 - t * 172, -133 + t * 8, 1, 1, B, 12, 1, true));
  }
  return P.map((p) => scalePrim(p, TREX_SCALE));
}

export const TREX: Species = {
  id: "trex",
  name: "Tyrannosaure",
  latin: "Tyrannosaurus rex",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Hell Creek, Montana et Dakota du Sud (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 8500,
  facts: [
    { id: "roi", title: "Le roi des lézards tyrans", unlock: "discover",
      text: "« Tyrannosaurus rex » veut dire « roi des lézards tyrans ». Long de 12 mètres et lourd comme un camion de 8 à 9 tonnes, c'est l'un des derniers grands dinosaures." },
    { id: "sue", title: "Sue, la célèbre", unlock: "assemble",
      text: "Sue, découverte en 1990 au Dakota du Sud, est le squelette de T. rex le plus complet. À l'adolescence, un T. rex pouvait grossir de plus de 2 kg par jour !" },
    { id: "morsure", title: "La morsure record", unlock: "attack",
      text: "Sa morsure est la plus puissante de tous les animaux terrestres connus : plusieurs tonnes de force, assez pour broyer les os. On retrouve des éclats d'os dans ses excréments fossiles." },
    { id: "sens", title: "Des yeux et un nez de chasseur", unlock: "hunt",
      text: "Ses yeux regardaient vers l'avant : sa vision en relief l'aidait à juger les distances. Et son cerveau avait de très gros lobes pour l'odorat." },
    { id: "chasseur", title: "Chasseur ou charognard ?", unlock: "scavenge",
      text: "Les deux ! Une dent de T. rex coincée dans une queue d'Edmontosaure qui a cicatrisé prouve qu'il attaquait des proies vivantes. Mais il ne refusait pas une carcasse." },
    { id: "bras", title: "Petits bras, gros muscles", unlock: "defend",
      text: "Ses bras ne mesuraient qu'un mètre et n'avaient que deux doigts. Pourtant, leurs muscles étaient puissants : à quoi servaient-ils ? Les savants en débattent encore." },
    { id: "peau", title: "Écailles ou plumes ?", unlock: "rest",
      text: "Des empreintes de peau fossile montrent de petites écailles sur le cou, le bassin et la queue. Ses cousins avaient des plumes : les bébés T. rex en avaient peut-être un peu." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras à deux doigts" },
    { id: "pattes", name: "Pattes" },
    { id: "queue", name: "Queue" },
  ],
  model: trexModel,
  skeleton: trexSkeleton,
  center: { x: 15 * TREX_SCALE, y: -118 * TREX_SCALE },
  eye: { x: TREX_EYE.x * TREX_SCALE, y: TREX_EYE.y * TREX_SCALE },
  feet: [12, 20].map((x) => x * TREX_SCALE),
  halfLen: 175 * TREX_SCALE,
  shadow: 0.6,
  walkSpeed: 42,
  runSpeed: 110,
  stride: 5,
  behavior: { diet: "carnivore", herd: [1, 1], browse: null, prey: ["edmonto", "trike", "ankylo", "pachy"], defense: "bite", sight: 520, scavenger: true },
};
