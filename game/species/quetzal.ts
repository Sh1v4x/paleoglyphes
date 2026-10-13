import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { MR } from "./marine.mat";
import { c, e, knee, lerp, rot, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Quetzalcoatlus modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le corps).
 * Au sol : quadrupède perché comme une girafe-cigogne, appuyé sur les poignets, ailes repliées.
 * En vol (« fly ») : vue de trois quarts, aile lointaine vers le haut, aile proche vers le bas ;
 * même origine, le corps est dessiné à FLY_Y au-dessus (le jeu ajoute l'altitude).
 * L'échelle se règle sur l'envergure : 2 x 165 px bruts = 10,5 m.
 */
const SPAN_M = 10.5;
export const QUETZAL_SCALE = (SPAN_M * PX_PER_M) / 330;

type Pt = [number, number];

/** Articulation d'un membre à deux segments ; `back` plie vers l'arrière (coude), sinon vers l'avant (genou). */
function joint(hx: number, hy: number, ax: number, ay: number, l1: number, l2: number, back: boolean): Pt {
  if (!back) return knee(hx, hy, ax, ay, l1, l2);
  const dx = ax - hx, dy = ay - hy;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const a = Math.atan2(dy, dx) + Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  return [hx + l1 * Math.cos(a), hy + l1 * Math.sin(a)];
}

/** Point à la fraction t (0..1) de la longueur d'une ligne brisée. */
function along(pts: Pt[], t: number): Pt {
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

/**
 * Membrane tendue entre deux bords (lignes brisées) : rayons de capsules qui relient les deux bords
 * à la même fraction de longueur, assez épais pour se recouvrir.
 */
function sheet(L: Pt[], T: Pt[], n: number, m: number, z: number): Prim[] {
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

/** Tête : boîte crânienne à crête, bec en poignard de ~2,7 m (sans dents). Pivot (x0, y0), bec vers +x. */
function head(x0: number, y0: number, jaw: number, closed: boolean, far = false): Prim[] {
  const S = far ? MR.QFar : MR.QSkin;
  const H: Prim[] = [
    e(x0 + 3, y0 - 1, 11, 8, S, 6, 8),
    c(x0 + 1, y0 - 5, x0 - 17, y0 - 17, 5, 1.5, MR.QCrest, 8, 4),
    c(x0 + 6, y0 - 3, x0 + 82, y0 + 1, 7, 0.8, MR.QBeak, 8, 6),
    e(x0 + 24, y0 - 3, 10, 2, MR.QFar, 13, 1),
  ];
  if (closed) H.push(c(x0 + 2, y0 - 3, x0 + 7, y0 - 3, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(x0 + 4, y0 - 3, 2.4, 2.4, M.Eye, 20, 1));
  // Gueule ouverte : intérieur sombre, bec inférieur abaissé.
  if (jaw > 0.08) H.push(e(x0 + 34, y0 + 4, 30, 3 + jaw * 9, MR.MMouth, 3, 2, y0 + 1));
  const J: Prim[] = [c(x0 + 6, y0 + 4, x0 + 78, y0 + 3, 4.5, 0.8, MR.QBeak, 7, 4)];
  if (jaw <= 0.08) J.push(c(x0 + 10, y0 + 2, x0 + 72, y0 + 2, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, x0 + 6, y0 + 3, jaw * 0.42));
  return H;
}

/** Réglages de pose au sol, déduits de l'action. */
interface QRig {
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
}

const HIP = { x: -24, y: -72 };
const SHO = { x: 20, y: -98 };
const NECK0 = { x: 26, y: -100 };
const NECK1 = { x: 50, y: -168 };
/** Inclinaison de la tête au repos (bec un peu vers le bas). */
const HEAD_A = 0.35;
const EYE = { x: NECK1.x + 4 * Math.cos(HEAD_A) + 3 * Math.sin(HEAD_A), y: NECK1.y + 4 * Math.sin(HEAD_A) - 3 * Math.cos(HEAD_A) };

function quetzalRig({ action, actionT: t, time }: Pose): QRig {
  const r: QRig = { dx: 0, dy: 0, pitch: 0, neck: 0, head: 0, jaw: 0, legs: "stand", stride: 1, closed: false };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.06, neck: 0.4, head: -0.12, stride: 1.5 });
      break;
    case "eat": {
      // Cigogne géante : coups de bec répétés au ras du sol, bec entrouvert juste avant chaque coup.
      const st = Math.abs(Math.sin(t * Math.PI * 3));
      Object.assign(r, { pitch: 0.14, dy: 6, neck: 1.0 + st * 0.18, head: 0.42 + st * 0.12, jaw: (1 - st) * 0.35 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.16, dy: 8, neck: 1.12 + s * 0.02, head: 0.5, jaw: 0.05 });
      break;
    case "rest": {
      const br = Math.sin(time * 1.4) * 0.03;
      Object.assign(r, { legs: "sit", dy: 42, pitch: -0.04, neck: 0.55 + br, head: 0.12, closed: true });
      break;
    }
    case "call": {
      const k = Math.sin(Math.min(1, t * 1.3) * Math.PI);
      Object.assign(r, { pitch: -0.05, neck: -0.2 * k - 0.05, head: -0.85 * k, jaw: (0.55 + 0.25 * Math.abs(s)) * k });
      break;
    }
    case "defend":
      // Se dresse sur les pattes arrière, ailes à demi ouvertes, bec béant.
      Object.assign(r, { legs: "rear", pitch: -0.16, dy: -4, neck: 0.18 + s * 0.04, head: 0.1, jaw: 0.6 + 0.2 * s });
      break;
    case "attack": {
      // Recule le cou (0-0.35), harponne vers l'avant et le bas (0.35-0.6), puis se redresse.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.5));
      const lunge = win(t, 0.35, 0.55) * (1 - win(t, 0.7, 1));
      Object.assign(r, {
        dx: lunge * 14, pitch: 0.14 * lunge - 0.04 * wind,
        neck: -0.4 * wind + 0.95 * lunge, head: -0.1 * wind + 0.35 * lunge,
        jaw: Math.max(wind, lunge) * 0.7 * (1 - win(t, 0.5, 0.58)),
      });
      break;
    }
    default:
      break;
  }
  return r;
}

/** Point (x, y) tourné de a autour de (px, py), puis décalé. */
function rp(x: number, y: number, px: number, py: number, a: number, dx: number, dy: number): Pt {
  const co = Math.cos(a), si = Math.sin(a);
  return [px + (x - px) * co - (y - py) * si + dx, py + (x - px) * si + (y - py) * co + dy];
}

function quetzalGround(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = quetzalRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 2.4) * (1 - moving);
  const bob = -Math.abs(Math.sin(walk)) * 3 * moving * r.stride + breath * 1.2;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];
  const [shx, shy] = rp(SHO.x, SHO.y, HIP.x, HIP.y, r.pitch, bx, by);
  const hipx = HIP.x + bx, hipy = HIP.y + by;

  // --- Membres : avant (bras + aile repliée), arrière ; diagonales opposées en phase ---
  for (const L of [{ ph: 0, far: true }, { ph: Math.PI, far: false }]) {
    const m = L.far ? MR.QFar : MR.QSkin;
    const wm = L.far ? MR.QWingFar : MR.QWing;
    const z = L.far ? -40 : 30;
    const off = L.far ? -5 : 0;
    // Bras : épaule → coude (vers l'arrière) → poignet → long métacarpe vertical → main au sol.
    const ph = walk + L.ph + Math.PI;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 9 * r.stride;
    let hx = shx + 12 + off + sw * 18, hy = -4 - lift;
    let wx = hx - 2, wy = hy - 40;
    let tipx = shx - 22 + off, tipy = shy - 34;
    if (r.legs === "sit") { hx = shx + 26 + off; hy = -4; wx = hx - 12; wy = -16; tipx = shx - 40 + off; tipy = shy - 18; }
    else if (r.legs === "rear") {
      // Bras levés : la main ne touche plus le sol, le doigt de l'aile se déploie vers le haut et l'arrière.
      wx = shx + 30 + off; wy = shy - 18 + Math.sin(time * 3) * 3; hx = wx + 10; hy = wy + 34;
      tipx = shx - 70 + off * 3; tipy = shy - 120 - (L.far ? 10 : 0);
    }
    const [ex, ey] = joint(shx, shy, wx, wy, 24, 42, true);
    const kx = hx, ky = hy - 4;
    // Membrane : bande repliée le long du bras (au sol), grande voile tendue vers la hanche (défense).
    if (r.legs === "rear") P.push(...sheet([[kx, ky], [tipx, tipy]], [[wx, wy], [ex, ey], [hipx - 6, hipy + 6]], 10, wm, z - 4));
    else P.push(c(kx - 3, ky - 6, tipx - 3, tipy + 6, 4, 2.5, wm, z - 2, 3));
    P.push(c(kx, ky, tipx, tipy, 3, 1, m, z + 2, 3));
    P.push(c(shx, shy, ex, ey, 9, 6, m, z, 8));
    P.push(c(ex, ey, wx, wy, 6, 4, m, z + 2, 6));
    P.push(c(wx, wy, hx, hy, 4, 3, m, z + 4, 4));
    P.push(e(wx, wy, 5, 4, m, z + 4, 4));
    for (const t of [-2, 2]) P.push(c(hx, hy + 1, hx + 5, hy + 3 + t * 0.5, 1, 1, MR.QClaw, z + 10, 1, true));

    // Patte arrière : hanche → genou (vers l'avant) → cheville → pied plantigrade.
    const ph2 = walk + L.ph;
    const sw2 = Math.sin(ph2) * moving * r.stride;
    const lift2 = Math.max(0, Math.cos(ph2)) * moving * 8 * r.stride;
    let fx = HIP.x + 6 + off + sw2 * 16 + bx, fy = -3 - lift2;
    if (r.legs === "sit") { fx = hipx + 22 + off; fy = -3; }
    else if (r.legs === "rear") fx = hipx + 14 + off;
    const ax = fx - 8, ay = fy - 10;
    const [nx, ny] = joint(hipx, hipy + 4, ax, ay, 32, 34, false);
    P.push(e(hipx + 2, hipy + 6, 12, 14, m, z - 6, 10));
    P.push(c(hipx, hipy + 6, nx, ny, 8, 5, m, z, 7));
    P.push(c(nx, ny, ax, ay, 5, 3, m, z + 2, 5));
    P.push(c(ax, ay, fx + 6, fy, 3.5, 2.5, m, z + 4, 3));
    P.push(c(fx + 4, fy + 1, fx + 11, fy + 2, 1, 1, MR.QClaw, z + 10, 1, true));
  }

  // --- Corps, cou et tête : au repos, puis tournés autour de la hanche ---
  const B: Prim[] = [];
  B.push(c(-36, -70, 16, -94, 15, 19, MR.QSkin, 0, 16));
  B.push(e(-6, -72, 26, 9, MR.QBelly, 6, 9, -76));
  B.push(c(-38, -70, -50, -66, 4, 1.5, MR.QSkin, 2, 3));
  // Pycnofibres : duvet en touffes sur le dos.
  for (let k = 0; k < 6; k++) B.push(e(-32 + k * 9, -84 - k * 4.2, 4, 2.4, MR.QFuzz, 14 + k, 3));
  // Cou long et raide (vertèbres allongées), presque vertical au repos.
  const N: Prim[] = [
    c(NECK0.x, NECK0.y, NECK1.x, NECK1.y, 10, 6, MR.QSkin, 4, 8),
    c(NECK0.x + 5, NECK0.y + 2, NECK1.x + 4, NECK1.y + 4, 3, 2, MR.QBelly, 10, 2),
  ];
  for (let k = 0; k < 4; k++) N.push(e(lerp(NECK0.x, NECK1.x, 0.15 + k * 0.22) - 7, lerp(NECK0.y, NECK1.y, 0.15 + k * 0.22), 2.5, 3, MR.QFuzz, 12, 2));
  N.push(...rot(head(NECK1.x, NECK1.y, r.jaw, r.closed), NECK1.x, NECK1.y, HEAD_A + r.head));
  B.push(...rot(N, NECK0.x, NECK0.y, r.neck));
  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P;
}

/** Mort : couché sur le flanc, aile proche étalée au sol, cou et bec allongés. */
function quetzalDead(): Prim[] {
  const P: Prim[] = [];
  // Aile étalée : bras, doigt immense, membrane jusqu'à la cheville.
  const sh: Pt = [14, -24], el: Pt = [-6, -44], wr: Pt = [-34, -40], kn: Pt = [-60, -46], tip: Pt = [-170, -14];
  P.push(...sheet([sh, el, wr, kn, tip], [[-28, -12], [-110, -8], tip], 14, MR.QWing, 4));
  for (const [a, b, ra, rb] of [[sh, el, 7, 5], [el, wr, 5, 4], [wr, kn, 4, 3], [kn, tip, 3, 1]] as const) {
    P.push(c(a[0], a[1], b[0], b[1], ra, rb, MR.QSkin, 10, 4));
  }
  for (const t of [0.4, 0.6, 0.8]) {
    const a = along([sh, el, wr, kn, tip], t), b = along([[-28, -12], [-110, -8], tip], t);
    P.push(c(a[0], a[1], b[0], b[1], 1, 1, MR.QVein, 8, 1, true));
  }
  // Corps, pattes molles, cou et tête posés au sol.
  P.push(e(-4, -16, 32, 14, MR.QSkin, 6, 12));
  P.push(e(-2, -8, 24, 5, MR.QBelly, 12, 4, -9));
  P.push(c(-26, -10, -54, -4, 6, 3, MR.QSkin, 10, 4), c(-54, -4, -66, -3, 3, 2, MR.QSkin, 10, 3));
  P.push(c(-20, -12, -44, -16, 5, 3, MR.QFar, -6, 4));
  P.push(c(24, -16, 92, -10, 9, 6, MR.QSkin, 8, 7));
  P.push(...head(96, -12, 0.12, true));
  return P;
}

/**
 * Vol : l'envergure est projetée en trois quarts (profondeur → écran : un peu à gauche, vers le bas).
 * `walk` = phase des battements, `moving` 0 = plané (ailes à plat, léger dièdre).
 */
const FLY_Y = -170;
const KX = -0.3, KY = 0.62;

function quetzalFly({ walk, moving, time }: Pose): Prim[] {
  const flap = Math.sin(walk);
  const theta = lerp(0.08 + Math.sin(time * 1.3) * 0.03, 0.48 * flap, moving);
  // Remontée : l'aile se replie un peu au poignet pour moins freiner.
  const fold = moving * Math.max(0, Math.cos(walk)) * 0.3;
  const by = FLY_Y + flap * 5 * moving;
  const P: Prim[] = [];

  const wing = (s: number) => {
    const far = s < 0;
    const pj = (x: number, d: number): Pt => {
      const up = (d - 8) * Math.sin(theta), dp = 8 + (d - 8) * Math.cos(theta);
      return [x + s * dp * KX, by - up + s * dp * KY];
    };
    // Bord d'attaque : épaule, coude, poignet, articulation du doigt, bout du 4e doigt.
    const L = [pj(16, 8), pj(2, 30), pj(18, 62), pj(10, 94), pj(-40 - fold * 50, 165 - fold * 55)];
    const ank = pj(-58, 10);
    const tip = L[4];
    const mid = along([ank, tip], 0.55), lm = along(L, 0.6);
    const T: Pt[] = [ank, [lerp(mid[0], lm[0], 0.38), lerp(mid[1], lm[1], 0.38)], tip];
    const z = far ? -40 : 40;
    const m = far ? MR.QFar : MR.QSkin;
    P.push(...sheet(L, T, 14, far ? MR.QWingFar : MR.QWing, z));
    // Propatagium : petite voile devant le bras, de l'épaule au poignet.
    P.push(c(L[0][0] + 6, L[0][1] - 2, L[2][0] + 3, L[2][1] - 2, 3, 2, far ? MR.QWingFar : MR.QWing, z, 2));
    const rad = [[7, 5], [5, 4], [4, 3], [3, 1]];
    for (let k = 0; k < 4; k++) P.push(c(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], rad[k][0], rad[k][1], m, z + 4, 4));
    // Actinofibrilles : fibres qui raidissent la membrane.
    if (!far) for (const t of [0.45, 0.65, 0.85]) {
      const a = along(L, t), b = along(T, t);
      P.push(c(a[0], a[1], b[0], b[1], 1, 1, MR.QVein, z + 3, 1, true));
    }
  };
  wing(-1);

  // Corps velu, pattes repliées vers l'arrière.
  P.push(c(-34, by + 2, 18, by - 6, 13, 16, MR.QSkin, 0, 14));
  P.push(e(-8, by + 7, 24, 6, MR.QBelly, 4, 6, by + 4));
  for (let k = 0; k < 6; k++) P.push(e(-28 + k * 9, by - 12 - k * 0.8, 4, 2.2, MR.QFuzz, 13, 2));
  for (const far of [true, false]) {
    const m = far ? MR.QFar : MR.QSkin, z = far ? -12 : 12, o = far ? -3 : 3;
    P.push(c(-24, by + 4 + o, -44, by + 9 + o, 6, 4, m, z, 5));
    P.push(c(-44, by + 9 + o, -60, by + 10 + o, 3.5, 2.5, m, z, 3));
    P.push(c(-60, by + 10 + o, -70, by + 8 + o, 1, 1, MR.QClaw, z + 4, 1, true));
  }
  // Cou tendu vers l'avant, tête immense légèrement inclinée.
  P.push(c(16, by - 6, 96, by - 20, 8, 5.5, MR.QSkin, 4, 7));
  for (let k = 0; k < 4; k++) P.push(e(26 + k * 18, by - 13 - k * 3.4, 3, 2, MR.QFuzz, 11, 2));
  P.push(...rot(head(96, by - 20, 0, false), 96, by - 20, 0.12));
  wing(1);
  return P;
}

export function quetzalModel(pose: Pose): Prim[] {
  const P = pose.action === "fly" ? quetzalFly(pose) : pose.action === "dead" ? quetzalDead() : quetzalGround(pose);
  return P.map((p) => scalePrim(p, QUETZAL_SCALE));
}

/** Squelette (format : voir ankyloSkeleton). Debout, ailes repliées, regard à droite. */
export function quetzalSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : boîte crânienne, crête, bec immense creusé d'une grande fenêtre (os très légers).
  tag("crane", ...rot([
    e(NECK1.x + 3, NECK1.y - 1, 9, 6.5, B, 12, 8),
    c(NECK1.x + 1, NECK1.y - 5, NECK1.x - 16, NECK1.y - 16, 3.5, 1, B, 14, 3),
    c(NECK1.x + 6, NECK1.y - 3, NECK1.x + 82, NECK1.y + 1, 6, 0.8, B, 12, 5),
    c(NECK1.x + 6, NECK1.y + 4, NECK1.x + 78, NECK1.y + 3, 3.5, 0.8, B, 12, 4),
    e(NECK1.x + 4, NECK1.y - 3, 3, 3, M.Socket, 30, 1),
    e(NECK1.x + 22, NECK1.y - 2, 11, 2.5, M.Socket, 30, 1),
  ], NECK1.x, NECK1.y, HEAD_A));
  // Cou : 7 vertèbres cervicales très allongées.
  for (let k = 0; k < 7; k++) {
    const t0 = k / 7 + 0.015, t1 = (k + 1) / 7 - 0.015;
    tag("cou", c(lerp(NECK0.x, NECK1.x, t0), lerp(NECK0.y, NECK1.y, t0), lerp(NECK0.x, NECK1.x, t1), lerp(NECK0.y, NECK1.y, t1), 3.5, 3, B, 10, 3));
  }
  // Dos (notarium soudé) et minuscule queue.
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tag("vertebres", e(lerp(NECK0.x - 4, HIP.x, t), lerp(NECK0.y + 2, HIP.y - 4, t), 4, 3.5, B, 10, 3));
  }
  for (let k = 1; k <= 3; k++) tag("vertebres", e(HIP.x - 6 - k * 6, HIP.y + k, 2.5 - k * 0.4, 2, B, 10, 2));
  // Sternum en bouclier, avec son bréchet où s'ancraient les muscles du vol.
  tag("sternum", e(12, -80, 13, 6, B, 12, 5), c(18, -76, 32, -86, 2.5, 1.5, B, 14, 2));
  for (let k = 0; k < 4; k++) tag("sternum", c(4 - k * 8, -94 + k * 4, 6 - k * 6, -78, 1, 1, B, 8, 1, true));
  // Bassin.
  tag("bassin", e(HIP.x, HIP.y - 2, 14, 6, B, 12, 5), c(HIP.x + 4, HIP.y + 2, HIP.x + 10, HIP.y + 12, 2.5, 2, B, 12, 2));
  // Bras : humérus à grande crête, avant-bras, ptéroïde, très long métacarpe, petits doigts griffus.
  for (const [o, z] of [[-5, 4], [0, 18]] as const) {
    const hx = SHO.x + 12 + o, wx = hx - 2, wy = -44;
    const [ex, ey] = joint(SHO.x, SHO.y, wx, wy, 24, 42, true);
    tag("ailes",
      c(SHO.x, SHO.y, ex, ey, 4, 3.5, B, z, 3), e(lerp(SHO.x, ex, 0.35) + 4, lerp(SHO.y, ey, 0.35), 4, 3, B, z, 3),
      c(ex, ey, wx, wy, 3, 2.5, B, z, 3), c(wx, wy, wx + 8, wy - 10, 1, 1, B, z + 2, 1, true),
      c(wx, wy, hx, -6, 2.5, 2, B, z, 2), c(hx, -5, hx + 5, -2, 1, 1, B, z + 2, 1, true));
    // Doigt de l'aile replié : quatre phalanges qui remontent au-dessus de l'épaule.
    const kn: Pt = [hx, -8], tp: Pt = [SHO.x - 22 + o, SHO.y - 34];
    for (let k = 0; k < 4; k++) {
      const a = along([kn, tp], k / 4 + 0.01), b = along([kn, tp], (k + 1) / 4 - 0.01);
      tag("doigt", c(a[0], a[1], b[0], b[1], 2.6 - k * 0.5, 2.2 - k * 0.5, B, z + 1, 2));
    }
  }
  // Pattes arrière : fémur, tibia, pied à quatre orteils.
  for (const [o, z] of [[-5, 4], [0, 18]] as const) {
    const fx = HIP.x + 6 + o, ax = fx - 8, ay = -13;
    const [nx, ny] = joint(HIP.x, HIP.y + 4, ax, ay, 32, 34, false);
    tag("pattes", c(HIP.x, HIP.y + 4, nx, ny, 3.5, 3, B, z, 3), c(nx, ny, ax, ay, 3, 2, B, z, 2), c(ax, ay, fx + 8, -3, 2, 1.5, B, z, 2));
  }
  return P.map((p) => scalePrim(p, QUETZAL_SCALE));
}

export const QUETZAL: Species = {
  id: "quetzal",
  name: "Quetzalcoatlus",
  latin: "Quetzalcoatlus northropi",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Javelina, Texas (États-Unis)",
  lengthM: SPAN_M,
  massKg: 230,
  facts: [
    { id: "geant", title: "Le plus grand animal volant", unlock: "discover",
      text: "Avec 10 à 11 mètres d'envergure, Quetzalcoatlus est le plus grand animal qui ait jamais volé : ses ailes ouvertes sont aussi larges qu'un bus est long !" },
    { id: "cousin", title: "Pas un dinosaure !", unlock: "assemble",
      text: "C'est un ptérosaure, un reptile volant. Les ptérosaures sont de proches cousins des dinosaures, mais pas des dinosaures. Son aile est tendue par un seul doigt, le quatrième, immense." },
    { id: "plume", title: "Léger comme une plume (presque)", unlock: "rest",
      text: "Ses os étaient creux, avec des parois aussi fines qu'une carte bancaire, renforcées à l'intérieur comme des poutres. Résultat : environ 200 à 250 kg pour un animal de la taille d'une girafe." },
    { id: "cigogne", title: "Une cigogne géante", unlock: "eat",
      text: "Il chassait sans doute à pied, comme une cigogne : il arpentait les plaines et attrapait petits animaux, bébés dinosaures et lézards d'un coup de son bec de près de 3 mètres." },
    { id: "girafe", title: "Haut comme une girafe", unlock: "call",
      text: "Debout sur ses quatre membres, le cou dressé, il mesurait environ 5 mètres de haut : il aurait pu regarder une girafe droit dans les yeux." },
    { id: "envol", title: "Un décollage en saut", unlock: "attack",
      text: "Pour s'envoler, il s'accroupissait puis se propulsait avec ses bras puissants, comme un sauteur à la perche, avant d'ouvrir ses ailes en plein élan." },
    { id: "nom", title: "Le serpent à plumes", unlock: "defend",
      text: "Son nom vient de Quetzalcoatl, le dieu serpent à plumes des Aztèques. Ses fossiles ont été découverts au Texas en 1971." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "cou", name: "Vertèbres du cou" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "sternum", name: "Sternum (bréchet)" },
    { id: "bassin", name: "Bassin" },
    { id: "ailes", name: "Bras et métacarpes" },
    { id: "doigt", name: "Doigt de l'aile" },
    { id: "pattes", name: "Pattes arrière" },
  ],
  model: quetzalModel,
  skeleton: quetzalSkeleton,
  center: { x: -4 * QUETZAL_SCALE, y: -84 * QUETZAL_SCALE },
  eye: { x: EYE.x * QUETZAL_SCALE, y: EYE.y * QUETZAL_SCALE },
  feet: [-18, 32].map((x) => x * QUETZAL_SCALE),
  halfLen: 60 * QUETZAL_SCALE,
  shadow: 0.9,
  walkSpeed: 35,
  runSpeed: 180,
  stride: 6,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: [], defense: "flee", sight: 500, scavenger: false },
  habitat: "air",
};
