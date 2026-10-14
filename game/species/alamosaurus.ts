import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, squash, strike, turn } from "./ankylo";
import { AL } from "./alamosaurus.mat";
import type { Pose, Species } from "./types";

/**
 * Alamosaure (titanosaure, sauropode géant) modélisé en primitives (px locaux, regard vers la droite,
 * origine au sol sous le ventre). Quadrupède aux pattes en colonnes, long cou porté assez haut,
 * petite tête, longue queue en fouet et ostéodermes semés dans la peau.
 * Le modèle brut mesure ~530 px du bout de la queue au museau : peu de primitives, mais grandes.
 */
const LENGTH_M = 26;
export const ALAMOSAURUS_SCALE = (LENGTH_M * PX_PER_M) / 530;

/** Hanche : pivot du corps quand il se cabre. */
const HIP_X = -52, HIP_Y = -128;
/** Base du cou (au-dessus des épaules) et découpage du cou en segments. */
const NECK_X = 84, NECK_Y = -146;
const NECK_N = 6, NECK_SEG = 30;

interface AlamoLook {
  bob: number;
  drop: number;
  /** Tangage du corps autour de la hanche (négatif = cabré sur les pattes arrière). */
  pitch: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  /** Écart des pattes avant (pour boire). */
  spread: number;
  /** Pattes avant levées (cabré) : 0 = au sol, 1 = pendantes vers l'avant. */
  lift: number;
  /** Cou : angle de la base (rad, négatif = vers le haut) et courbure ajoutée à chaque segment. */
  neckA: number;
  neckBend: number;
  /** Angle de la tête dans le repère du corps (0 = museau vers l'avant, positif = vers le bas). */
  headA: number;
  mouth: number;
  /** Bouchée qui descend le long du cou (0 = tête, 1 = épaules ; négatif = aucune). */
  gulp: number;
  /** Queue : balancement vertical du bout, retombée vers le sol, raccourci (coup de fouet latéral). */
  tailSway: number;
  tailDroop: number;
  tailLen: number;
  eye: boolean;
}

/** Points du cou (de la base à la nuque), dans le repère du corps. */
function neckChain(a0: number, bend: number): [number, number][] {
  const pts: [number, number][] = [[NECK_X, NECK_Y]];
  let x = NECK_X, y = NECK_Y;
  for (let k = 0; k < NECK_N; k++) {
    const a = a0 + bend * k;
    x += Math.cos(a) * NECK_SEG; y += Math.sin(a) * NECK_SEG;
    pts.push([x, y]);
  }
  return pts;
}

/** Œil dans la tête (repère local : nuque à l'origine, museau vers +x). */
const EYE_LX = 5, EYE_LY = -6;

/** Pose de repos debout (sert aussi à placer l'œil et le squelette). */
const IDLE_NECK_A = -1.05, IDLE_BEND = 0.08, IDLE_HEAD_A = 0.35;

export function alamosaurusModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.4 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 4.2 : 2.2)) * (1 - moving) * (rest ? 2 : 1.2);
  const L: AlamoLook = {
    bob: -Math.abs(Math.sin(walk)) * 2.5 * moving * amp * amp + breath, drop: 0, pitch: 0, legs: "walk", amp,
    spread: 0, lift: 0,
    neckA: IDLE_NECK_A + Math.sin(time * 0.8) * 0.07 * (1 - moving) + (0.15 + Math.sin(walk * 2) * 0.03) * moving * amp,
    neckBend: IDLE_BEND + Math.sin(time * 0.6) * 0.02 * (1 - moving),
    headA: IDLE_HEAD_A + Math.sin(time * 0.8 + 0.6) * 0.1 * (1 - moving) - 0.05 * moving,
    mouth: 0, gulp: -1,
    tailSway: Math.sin(time * 0.9) * 6 * (1 - moving) + Math.sin(walk) * 10 * moving * amp, tailDroop: 100, tailLen: 1, eye: true,
  };
  if (action === "eat") {
    // Cou dressé vers la cime : il arrache les feuilles et les avale tout rond (la bouchée descend le cou).
    const bite = Math.sin(at * Math.PI * 8);
    L.neckA = -1.42 + Math.sin(time * 0.7) * 0.03; L.neckBend = 0.03; L.headA = -0.15 + bite * 0.06;
    L.mouth = Math.max(0, bite) * 0.7; L.gulp = (at * 2) % 1;
  } else if (action === "drink") {
    L.neckA = 0.32; L.neckBend = 0.14; L.headA = 1.25; L.drop = 6; L.spread = 16; L.mouth = 0.15;
  } else if (rest) {
    // Couché sur le ventre, cou replié vers l'avant, tête posée au sol.
    L.drop = 66; L.legs = "tuck"; L.neckA = -0.4; L.neckBend = 0.3; L.headA = 0.15 + breath * 0.01;
    L.tailDroop = 66; L.tailSway *= 0.3;
  } else if (action === "call") {
    // Cou tendu vers le ciel, bouche ouverte : un appel grave qui porte loin.
    const k = Math.sin(Math.min(1, at * 1.3) * Math.PI);
    L.neckA = IDLE_NECK_A - 0.35 * k; L.neckBend = IDLE_BEND - 0.05 * k; L.headA = IDLE_HEAD_A - 1.05 * k; L.mouth = k;
  } else if (action === "defend") {
    // Queue en fouet : elle balaie de côté (raccourcie en vue de profil), cou ramené en arrière.
    const yaw = Math.sin(time * 4);
    L.tailLen = 1 - 0.4 * yaw * yaw; L.tailSway = yaw * 24 - 20; L.tailDroop = 55;
    L.neckA = -1.25; L.neckBend = 0.1; L.headA = 0.7;
  } else if (action === "attack") {
    // Se cabre sur les pattes arrière (la queue sert d'appui), puis retombe de tout son poids.
    const { s, hit } = strike(at);
    const up = Math.max(0, -s);
    L.pitch = -0.5 * up + hit * 0.03; L.lift = up;
    L.neckA = IDLE_NECK_A - 0.15 * up; L.headA = IDLE_HEAD_A - 0.3 * up; L.mouth = up * 0.5;
    L.tailDroop = 100 - up * 70; L.tailSway = -hit * 40;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.neckA = 0.3; L.neckBend = 0.05; L.headA = 0.3;
    L.tailSway = 0; L.bob = 0;
  }
  const P = alamoParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc, cou étendu au sol, pattes raides.
    const D = squash(P, 0.5, 4);
    for (const [hip, dir, far, len] of [[-52, -1, true, 50], [70, 1, true, 44], [-40, -1, false, 58], [82, 1, false, 46]] as const) {
      const fx = hip + dir * len, fy = far ? -76 : -6, m = far ? AL.Far : AL.Skin, z = far ? -40 : 40;
      D.push(c(hip, -52, fx, fy, hip < 0 ? 24 : 19, 15, m, z, 18));
      D.push(e(fx + dir * 6, fy, 10, 14, m, z, 8));
    }
    return D.map((p) => scalePrim(p, ALAMOSAURUS_SCALE));
  }
  return P.map((p) => scalePrim(p, ALAMOSAURUS_SCALE));
}

function alamoParts(L: AlamoLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop;
  const P: Prim[] = [];

  // --- Pattes arrière : piliers massifs, pieds larges à griffes courtes ---
  for (const G of [{ dx: 0, phase: 0, far: true }, { dx: 12, phase: Math.PI, far: false }]) {
    const m = G.far ? AL.Far : AL.Skin, z = G.far ? -70 : 40;
    const hx = HIP_X + G.dx, hy = HIP_Y + 14 + bob;
    if (L.legs === "tuck") {
      P.push(e(hx + 8, -26, 46, 26, m, z - 4, 22));
      P.push(e(hx + 44, -8, 24, 8, m, z, 7));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 7 * L.amp;
    const fx = hx + 4 + s * 16, fy = -9 - lift;
    const kx = (hx + fx) / 2 + 8, ky = (hy + fy) / 2 - 4;
    P.push(e(hx + 4, hy - 14, 38, 46, m, z - 2, 28));
    P.push(c(hx, hy, kx, ky, 26, 20, m, z, 22));
    P.push(c(kx, ky, fx, fy, 20, 17, m, z + 2, 18));
    P.push(e(fx + 3, fy + 1, 23, 8, m, z + 3, 8));
    P.push(e(kx + 2, ky, 12, 4, AL.Wrinkle, z + 20, 4));
    if (!G.far) for (const t of [0, 7]) P.push(e(fx + 18 + t, fy + 4 - t * 0.3, 3.5, 2.5, AL.Nail, z + 14, 2));
  }

  // --- Corps, pattes avant, cou et tête : tout ce qui bascule autour de la hanche ---
  const B: Prim[] = [];
  for (const G of [{ dx: 0, phase: Math.PI, far: true }, { dx: 10, phase: 0, far: false }]) {
    const m = G.far ? AL.Far : AL.Skin, z = G.far ? -70 : 36;
    const sx = 62 + G.dx, sy = -122;
    if (L.legs === "none") break;
    if (L.legs === "tuck") {
      B.push(e(sx + 18, -24 - bob, 36, 18, m, z, 16));
      B.push(e(sx + 48, -8 - bob, 20, 7, m, z + 2, 6));
      continue;
    }
    // Pattes avant en colonnes : pas de doigts visibles, un « fer à cheval » d'os sous la peau.
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 7 * L.amp;
    const gx = sx + 4 + s * 16 + (G.far ? -L.spread * 0.5 : L.spread), gy = -9 - lift - bob;
    const fx = gx + L.lift * 26, fy = gy * (1 - L.lift) + (sy + 78) * L.lift;
    const ex = (sx + fx) / 2 + 3 + L.lift * 14, ey = (sy + fy) / 2;
    B.push(c(sx, sy, ex, ey, 22, 17, m, z, 20));
    B.push(c(ex, ey, fx, fy, 17, 15, m, z + 2, 16));
    B.push(e(fx + 2, fy + 1, 17, 8, m, z + 3, 7));
    B.push(e(ex + 1, ey, 10, 4, AL.Wrinkle, z + 18, 4));
  }

  // Queue en fouet : épaisse à la base, très fine au bout.
  const Q: Prim[] = [];
  const tail: [number, number, number][] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    tail.push([HIP_X - 30 - t * 215 * L.tailLen, HIP_Y - 6 + L.tailDroop * Math.pow(t, 1.4) + L.tailSway * t * t, 30 * Math.pow(1 - t, 1.2) + 1.5]);
  }
  for (let k = 0; k < 8; k++) {
    const [ax, ay, ra] = tail[k], [bx, by, rb] = tail[k + 1];
    Q.push(c(ax, ay, bx, by, ra, rb, AL.Skin, 2, Math.max(3, ra * 0.8)));
    if (ra > 6) Q.push(c(ax, ay + ra * 0.55, bx, by + rb * 0.55, ra * 0.4, rb * 0.4, AL.Belly, 2 + ra * 0.7, 3));
    if (k % 2 === 1 && ra > 5) Q.push(e((ax + bx) / 2, (ay + by) / 2 - ra * 0.1, Math.abs(bx - ax) * 0.25, ra * 0.55, AL.Mottle, 2 + ra * 0.85, 3));
    if (k < 4) Q.push(e(ax, ay - ra * 0.9, 4, 3, AL.Ridge, 4 + ra * 0.7, 3));
  }

  // Corps : bassin, ventre rond, épaules plus hautes que les hanches.
  B.push(e(-48, -132, 56, 50, AL.Skin, 4, 46));
  B.push(e(10, -126, 92, 50, AL.Skin, 0, 50));
  B.push(e(64, -138, 50, 44, AL.Skin, 2, 46));
  B.push(e(8, -86, 86, 14, AL.Belly, 14, 14, -86));
  // Grandes taches sur le flanc.
  for (const [x, y, rx, ry] of [[-60, -140, 16, 10], [-18, -150, 20, 9], [30, -144, 18, 11], [-34, -110, 14, 8], [12, -112, 16, 9], [58, -118, 12, 8]] as const) {
    B.push(e(x, y, rx, ry, AL.Mottle, 56, 4));
  }
  // Ostéodermes : plaques osseuses éparses sur le dos et le haut des flancs.
  for (const [x, y, r] of [[-78, -158, 5], [-50, -170, 6], [-22, -168, 7], [6, -172, 5], [34, -170, 6], [60, -168, 5],
    [-64, -128, 4], [-4, -136, 5], [44, -134, 4], [20, -158, 4], [-38, -150, 4], [76, -150, 4]] as const) {
    B.push(e(x, y, r, r * 0.8, AL.Osteo, 60, 4));
  }
  // Petites écailles en crête le long de l'échine.
  for (let j = 0; j < 8; j++) {
    const x = -90 + j * 24, y = -126 - 50 * Math.sqrt(Math.max(0, 1 - ((x - 10) / 92) ** 2));
    B.push(e(x, Math.min(y, -178 + Math.abs(x - 20) * 0.25) + 1, 3.5, 3, AL.Ridge, 54, 3));
  }

  // Cou : chaîne de segments, effilée de l'épaule à la nuque.
  const N = neckChain(L.neckA, L.neckBend);
  for (let k = 0; k < NECK_N; k++) {
    const [ax, ay] = N[k], [bx, by] = N[k + 1];
    const ra = 30 - k * 3.4, rb = 30 - (k + 1) * 3.4;
    const a = L.neckA + L.neckBend * k, nx = -Math.sin(a), ny = Math.cos(a);
    B.push(c(ax, ay, bx, by, ra, rb, AL.Skin, 8, ra * 0.8));
    // Gorge plus claire du côté avant / dessous.
    B.push(c(ax + nx * ra * 0.55, ay + ny * ra * 0.55, bx + nx * rb * 0.55, by + ny * rb * 0.55, ra * 0.4, rb * 0.4, AL.Belly, 8 + ra * 0.6, 3));
    if (k % 2 === 0) B.push(e((ax + bx) / 2 - nx * ra * 0.15, (ay + by) / 2 - ny * ra * 0.15, ra * 0.45, ra * 0.4, AL.Mottle, 8 + ra * 0.75, 3));
    if (k > 0) B.push(e(ax - nx * ra * 0.85, ay - ny * ra * 0.85, 3, 3, AL.Ridge, 8 + ra * 0.6, 3));
  }
  // Bouchée avalée tout rond, qui descend le long de la gorge.
  if (L.gulp >= 0) {
    const f = (1 - L.gulp) * NECK_N, k = Math.min(NECK_N - 1, Math.floor(f)), u = f - k;
    const [ax, ay] = N[k], [bx, by] = N[k + 1];
    const a = L.neckA + L.neckBend * k, r = 30 - f * 3.4;
    B.push(e(ax + (bx - ax) * u - Math.sin(a) * r * 0.5, ay + (by - ay) * u + Math.cos(a) * r * 0.5, r * 0.6, r * 0.6, AL.Skin, 8 + r * 0.9, r * 0.4));
  }

  // Tête : petite, museau large, narines hautes (repère local : nuque à l'origine, museau vers +x).
  const T: Prim[] = [];
  T.push(e(6, -2, 18, 13, AL.Skin, 30, 12));
  T.push(c(10, -1, 38, 2, 11, 8, AL.Skin, 32, 9));
  T.push(e(16, -12, 8, 5, AL.Face, 44, 3));
  if (L.mouth > 0.05) T.push(e(26, 7 + L.mouth * 4, 14, 2 + L.mouth * 5, M.Mouth, 29, 1));
  T.push(...turn([c(6, 7, 36, 9, 7, 5, AL.Skin, 31, 6), e(37, 9, 6, 4, AL.Face, 34, 3)], 6, 7, L.mouth * 0.45));
  T.push(e(38, 2, 7, 6, AL.Face, 38, 4));
  if (L.eye) T.push(e(EYE_LX, EYE_LY, 2.6, 2.6, M.Eye, 50, 1));
  else T.push(c(EYE_LX - 3, EYE_LY, EYE_LX + 3, EYE_LY, 1, 1, AL.Wrinkle, 50, 1, true));
  const [hx, hy] = N[NECK_N];
  B.push(...turn(T, 0, 0, L.headA, hx, hy));

  // Bascule autour de la hanche, puis respiration et appuis.
  P.push(...turn(Q, HIP_X, HIP_Y, -L.pitch * 0.4, 0, bob));
  P.push(...turn(B, HIP_X, HIP_Y, L.pitch, 0, bob));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function alamosaurusSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Cou : longues vertèbres creuses (sacs aériens), côtes cervicales en baguettes.
  const N = neckChain(IDLE_NECK_A, IDLE_BEND);
  for (let k = 0; k < NECK_N; k++) {
    const [ax, ay] = N[k], [bx, by] = N[k + 1];
    const r = 8 - k * 0.8, ux = (bx - ax) / NECK_SEG, uy = (by - ay) / NECK_SEG;
    tag("cou", c(ax + ux * 3, ay + uy * 3, bx - ux * 3, by - uy * 3, r, r * 0.8, B, 10, 5),
      c(ax - uy * r * 1.3, ay + ux * r * 1.3, bx - uy * r * 1.3, by + ux * r * 1.3, 1, 1, B, 9, 2, true));
  }
  // Dos : vertèbres et épines dorsales, de la base du cou aux hanches.
  for (let k = 0; k <= 8; k++) {
    const t = k / 8, x = 80 - t * 140, y = -152 - Math.sin(t * Math.PI) * 10 + t * 4;
    tag("vertebres", e(x, y, 7, 6, B, 10, 5), c(x, y - 4, x - 2, y - 18, 1, 1, B, 9, 2, true));
  }
  // Côtes : grandes arches jusqu'au ventre.
  for (let k = 0; k < 7; k++) {
    const x = 70 - k * 20, y = -158 - Math.sin(((80 - x) / 140) * Math.PI) * 10;
    tag("cotes", c(x, y + 4, x - 8, y + 40, 1, 1, B, 8, 2, true), c(x - 8, y + 40, x - 2, -84, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion large, pubis et ischion.
  tag("bassin", e(-52, -150, 34, 14, B, 12, 8), c(-40, -142, -24, -104, 4, 3, B, 12, 3), c(-62, -142, -86, -112, 4, 3, B, 12, 3));
  // Pattes arrière : fémur droit, tibia, pied court.
  for (const [hx, z] of [[-52, 4], [-40, 16]] as const) {
    tag("pattes-ar", c(hx, -140, hx + 4, -66, 9, 7, B, z, 6), c(hx + 4, -66, hx + 2, -18, 6, 5, B, z, 5),
      e(hx + 8, -8, 18, 5, B, z, 3), c(hx + 18, -8, hx + 26, -2, 1, 1, B, z + 2, 2, true));
  }
  // Pattes avant : humérus, avant-bras et métacarpes en colonne (en fer à cheval, sans doigts).
  for (const [sx, z] of [[62, 4], [72, 16]] as const) {
    tag("pattes-av", e(sx + 6, -142, 16, 10, B, z, 5), c(sx, -132, sx + 4, -70, 7, 6, B, z, 5),
      c(sx + 4, -70, sx + 6, -24, 5, 5, B, z, 4), c(sx + 6, -24, sx + 6, -6, 6, 6, B, z, 4));
  }
  // Queue : vertèbres de plus en plus petites, jusqu'au fouet.
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    tag("queue", e(HIP_X - 32 - t * 210, HIP_Y - 18 + 96 * Math.pow(t, 1.4), 7.5 - t * 5, 6 - t * 4, B, 10, 3));
  }
  tag("queue", c(HIP_X - 40, HIP_Y - 10, HIP_X - 200, HIP_Y + 50, 1, 1, B, 9, 2, true));
  // Crâne : petit, museau large, narines reculées vers le haut.
  const [hx, hy] = N[NECK_N];
  tag("crane", ...turn([e(6, -2, 16, 11, B, 12, 6), c(10, 0, 38, 3, 8, 6, B, 12, 5), c(6, 8, 36, 9, 3, 2, B, 12, 3),
    e(EYE_LX, EYE_LY, 4, 4, M.Socket, 30, 1), e(16, -7, 4, 2.5, M.Socket, 30, 1)], 0, 0, IDLE_HEAD_A, hx, hy));
  return P.map((p) => scalePrim(p, ALAMOSAURUS_SCALE));
}

/** Position de l'œil au repos (px locaux bruts). */
const IDLE_EYE = (() => {
  const [hx, hy] = neckChain(IDLE_NECK_A, IDLE_BEND)[NECK_N];
  const co = Math.cos(IDLE_HEAD_A), si = Math.sin(IDLE_HEAD_A);
  return { x: hx + EYE_LX * co - EYE_LY * si, y: hy + EYE_LX * si + EYE_LY * co };
})();

export const ALAMOSAURUS: Species = {
  id: "alamosaurus",
  name: "Alamosaure",
  latin: "Alamosaurus sanjuanensis",
  period: "Crétacé supérieur, 70-66 Ma",
  place: "Formation de Javelina (Texas), Nouveau-Mexique et Utah (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 30000,
  facts: [
    { id: "geant", title: "Le géant de la fin", unlock: "discover",
      text: "Long d'environ 26 mètres et lourd de 30 tonnes (autant que cinq éléphants), c'est l'un des plus grands animaux d'Amérique du Nord à la fin du Crétacé. C'était aussi le seul sauropode de cette époque sur le continent." },
    { id: "os-air", title: "Des os pleins d'air", unlock: "assemble",
      text: "Ses vertèbres étaient creusées de cavités où entraient des sacs d'air reliés aux poumons, comme chez les oiseaux. Son squelette géant était ainsi plus léger qu'il n'en a l'air." },
    { id: "cime", title: "Brouteur des cimes", unlock: "eat",
      text: "Grâce à son long cou, il atteignait les feuilles tout en haut des arbres, là où aucun autre herbivore de son époque ne pouvait aller." },
    { id: "sans-macher", title: "Avalé tout rond", unlock: "drink",
      text: "Ses dents fines comme des crayons servaient à arracher les feuilles, pas à les broyer : il avalait sans mâcher. Des pierres avalées l'aidaient peut-être à digérer, mais les savants en débattent encore." },
    { id: "armure", title: "Une armure en confettis", unlock: "rest",
      text: "Comme les autres titanosaures, il avait des ostéodermes : des plaques d'os éparpillées dans sa peau. Elles servaient peut-être de protection, ou de réserve de minéraux." },
    { id: "voix", title: "Une voix mystérieuse", unlock: "call",
      text: "On ne sait pas quel son il faisait. Comme les éléphants, un si grand animal lançait peut-être des appels très graves, capables de porter à des kilomètres." },
    { id: "venu-du-sud", title: "Revenu du sud", unlock: "herd",
      text: "Les sauropodes avaient disparu d'Amérique du Nord pendant des millions d'années. Les ancêtres de l'alamosaure sont sans doute arrivés d'Amérique du Sud. Des jeunes ont été retrouvés ensemble au Texas." },
    { id: "nids", title: "Des nids par milliers", unlock: "nest",
      text: "Les titanosaures pondaient dans d'immenses aires de nidification. À Auca Mahuevo, en Argentine, on a trouvé des milliers d'œufs ronds, et dedans des embryons avec l'empreinte de leur peau !" },
    { id: "bebe", title: "Petit bébé, grand adulte", unlock: "baby",
      text: "À l'éclosion, un bébé titanosaure pesait à peine 3 à 5 kilos, comme un chat. Adulte, il pouvait peser 30 tonnes : des milliers de fois plus lourd !" },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "cou", name: "Cou (vertèbres cervicales)" },
    { id: "vertebres", name: "Dos (vertèbres creuses)" },
    { id: "cotes", name: "Côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "pattes-av", name: "Pattes avant en colonnes" },
    { id: "pattes-ar", name: "Pattes arrière" },
    { id: "queue", name: "Queue en fouet" },
  ],
  model: alamosaurusModel,
  skeleton: alamosaurusSkeleton,
  center: { x: 0, y: -126 * ALAMOSAURUS_SCALE },
  eye: { x: IDLE_EYE.x * ALAMOSAURUS_SCALE, y: IDLE_EYE.y * ALAMOSAURUS_SCALE },
  feet: [-48, -36, 66, 76].map((x) => x * ALAMOSAURUS_SCALE),
  halfLen: 265 * ALAMOSAURUS_SCALE,
  shadow: 0.55,
  walkSpeed: 22,
  runSpeed: 40,
  stride: 2.2,
  behavior: { diet: "herbivore", herd: [2, 3], browse: "high", prey: [], defense: "flee", sight: 420, scavenger: false },
};
