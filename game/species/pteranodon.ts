import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { MR } from "./marine.mat";
import { PT } from "./pteranodon.mat";
import { c, e, knee, lerp, rot, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Pteranodon (Pteranodon longiceps) modélisé en primitives (px bruts, regard vers la droite, origine au
 * sol sous le corps), puis mis à l'échelle sur l'envergure : 2 x 165 px bruts = 6,5 m.
 *
 * Ce fichier porte aussi le « kit ptérosaure » partagé avec le Nyctosaurus : un gabarit (PteroKit)
 * décrit les proportions et la tête, les fonctions pteroGround / pteroFly / pteroDive / pteroDead
 * dessinent les poses.
 *
 * Conventions de pose (comme le Quetzalcoatlus) :
 * - au sol : quadrupède appuyé sur les poignets, ailes repliées ;
 * - « fly » : vue de trois quarts, corps dessiné à `flyY` au-dessus de l'origine (le jeu ajoute
 *   l'altitude) ; `walk` = phase des battements, `moving` 0 = plané ;
 * - « takeoff » / « land » : transitions sol <-> vol selon actionT ;
 * - « attack » = PIQUÉ DE PÊCHE (pose aérienne, même repère que « fly ») : 0-0.4 il plonge, nez en bas,
 *   ailes à demi repliées en arrière ; 0.4-0.62 le bout du bec touche la surface (y ≈ 0, juste sous
 *   l'origine) et happe un poisson ; 0.62-1 il remonte d'un grand battement, le poisson dans le bec.
 */
const SPAN_M = 6.5;
export const PTERANODON_SCALE = (SPAN_M * PX_PER_M) / 330;

export type Pt = [number, number];

/** Articulation d'un membre à deux segments ; `back` plie vers l'arrière (coude), sinon vers l'avant (genou). */
export function joint(hx: number, hy: number, ax: number, ay: number, l1: number, l2: number, back: boolean): Pt {
  if (!back) return knee(hx, hy, ax, ay, l1, l2);
  const dx = ax - hx, dy = ay - hy;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const a = Math.atan2(dy, dx) + Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  return [hx + l1 * Math.cos(a), hy + l1 * Math.sin(a)];
}

/** Point à la fraction t (0..1) de la longueur d'une ligne brisée. */
export function along(pts: Pt[], t: number): Pt {
  const seg: number[] = [];
  let tot = 0;
  for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(l); tot += l; }
  let d = Math.min(1, Math.max(0, t)) * tot;
  for (let k = 0; k < seg.length; k++) {
    if (d <= seg[k] || k === seg.length - 1) {
      const u = seg[k] ? Math.min(1, d / seg[k]) : 0;
      return [lerp(pts[k][0], pts[k + 1][0], u), lerp(pts[k][1], pts[k + 1][1], u)];
    }
    d -= seg[k];
  }
  return pts[pts.length - 1];
}

/** Membrane tendue entre deux bords (lignes brisées) : capsules reliant les bords à la même fraction de longueur. */
export function sheet(L: Pt[], T: Pt[], n: number, m: number, z: number): Prim[] {
  const P: Prim[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, t2 = Math.min(1, (k + 1) / n);
    const a = along(L, t), b = along(T, t), a2 = along(L, t2), b2 = along(T, t2);
    const ra = Math.max(2.2, Math.hypot(a2[0] - a[0], a2[1] - a[1]) * 0.7);
    const rb = Math.max(2.2, Math.hypot(b2[0] - b[0], b2[1] - b[1]) * 0.7);
    P.push(c(a[0], a[1], b[0], b[1], ra, rb, m, z, 3));
  }
  return P;
}

/** Point (x, y) tourné de a autour de (px, py), puis décalé. */
export function rp(x: number, y: number, px: number, py: number, a: number, dx = 0, dy = 0): Pt {
  const co = Math.cos(a), si = Math.sin(a);
  return [px + (x - px) * co - (y - py) * si + dx, py + (x - px) * si + (y - py) * co + dy];
}

/** Matières d'un ptérosaure ; `vein` 0 = pas d'actinofibrilles dessinées. */
export interface PteroMats { skin: number; far: number; belly: number; wing: number; wingFar: number; vein: number }

/** Tête : pivot (x0, y0) à la base du crâne, bec vers +x ; `fish` 0..1 = poisson tenu dans le bec. */
export type PteroHead = (x0: number, y0: number, jaw: number, closed: boolean, fish: number) => Prim[];

/** Gabarit d'un ptérosaure, en px bruts (avant mise à l'échelle). */
export interface PteroKit {
  mats: PteroMats;
  head: PteroHead;
  /** Bout du bec dans le repère de la tête (pivot en 0,0, sans rotation). */
  tip: Pt;
  hip: Pt;
  sho: Pt;
  neck0: Pt;
  neck1: Pt;
  /** Inclinaison de la tête au repos (+ = bec vers le bas). */
  headA: number;
  /** Rayons du tronc (hanche, épaules) et du cou (base, tête). */
  torso: Pt;
  neckR: Pt;
  /** Bras : humérus, avant-bras, métacarpe. */
  arm: [number, number, number];
  /** Patte : fémur, tibia. */
  leg: Pt;
  /** Bout du doigt de l'aile replié, relatif à l'épaule. */
  fold: Pt;
  /** Petits doigts griffus à la main (absents chez Nyctosaurus). */
  claws: boolean;
  /** Corps abaissé au sol (px) : posture accroupie d'un animal qui marche mal. */
  crouch: number;
  /** Vol : hauteur du corps au-dessus de l'origine. */
  flyY: number;
  /** Vol : bord d'attaque [x, distance le long de l'envergure] : épaule, coude, poignet, articulation, bout du doigt. */
  edge: Pt[];
  /** Vol : largeur relative de la membrane (0 = aile très étroite). */
  chord: number;
  /** Vol : tronc (arrière, avant) et bout du cou, relatifs au centre du corps. */
  flyBody: [Pt, Pt];
  flyNeck: Pt;
}

/** Réglages de pose au sol, déduits de l'action. */
interface PRig {
  dx: number;
  dy: number;
  /** Tangage du corps autour de la hanche (+ = épaules qui plongent). */
  pitch: number;
  neck: number;
  head: number;
  jaw: number;
  legs: "stand" | "sit" | "rear";
  stride: number;
  closed: boolean;
  fish: number;
}

function pteroRig({ action, actionT: t, time }: Pose, K: PteroKit): PRig {
  const r: PRig = { dx: 0, dy: 0, pitch: 0, neck: 0, head: 0, jaw: 0, legs: "stand", stride: 1, closed: false, fish: 0 };
  const s = Math.sin(t * Math.PI * 2);
  const sz = -K.sho[1] / 60;
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.06, neck: 0.3, head: -0.1, stride: 1.5 });
      break;
    case "eat": {
      // Au bord de l'eau : il pique un poisson (0-0.55), puis rejette la tête en arrière pour l'avaler entier.
      if (t < 0.55) {
        const st = Math.abs(Math.sin((t / 0.55) * Math.PI * 2));
        Object.assign(r, { pitch: 0.16, dy: 4 * sz, neck: 0.62 + st * 0.12, head: 0.02 + st * 0.2, jaw: (1 - st) * 0.4 });
      } else {
        const u = (t - 0.55) / 0.45;
        const k = Math.sin(Math.min(1, u * 1.4) * Math.PI);
        Object.assign(r, { pitch: -0.04, neck: -0.25 * k, head: -0.95 * k, jaw: 0.3 * k, fish: Math.max(0, 1 - u * 1.3) });
      }
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.18, dy: 6 * sz, neck: 0.72 + s * 0.02, head: 0.42, jaw: 0.06 });
      break;
    case "rest": {
      const br = Math.sin(time * 1.4) * 0.03;
      Object.assign(r, { legs: "sit", dy: -K.sho[1] * 0.42, pitch: -0.04, neck: 0.12 + br, head: -0.12, closed: true });
      break;
    }
    case "call": {
      const k = Math.sin(Math.min(1, t * 1.3) * Math.PI);
      Object.assign(r, { pitch: -0.06, neck: -0.3 * k, head: -0.85 * k, jaw: (0.5 + 0.25 * Math.abs(s)) * k });
      break;
    }
    case "defend":
      // Se dresse sur les pattes arrière, ailes à demi ouvertes, bec béant.
      Object.assign(r, { legs: "rear", pitch: -0.2, dy: -4 * sz, neck: 0.1 + s * 0.04, head: 0.1, jaw: 0.55 + 0.2 * s });
      break;
    default:
      break;
  }
  return r;
}

/** Pose au sol : quadrupède, ailes repliées le long des bras, doigt de l'aile dressé derrière l'épaule. */
export function pteroGround(pose: Pose, K: PteroKit): Prim[] {
  const { walk, moving, time } = pose;
  const r = pteroRig(pose, K);
  const Mt = K.mats;
  const [l1, l2, meta] = K.arm;
  const sc = meta / 40;
  const breath = Math.sin((time * Math.PI * 2) / 2.4) * (1 - moving);
  const bob = -Math.abs(Math.sin(walk)) * 3 * sc * moving * r.stride + breath;
  const bx = r.dx, by = r.dy + bob + (r.legs === "stand" ? K.crouch : 0);
  const P: Prim[] = [];
  const [shx, shy] = rp(K.sho[0], K.sho[1], K.hip[0], K.hip[1], r.pitch, bx, by);
  const hipx = K.hip[0] + bx, hipy = K.hip[1] + by;

  // --- Membres : avant (bras + aile repliée), arrière ; diagonales opposées en phase ---
  for (const L of [{ ph: 0, far: true }, { ph: Math.PI, far: false }]) {
    const m = L.far ? Mt.far : Mt.skin;
    const wm = L.far ? Mt.wingFar : Mt.wing;
    const z = L.far ? -40 : 30;
    const off = (L.far ? -5 : 0) * sc;
    const ph = walk + L.ph + Math.PI;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 9 * sc * r.stride;
    let hx = shx + 12 * sc + off + sw * 18 * sc, hy = -3 - lift;
    let wx = hx - 2 * sc, wy = hy - meta;
    let tipx = shx + K.fold[0] + off, tipy = shy + K.fold[1];
    if (r.legs === "sit") {
      hx = shx + 24 * sc + off; hy = -3; wx = hx - 14 * sc; wy = -meta * 0.4;
      tipx = shx + K.fold[0] * 1.7 + off; tipy = shy + K.fold[1] * 0.55;
    } else if (r.legs === "rear") {
      // Bras levés : la main ne touche plus le sol, le doigt de l'aile se déploie vers le haut et l'arrière.
      wx = shx + 30 * sc + off; wy = shy - 18 * sc + Math.sin(time * 3) * 3 * sc; hx = wx + 10 * sc; hy = wy + meta * 0.85;
      tipx = shx + K.fold[0] * 3 + off * 3; tipy = shy + K.fold[1] * 3.2 - (L.far ? 10 * sc : 0);
    }
    const [ex, ey] = joint(shx, shy, wx, wy, l1, l2, true);
    const kx = hx, ky = hy - 4 * sc;
    // Membrane : bande repliée le long du bras (au sol), grande voile tendue vers la hanche (défense).
    if (r.legs === "rear") P.push(...sheet([[kx, ky], [tipx, tipy]], [[wx, wy], [ex, ey], [hipx - 6 * sc, hipy + 6 * sc]], 9, wm, z - 4));
    else P.push(c(kx - 3 * sc, ky - 6 * sc, tipx - 3 * sc, tipy + 6 * sc, 4 * sc, 2.5 * sc, wm, z - 2, 3));
    P.push(c(kx, ky, tipx, tipy, 3 * sc, 1, m, z + 2, 3));
    P.push(c(shx, shy, ex, ey, 9 * sc, 6 * sc, m, z, 8));
    P.push(c(ex, ey, wx, wy, 6 * sc, 4 * sc, m, z + 2, 6));
    P.push(c(wx, wy, hx, hy, 4 * sc, 3 * sc, m, z + 4, 4));
    P.push(e(wx, wy, 5 * sc, 4 * sc, m, z + 4, 4));
    // Trois petits doigts griffus devant le poignet (Pteranodon) ; sinon simple moignon (Nyctosaurus).
    if (K.claws) for (const k of [-2, 2]) P.push(c(hx, hy + 1, hx + 5 * sc, hy + 1 + k * 0.5, 1, 1, MR.QClaw, z + 10, 1, true));
    else P.push(e(hx + 1, hy, 3 * sc, 2.5 * sc, m, z + 5, 2));

    // Patte arrière : hanche → genou (vers l'avant) → cheville → pied plantigrade.
    const ph2 = walk + L.ph;
    const sw2 = Math.sin(ph2) * moving * r.stride;
    const lift2 = Math.max(0, Math.cos(ph2)) * moving * 8 * sc * r.stride;
    let fx = K.hip[0] + 6 * sc + off + sw2 * 16 * sc + bx, fy = -3 - lift2;
    if (r.legs === "sit") { fx = hipx + 20 * sc + off; fy = -3; }
    else if (r.legs === "rear") fx = hipx + 12 * sc + off;
    const ax = fx - 6 * sc, ay = fy - 8 * sc;
    const [nx, ny] = joint(hipx, hipy + 3 * sc, ax, ay, K.leg[0], K.leg[1], false);
    P.push(e(hipx + 2, hipy + 5 * sc, 10 * sc, 12 * sc, m, z - 6, 8));
    P.push(c(hipx, hipy + 5 * sc, nx, ny, 7 * sc, 4.5 * sc, m, z, 6));
    P.push(c(nx, ny, ax, ay, 4.5 * sc, 3 * sc, m, z + 2, 4));
    P.push(c(ax, ay, fx + 6 * sc, fy, 3 * sc, 2 * sc, m, z + 4, 3));
    P.push(c(fx + 4 * sc, fy + 1, fx + 10 * sc, fy + 2, 1, 1, MR.QClaw, z + 10, 1, true));
  }

  // --- Corps, cou et tête : au repos, puis tournés autour de la hanche ---
  const [hX, hY] = K.hip, [sX, sY] = K.sho;
  const B: Prim[] = [];
  B.push(c(hX - 12 * sc, hY + 2 * sc, sX - 4 * sc, sY + 4 * sc, K.torso[0], K.torso[1], Mt.skin, 0, K.torso[1]));
  B.push(c(hX - 2 * sc, hY + K.torso[0] * 0.5, sX - 2 * sc, sY + K.torso[1] * 0.6, K.torso[0] * 0.5, K.torso[1] * 0.5, Mt.belly, 6, 4));
  // Queue minuscule.
  B.push(c(hX - 12 * sc, hY + 1, hX - 24 * sc, hY + 4 * sc, 3 * sc, 1, Mt.skin, 2, 3));
  const N: Prim[] = [
    c(K.neck0[0], K.neck0[1], K.neck1[0], K.neck1[1], K.neckR[0], K.neckR[1], Mt.skin, 4, K.neckR[1]),
    c(K.neck0[0] + 4 * sc, K.neck0[1] + 2, K.neck1[0] + 3 * sc, K.neck1[1] + 3 * sc, K.neckR[0] * 0.35, K.neckR[1] * 0.35, Mt.belly, 10, 2),
  ];
  N.push(...rot(K.head(K.neck1[0], K.neck1[1], r.jaw, r.closed, r.fish), K.neck1[0], K.neck1[1], K.headA + r.head));
  B.push(...rot(N, K.neck0[0], K.neck0[1], r.neck));
  P.push(...rot(B, hX, hY, r.pitch, bx, by));
  return P;
}

/** Mort : couché sur le flanc, aile proche étalée au sol, cou et bec allongés. */
export function pteroDead(K: PteroKit): Prim[] {
  const Mt = K.mats;
  const sc = K.arm[2] / 40;
  const P: Prim[] = [];
  const sh: Pt = [14 * sc, -16 * sc], el: Pt = [-4 * sc, -32 * sc], wr: Pt = [-30 * sc, -30 * sc];
  const kn: Pt = [-54 * sc, -34 * sc], tip: Pt = [-54 * sc - K.edge[4][1] * 0.55, -10];
  P.push(...sheet([sh, el, wr, kn, tip], [[-20 * sc, -8], [-60 * sc - K.edge[4][1] * 0.2, -6], tip], 12, Mt.wing, 4));
  for (const [a, b, ra, rb] of [[sh, el, 6, 4], [el, wr, 4, 3], [wr, kn, 3.5, 2.5], [kn, tip, 2.5, 1]] as const) {
    P.push(c(a[0], a[1], b[0], b[1], ra * sc, rb * sc, Mt.skin, 10, 4));
  }
  if (Mt.vein) for (const t of [0.45, 0.65, 0.85]) {
    const a = along([sh, el, wr, kn, tip], t), b = along([[-20 * sc, -8], [-60 * sc - K.edge[4][1] * 0.2, -6], tip], t);
    P.push(c(a[0], a[1], b[0], b[1], 1, 1, Mt.vein, 8, 1, true));
  }
  // Corps, pattes molles, cou et tête posés au sol.
  P.push(e(-2 * sc, -12 * sc, K.torso[1] * 1.6, K.torso[1] * 0.85, Mt.skin, 6, 10));
  P.push(e(0, -6 * sc, K.torso[1] * 1.2, K.torso[1] * 0.3, Mt.belly, 12, 3, -7 * sc));
  P.push(c(-20 * sc, -8 * sc, -40 * sc, -3, 5 * sc, 3 * sc, Mt.skin, 10, 4), c(-40 * sc, -3, -50 * sc, -2, 3 * sc, 2 * sc, Mt.skin, 10, 3));
  const nl = Math.hypot(K.neck1[0] - K.neck0[0], K.neck1[1] - K.neck0[1]);
  const hx = 18 * sc + nl, hy = -K.neckR[1] - 2;
  P.push(c(18 * sc, -12 * sc, hx, hy, K.neckR[0], K.neckR[1], Mt.skin, 8, 6));
  P.push(...rot(K.head(hx, hy, 0.1, true, 0), hx, hy, 0.08));
  return P;
}

/** Vue de trois quarts en vol : profondeur → écran (un peu à gauche, vers le bas). */
const KX = -0.3, KY = 0.62;

/**
 * Corps volant en repère local (centre du corps en 0, by) : `theta` = angle des ailes (+ = relevées),
 * `fold` 0..1 = ailes repliées en arrière (piqué), `headA` = inclinaison de la tête.
 */
function flyPrims(K: PteroKit, by: number, theta: number, fold: number, headA: number, jaw: number, fish: number): Prim[] {
  const Mt = K.mats;
  const sc = K.arm[2] / 40;
  const P: Prim[] = [];
  const [ta, tb] = K.flyBody;
  const wing = (s: number) => {
    const far = s < 0;
    const pj = (x: number, d: number): Pt => {
      const up = (d - 8) * Math.sin(theta), dp = 8 + (d - 8) * Math.cos(theta);
      return [x + s * dp * KX, by - up + s * dp * KY];
    };
    // Bord d'attaque : épaule, coude, poignet, articulation du doigt, bout du 4e doigt (balayé vers l'arrière au repli).
    const Ed = K.edge;
    const L = [
      pj(Ed[0][0], Ed[0][1]), pj(Ed[1][0], Ed[1][1]), pj(Ed[2][0] - fold * 10, Ed[2][1] - fold * 8),
      pj(Ed[3][0] - fold * 30, Ed[3][1] - fold * 22), pj(Ed[4][0] - fold * 95, Ed[4][1] - fold * 70),
    ];
    const ank = pj(ta[0] - 10 * sc, 10);
    const tip = L[4];
    const mid = along([ank, tip], 0.55), lm = along(L, 0.6);
    const T: Pt[] = [ank, [lerp(mid[0], lm[0], 1 - K.chord), lerp(mid[1], lm[1], 1 - K.chord)], tip];
    const z = far ? -40 : 40;
    const m = far ? Mt.far : Mt.skin;
    P.push(...sheet(L, T, 13, far ? Mt.wingFar : Mt.wing, z));
    // Propatagium : petite voile devant le bras, de l'épaule au poignet.
    P.push(c(L[0][0] + 5 * sc, L[0][1] - 2, L[2][0] + 3 * sc, L[2][1] - 2, 3 * sc, 2 * sc, far ? Mt.wingFar : Mt.wing, z, 2));
    const rad = [[6, 4.5], [4.5, 3.5], [3.5, 2.5], [2.5, 1]];
    for (let k = 0; k < 4; k++) P.push(c(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], rad[k][0] * sc, rad[k][1] * sc, m, z + 4, 4));
    if (K.claws) P.push(c(L[2][0], L[2][1], L[2][0] + 6 * sc, L[2][1] - 2, 1, 1, MR.QClaw, z + 6, 1, true));
    // Actinofibrilles : fibres qui raidissent la membrane.
    if (!far && Mt.vein) for (const t of [0.5, 0.7, 0.88]) {
      const a = along(L, t), b = along(T, t);
      P.push(c(a[0], a[1], b[0], b[1], 1, 1, Mt.vein, z + 3, 1, true));
    }
  };
  wing(-1);

  // Tronc fuselé, petite queue, pattes repliées vers l'arrière.
  P.push(c(ta[0], by + ta[1], tb[0], by + tb[1], K.torso[0], K.torso[1], Mt.skin, 0, K.torso[1]));
  P.push(c(ta[0] + 6 * sc, by + ta[1] + K.torso[0] * 0.5, tb[0] - 2 * sc, by + tb[1] + K.torso[1] * 0.55, K.torso[0] * 0.5, K.torso[1] * 0.5, Mt.belly, 4, 4));
  P.push(c(ta[0], by + ta[1], ta[0] - 12 * sc, by + ta[1] + 1, 2.5 * sc, 1, Mt.skin, 2, 2));
  for (const far of [true, false]) {
    const m = far ? Mt.far : Mt.skin, z = far ? -12 : 12, o = (far ? -2 : 2) * sc;
    const lx = ta[0] + 6 * sc, ly = by + ta[1] + 3 * sc + o;
    P.push(c(lx, ly, lx - 16 * sc, ly + 4 * sc, 5 * sc, 3.5 * sc, m, z, 4));
    P.push(c(lx - 16 * sc, ly + 4 * sc, lx - 30 * sc, ly + 5 * sc, 3 * sc, 2 * sc, m, z, 3));
    P.push(c(lx - 30 * sc, ly + 5 * sc, lx - 38 * sc, ly + 3 * sc, 1, 1, MR.QClaw, z + 4, 1, true));
  }
  // Cou court tendu vers l'avant, tête en équilibre (crête vers l'arrière, bec vers l'avant).
  const [nx, ny] = [K.flyNeck[0], by + K.flyNeck[1]];
  P.push(c(tb[0] - 2 * sc, by + tb[1], nx, ny, K.neckR[0], K.neckR[1], Mt.skin, 4, K.neckR[1]));
  P.push(...rot(K.head(nx, ny, jaw, false, fish), nx, ny, headA));
  wing(1);
  return P;
}

/** Vol battu (`moving` 1) ou plané (`moving` 0, léger dièdre qui ondule). */
export function pteroFly({ walk, moving, time }: Pose, K: PteroKit): Prim[] {
  const flap = Math.sin(walk);
  const theta = lerp(0.08 + Math.sin(time * 1.3) * 0.03, 0.5 * flap, moving);
  // Remontée : l'aile se replie un peu au poignet pour moins freiner.
  const fold = moving * Math.max(0, Math.cos(walk)) * 0.3;
  const by = K.flyY + flap * 5 * moving;
  return flyPrims(K, by, theta, fold, 0.1, 0, 0);
}

/** Bout du bec (repère local de flyPrims, by = 0) pour une inclinaison de tête donnée. */
function tipAt(K: PteroKit, headA: number): Pt {
  return rp(K.flyNeck[0] + K.tip[0], K.flyNeck[1] + K.tip[1], K.flyNeck[0], K.flyNeck[1], headA);
}

/**
 * Piqué de pêche (action « attack » en vol) : il plonge nez en bas, ailes relevées et repliées vers
 * l'arrière, happe un poisson au ras de l'eau (bout du bec à y ≈ +3 bruts, sous l'origine), puis remonte.
 */
export function pteroDive({ actionT: t, time }: Pose, K: PteroKit): Prim[] {
  const down = win(t, 0, 0.4);
  const up = win(t, 0.62, 0.97);
  const k = down * (1 - up);
  const pitch = 0.62 * k - 0.22 * up * (1 - win(t, 0.85, 1));
  // Ailes relevées en V et rabattues en arrière pendant le piqué ; grand battement à la remontée.
  const beat = t > 0.62 ? Math.sin(((t - 0.62) / 0.38) * Math.PI * 2 + Math.PI / 2) * 0.5 * (1 - k) : 0;
  const theta = lerp(0.08 + Math.sin(time * 1.3) * 0.03, 0.62, k) + beat;
  const fold = 0.85 * k;
  const headA = 0.1 + 0.3 * k;
  const jaw = 0.6 * win(t, 0.3, 0.42) * (1 - win(t, 0.5, 0.54));
  const fish = t > 0.52 ? 1 : 0;
  const local = flyPrims(K, 0, theta, fold, headA, jaw, fish);
  // Translation : du vol (flyY) jusqu'au contact du bout du bec avec l'eau.
  const [tx, ty] = tipAt(K, headA);
  const [, rty] = rp(tx, ty, 0, 0, pitch);
  const dy = lerp(K.flyY, 3 - rty, k);
  return rot(local, 0, 0, pitch, 0, dy);
}

/**
 * Envol (lancement quadrupède : il s'accroupit puis bondit sur ses bras, comme à la perche) et
 * atterrissage (ailes cabrées pour freiner, pattes en avant, puis il replie les ailes).
 */
export function pteroTransition(pose: Pose, K: PteroKit): Prim[] {
  const t = pose.actionT, base = { ...pose, moving: 1 };
  if (pose.action === "takeoff") {
    if (t < 0.25) return pteroGround({ ...pose, action: "rest", actionT: 0 }, K);
    if (t < 0.45) return pteroGround({ ...pose, action: "defend", actionT: 0.5 }, K);
    return pteroFly({ ...base, action: "fly", walk: ((t - 0.45) / 0.55) * Math.PI * 4 - Math.PI / 2 }, K);
  }
  if (t < 0.45) return pteroFly({ ...base, action: "fly", walk: Math.PI / 2 }, K); // ailes hautes : il freine
  if (t < 0.75) return pteroGround({ ...pose, action: "defend", actionT: 0.5 }, K);
  return pteroGround({ ...pose, action: "idle", actionT: 0 }, K);
}

/** Aiguillage commun des poses d'un ptérosaure (avant mise à l'échelle). */
export function pteroModel(pose: Pose, K: PteroKit): Prim[] {
  switch (pose.action) {
    case "fly": return pteroFly(pose, K);
    case "attack": return pteroDive(pose, K);
    case "dead": return pteroDead(K);
    case "takeoff":
    case "land": return pteroTransition(pose, K);
    default: return pteroGround(pose, K);
  }
}

// --- Pteranodon ---

/**
 * Tête de mâle : bec en poignard sans dents (~1,2 m), longue crête pointée vers l'arrière.
 * Pivot (x0, y0) à la base du crâne.
 */
function pteranodonHead(x0: number, y0: number, jaw: number, closed: boolean, fish: number): Prim[] {
  const H: Prim[] = [
    e(x0 + 4, y0 - 1, 9, 6.5, PT.Skin, 6, 7),
    // Crête : lame osseuse longue et étroite, plus claire sur le bord supérieur.
    c(x0 + 2, y0 - 4, x0 - 40, y0 - 19, 5.5, 1.6, PT.Crest, 8, 4),
    c(x0 - 2, y0 - 7, x0 - 36, y0 - 20, 1, 1, PT.Crest, 12, 1, true),
    // Bec supérieur, long et pointu.
    c(x0 + 6, y0 - 3, x0 + 64, y0 + 2, 5.5, 0.7, PT.Beak, 8, 5),
    e(x0 + 18, y0 - 3, 8, 1.6, PT.Skin, 12, 1),
  ];
  if (closed) H.push(c(x0 + 3, y0 - 3, x0 + 8, y0 - 3, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(x0 + 5, y0 - 3, 2.2, 2.2, M.Eye, 20, 1));
  // Gueule ouverte : intérieur sombre, mandibule abaissée (poche de gorge comme un pélican ?).
  if (jaw > 0.08) H.push(e(x0 + 30, y0 + 3, 26, 2 + jaw * 8, MR.MMouth, 3, 2, y0 + 1));
  const J: Prim[] = [
    c(x0 + 6, y0 + 3, x0 + 60, y0 + 3, 3.8, 0.7, PT.Beak, 7, 4),
    e(x0 + 12, y0 + 5, 7, 3, PT.Belly, 5, 3),
  ];
  if (jaw <= 0.08) J.push(c(x0 + 10, y0 + 1, x0 + 56, y0 + 2, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, x0 + 6, y0 + 3, jaw * 0.4));
  if (fish > 0) {
    // Poisson argenté tenu en travers du bout du bec.
    const fx = x0 + 52, fy = y0 + 3, f = fish;
    H.push(e(fx, fy + 2 * f, 3 * f, 9 * f, MR.MScale, 16, 3));
    H.push(c(fx, fy + 10 * f, fx + 3 * f, fy + 15 * f, 2 * f, 1, MR.MScale, 16, 2));
    H.push(c(fx, fy + 10 * f, fx - 3 * f, fy + 15 * f, 2 * f, 1, MR.MScale, 16, 2));
  }
  return H;
}

const P_KIT: PteroKit = {
  mats: { skin: PT.Skin, far: PT.Far, belly: PT.Belly, wing: PT.Wing, wingFar: PT.WingFar, vein: PT.Vein },
  head: pteranodonHead,
  tip: [64, 2],
  hip: [-20, -42],
  sho: [16, -66],
  neck0: [20, -68],
  neck1: [40, -102],
  headA: 0.14,
  torso: [9, 12],
  neckR: [7, 5],
  arm: [18, 24, 34],
  leg: [17, 22],
  fold: [-34, -44],
  claws: true,
  crouch: 0,
  flyY: -182,
  edge: [[14, 8], [0, 26], [16, 54], [8, 84], [-50, 165]],
  chord: 0.55,
  flyBody: [[-24, 2], [12, -4]],
  flyNeck: [34, -14],
};

const EYE: Pt = rp(P_KIT.neck1[0] + 5, P_KIT.neck1[1] - 3, P_KIT.neck1[0], P_KIT.neck1[1], P_KIT.headA);

export function pteranodonModel(pose: Pose): Prim[] {
  return pteroModel(pose, P_KIT).map((p) => scalePrim(p, PTERANODON_SCALE));
}

/**
 * Squelette commun d'un ptérosaure (format : voir ankyloSkeleton), debout, ailes repliées, regard à droite.
 * `skull` : crâne dessiné au pivot `neck1` (avant rotation) ; `ids` : os du sternum et du bassin (rattachés
 * à la colonne si l'espèce ne les distingue pas) ; `w` épaissit les os des petites espèces.
 */
export function pteroSkeleton(K: PteroKit, skull: Prim[], ids: { sternum: string; bassin: string }, w = 1): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const [n1x, n1y] = K.neck1;
  tag("crane", ...rot(skull, n1x, n1y, K.headA));
  // Cou : vertèbres cervicales assez longues.
  for (let k = 0; k < 6; k++) {
    const t0 = k / 6 + 0.02, t1 = (k + 1) / 6 - 0.02;
    tag("cou", c(lerp(K.neck0[0], n1x, t0), lerp(K.neck0[1], n1y, t0), lerp(K.neck0[0], n1x, t1), lerp(K.neck0[1], n1y, t1), 3 * w, 2.5 * w, B, 10, 3));
  }
  // Dos (notarium soudé) et courte queue.
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    tag("vertebres", e(lerp(K.neck0[0] - 4, K.hip[0], t), lerp(K.neck0[1] + 3, K.hip[1] - 3, t), 3.5 * w, 3 * w, B, 10, 3));
  }
  for (let k = 1; k <= 3; k++) tag("vertebres", e(K.hip[0] - 5 - k * 5 * w, K.hip[1] + k, (2.2 - k * 0.4) * w, 1.8 * w, B, 10, 2));
  // Sternum en bouclier avec son bréchet, où s'ancraient les muscles du vol.
  const st: Pt = [lerp(K.hip[0], K.sho[0], 0.75), lerp(K.hip[1], K.sho[1], 0.75) + K.torso[1] * 0.8];
  tag(ids.sternum, e(st[0], st[1], 10 * w, 5 * w, B, 12, 5), c(st[0] + 4, st[1] + 3, st[0] + 16, st[1] - 5, 2 * w, 1.2 * w, B, 14, 2));
  tag(ids.bassin, e(K.hip[0], K.hip[1] - 2, 11 * w, 5 * w, B, 12, 5), c(K.hip[0] + 3, K.hip[1] + 2, K.hip[0] + 8, K.hip[1] + 10, 2 * w, 1.5 * w, B, 12, 2));
  const sc = K.arm[2] / 40;
  for (const [o, z] of [[-4, 4], [0, 18]] as const) {
    // Bras : humérus à grande crête, avant-bras, ptéroïde, long métacarpe (et petits doigts griffus).
    const hx = K.sho[0] + 12 * sc + o, wx = hx - 2 * sc, wy = -3 - K.arm[2];
    const [ex, ey] = joint(K.sho[0], K.sho[1], wx, wy, K.arm[0], K.arm[1], true);
    tag("ailes",
      c(K.sho[0], K.sho[1], ex, ey, 3.5 * w, 3 * w, B, z, 3), e(lerp(K.sho[0], ex, 0.35) + 3, lerp(K.sho[1], ey, 0.35), 3.5 * w, 2.5 * w, B, z, 3),
      c(ex, ey, wx, wy, 2.6 * w, 2.2 * w, B, z, 3), c(wx, wy, wx + 6, wy - 8, 1, 1, B, z + 2, 1, true),
      c(wx, wy, hx, -5, 2.2 * w, 1.8 * w, B, z, 2));
    if (K.claws) tag("ailes", c(hx, -4, hx + 5, -2, 1, 1, B, z + 2, 1, true));
    // Doigt de l'aile replié : quatre phalanges qui remontent au-dessus de l'épaule.
    const kn: Pt = [hx, -6], tp: Pt = [K.sho[0] + K.fold[0] + o, K.sho[1] + K.fold[1]];
    for (let k = 0; k < 4; k++) {
      const a = along([kn, tp], k / 4 + 0.01), b = along([kn, tp], (k + 1) / 4 - 0.01);
      tag("doigt", c(a[0], a[1], b[0], b[1], (2.2 - k * 0.4) * w, (1.9 - k * 0.4) * w, B, z + 1, 2));
    }
    // Pattes arrière : fémur, tibia, pied.
    const fx = K.hip[0] + 6 * sc + o, ax = fx - 6 * sc, ay = -3 - 8 * sc;
    const [nx, ny] = joint(K.hip[0], K.hip[1] + 3, ax, ay, K.leg[0], K.leg[1], false);
    tag("pattes", c(K.hip[0], K.hip[1] + 3, nx, ny, 3 * w, 2.5 * w, B, z, 3), c(nx, ny, ax, ay, 2.5 * w, 1.8 * w, B, z, 2), c(ax, ay, fx + 7, -3, 1.8 * w, 1.2 * w, B, z, 2));
  }
  return P;
}

export function pteranodonSkeleton(pose: Pose): Prim[] {
  void pose;
  const [x0, y0] = P_KIT.neck1, B = M.Bone;
  // Crâne : boîte crânienne, longue crête, bec sans dents percé d'une grande fenêtre.
  const skull = [
    e(x0 + 4, y0 - 1, 8, 5.5, B, 12, 7),
    c(x0 + 2, y0 - 4, x0 - 40, y0 - 19, 4, 1.2, B, 14, 3),
    c(x0 + 6, y0 - 3, x0 + 64, y0 + 2, 5, 0.7, B, 12, 5),
    c(x0 + 6, y0 + 3, x0 + 60, y0 + 3, 3, 0.7, B, 12, 4),
    e(x0 + 5, y0 - 3, 2.6, 2.6, M.Socket, 30, 1),
    e(x0 + 18, y0 - 1, 8, 2, M.Socket, 30, 1),
  ];
  return pteroSkeleton(P_KIT, skull, { sternum: "sternum", bassin: "bassin" }).map((p) => scalePrim(p, PTERANODON_SCALE));
}

export const PTERANODON: Species = {
  id: "pteranodon",
  name: "Pteranodon",
  latin: "Pteranodon longiceps",
  period: "Crétacé supérieur, 86-84 Ma",
  place: "Formation de Niobrara, Kansas (États-Unis)",
  lengthM: SPAN_M,
  massKg: 35,
  facts: [
    { id: "nom", title: "Une aile sans dents", unlock: "discover",
      text: "Pteranodon veut dire « aile sans dents ». Son long bec pointu ne portait aucune dent, comme celui d'un oiseau. Avec 6 à 7 mètres d'envergure, il était plus large qu'une voiture est longue !" },
    { id: "cousin", title: "Pas un dinosaure !", unlock: "assemble",
      text: "Pteranodon est un ptérosaure, un reptile volant cousin des dinosaures, mais pas un dinosaure. Son aile est une peau tendue entre son corps et un seul doigt immense, le quatrième." },
    { id: "pecheur", title: "Un pêcheur au long bec", unlock: "eat",
      text: "Il mangeait du poisson : on a retrouvé des arêtes et des écailles de poissons fossilisées avec des squelettes de Pteranodon, là où se trouvait son estomac." },
    { id: "mer", title: "Pêcheur du grand large", unlock: "attack",
      text: "Il planait au-dessus d'une mer qui coupait alors l'Amérique du Nord en deux, loin des côtes, et frôlait les vagues pour happer les poissons d'un coup de bec, comme les sternes d'aujourd'hui." },
    { id: "crete", title: "Une crête pour se montrer", unlock: "rest",
      text: "Les mâles avaient une très grande crête pointée vers l'arrière, les femelles une petite. Elle servait sans doute à se faire remarquer, comme la queue d'un paon." },
    { id: "envol", title: "Un décollage en saut", unlock: "defend",
      text: "Pour s'envoler, il s'accroupissait puis bondissait en poussant sur ses bras puissants, comme un sauteur à la perche, et ouvrait ses ailes en plein élan." },
    { id: "oeufs", title: "Des œufs tout mous", unlock: "nest",
      text: "Les œufs de ptérosaures avaient une coquille souple et parcheminée, comme ceux de certains lézards et serpents, et non une coquille dure comme ceux des oiseaux." },
    { id: "flapling", title: "Voler tout petit", unlock: "baby",
      text: "Les bébés ptérosaures, surnommés « flaplings », naissaient avec des ailes déjà bien formées : ils pouvaient sans doute voler très jeunes, presque seuls." },
  ],
  bones: [
    { id: "crane", name: "Crâne et crête" },
    { id: "cou", name: "Vertèbres du cou" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "sternum", name: "Sternum (bréchet)" },
    { id: "bassin", name: "Bassin" },
    { id: "ailes", name: "Bras et métacarpes" },
    { id: "doigt", name: "Doigt de l'aile" },
    { id: "pattes", name: "Pattes arrière" },
  ],
  model: pteranodonModel,
  skeleton: pteranodonSkeleton,
  center: { x: -2 * PTERANODON_SCALE, y: -54 * PTERANODON_SCALE },
  eye: { x: EYE[0] * PTERANODON_SCALE, y: EYE[1] * PTERANODON_SCALE },
  feet: [-14, 28].map((x) => x * PTERANODON_SCALE),
  halfLen: 52 * PTERANODON_SCALE,
  shadow: 0.9,
  walkSpeed: 30,
  runSpeed: 170,
  stride: 6,
  behavior: { diet: "carnivore", herd: [1, 3], browse: null, prey: [], defense: "flee", sight: 480, scavenger: false },
  habitat: "air",
};
