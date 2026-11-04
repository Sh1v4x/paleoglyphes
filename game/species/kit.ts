import { lerp, smooth01, smoothstep } from "../math";
import type { Prim } from "../render/raster";
import type { Pose } from "./types";

/**
 * Outils de modélisation partagés par les espèces et le décor (px bruts, regard vers la droite,
 * y vers le bas) : primitives, transformations, cinématique des membres et gabarits de pattes.
 */

export type Pt = [number, number];

export const e = (x: number, y: number, rx: number, ry: number, m: number, z: number, h: number, yMin?: number, yMax?: number): Prim =>
  ({ k: "e", x, y, rx, ry, m, z, h, yMin, yMax });
export const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: number, z: number, h: number, stroke = false): Prim =>
  ({ k: "c", ax, ay, bx, by, ra, rb, m, z, h, stroke });

/** Fenêtre lissée : 0 avant a, 1 après b. */
export const win = (t: number, a: number, b: number) => smoothstep(a, b, t);

/**
 * Déroulé d'un coup (0..1) : armé (0-0.35), frappe (0.35-0.6), retour (0.6-1).
 * Renvoie l'élan (-1 armé .. 1 frappé) et l'instant de l'impact (0..1, max au milieu de la frappe).
 */
export function strike(t: number): { s: number; hit: number } {
  if (t < 0.35) return { s: -smooth01(t / 0.35), hit: 0 };
  if (t < 0.6) { const u = (t - 0.35) / 0.25; return { s: -1 + 2 * smooth01(u), hit: Math.sin(u * Math.PI) }; }
  return { s: 1 - smooth01((t - 0.6) / 0.4), hit: 0 };
}

/** Point (x, y) tourné de a autour de (px, py), puis décalé. */
export function rp(x: number, y: number, px: number, py: number, a: number, dx = 0, dy = 0): Pt {
  const co = Math.cos(a), si = Math.sin(a);
  return [px + (x - px) * co - (y - py) * si + dx, py + (x - px) * si + (y - py) * co + dy];
}

/**
 * Tourne (a rad, + = sens horaire à l'écran, donc museau vers le bas) autour de (px, py), puis décale.
 * Les ellipses ne tournent pas, seul leur centre bouge.
 */
export function rot(ps: Prim[], px: number, py: number, a: number, dx = 0, dy = 0): Prim[] {
  const R = (x: number, y: number): Pt => rp(x, y, px, py, a, dx, dy);
  return ps.map((p) => {
    if (p.k === "c") {
      const [ax, ay] = R(p.ax, p.ay), [bx, by] = R(p.bx, p.by);
      return { ...p, ax, ay, bx, by };
    }
    const [x, y] = R(p.x, p.y);
    if (p.k === "cut") return { ...p, x, y };
    const sh = y - p.y;
    return { ...p, x, y, yMin: p.yMin === undefined ? undefined : p.yMin + sh, yMax: p.yMax === undefined ? undefined : p.yMax + sh };
  });
}

/** Aplatit verticalement vers le sol (y = 0) : animal couché sur le flanc. */
export function squash(ps: Prim[], sy: number, dy = 0): Prim[] {
  const r = Math.sqrt(sy);
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: p.ay * sy + dy, by: p.by * sy + dy, ra: p.ra * r, rb: p.rb * r };
    if (p.k === "cut") return { ...p, y: p.y * sy + dy, ry: p.ry * sy };
    return { ...p, y: p.y * sy + dy, ry: p.ry * sy,
      yMin: p.yMin === undefined ? undefined : p.yMin * sy + dy, yMax: p.yMax === undefined ? undefined : p.yMax * sy + dy };
  });
}

/** Miroir vertical autour de y = cy, puis décalage : animal marin sur le dos. */
export function flipY(ps: Prim[], cy: number, dy = 0): Prim[] {
  const f = (y: number) => 2 * cy - y + dy;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: f(p.ay), by: f(p.by) };
    if (p.k === "cut") return { ...p, y: f(p.y) };
    return { ...p, y: f(p.y), yMin: p.yMax === undefined ? undefined : f(p.yMax), yMax: p.yMin === undefined ? undefined : f(p.yMin) };
  });
}

/** Cinématique inverse à deux segments, genou vers l'avant (+x) : position du genou. */
export function knee(hx: number, hy: number, ax: number, ay: number, l1: number, l2: number): Pt {
  return joint(hx, hy, ax, ay, l1, l2, false);
}

/** Articulation d'un membre à deux segments ; `back` plie vers l'arrière (coude), sinon vers l'avant (genou). */
export function joint(hx: number, hy: number, ax: number, ay: number, l1: number, l2: number, back: boolean): Pt {
  const dx = ax - hx, dy = ay - hy;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const b = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const a = Math.atan2(dy, dx) + (back ? b : -b);
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

/** Réglages de pose d'un théropode, déduits de l'action. */
export interface TheroRig {
  /** Décalage du bassin (px bruts, + = vers le bas). */
  dx: number;
  dy: number;
  /** Tangage du corps autour du bassin (+ = museau vers le bas). */
  pitch: number;
  /** Rotation du cou autour de sa base, puis de la tête autour de la nuque. */
  neck: number;
  head: number;
  /** Ouverture de la mâchoire 0..1. */
  jaw: number;
  /** Bras : 0 repliés, 1 déployés (ailes ouvertes chez le raptor). */
  arms: number;
  /** Plumes de la nuque hérissées 0..1. */
  crest: number;
  /** Lève (px) le bout de la queue ; enroule la queue vers l'avant (0..1). */
  tailUp: number;
  curl: number;
  /** Amplitude de foulée. */
  stride: number;
  /** Pattes : debout, accroupi (repos), en l'air (bond), allongé (mort). */
  legs: "stand" | "sit" | "air" | "lie";
  /** Écart des pieds (posture campée), px bruts : pied proche en avant, lointain en arrière. */
  stance: number;
  closed: boolean;
}

export const REST_RIG: TheroRig = {
  dx: 0, dy: 0, pitch: 0, neck: 0, head: 0, jaw: 0, arms: 0, crest: 0, tailUp: 0, curl: 0,
  stride: 1, legs: "stand", stance: 0, closed: false,
};

/** Pied hors de la marche : avancée depuis la hanche (patte lointaine décalée de `far`), hauteur, métatarse. */
interface FootPose { dx: number; far: number; y: number; mx: number; my: number }

/** Gabarit d'une patte de théropode (px bruts). */
export interface TheroLegSpec {
  /** Bassin au repos. */
  hip: { x: number; y: number };
  /** Recul de la hanche lointaine. */
  farHip: number;
  /** Lever du pied à la foulée. */
  lift: number;
  /** Avancée du pied sous la hanche, amplitude de la foulée, hauteur du pied posé. */
  reach: number;
  swing: number;
  footY: number;
  /** Métatarse en marche : vecteur de la cheville vers les orteils, raccourci de `metaLift` x lever. */
  mx: number;
  my: number;
  metaLift: number;
  /** Pieds écartés en permanence : écart fixe ajouté, puis facteur sur l'écart total. */
  splay?: { add: number; k: number };
  sit: FootPose;
  /** Allongé : le pied proche est plus bas de `nearDy`. */
  lie: FootPose & { nearDy: number };
  /** Bond (pattes en l'air) : `y` est relatif à la hanche, le pied proche avancé de `near`. */
  air?: FootPose & { near: number };
  /** Hanche → genou : décalage vertical de l'attache, longueurs de la cuisse et de la jambe. */
  kneeDy: number;
  thigh: number;
  shin: number;
}

export interface TheroLeg {
  far: boolean;
  lift: number;
  hx: number;
  hy: number;
  fx: number;
  fy: number;
  ax: number;
  ay: number;
  kx: number;
  ky: number;
}

/**
 * Les deux pattes d'un théropode (lointaine d'abord) : la patte suit le bassin décalé de (bx, by),
 * pied posé selon la pose ; `adjust` retouche le pied avant le calcul du genou (coup de patte).
 */
export function theroLegs(pose: Pose, r: TheroRig, bx: number, by: number, S: TheroLegSpec,
  adjust?: (foot: { fx: number; fy: number; mx: number; my: number }, far: boolean, hx: number, hy: number) => void): TheroLeg[] {
  const { walk, moving } = pose;
  return [{ phase: 0, far: true }, { phase: Math.PI, far: false }].map((L) => {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * S.lift * r.stride;
    const hx = S.hip.x + (L.far ? S.farHip : 0) + bx, hy = S.hip.y + by;
    const spread = S.splay ? (L.far ? -S.splay.add - r.stance : S.splay.add + r.stance) * S.splay.k : L.far ? -r.stance : r.stance;
    const f = { fx: hx + S.reach + sw * S.swing + spread, fy: S.footY - lift, mx: S.mx, my: S.my - lift * S.metaLift };
    const set = (P: FootPose, fx: number, fy: number) => { f.fx = fx; f.fy = fy; f.mx = P.mx; f.my = P.my; };
    if (r.legs === "sit") set(S.sit, hx + S.sit.dx + (L.far ? S.sit.far : 0), S.sit.y);
    else if (r.legs === "air" && S.air) set(S.air, hx + S.air.dx + (L.far ? S.air.far : S.air.near), hy + S.air.y);
    else if (r.legs === "lie") set(S.lie, hx + S.lie.dx + (L.far ? S.lie.far : 0), S.lie.y - (L.far ? 0 : S.lie.nearDy));
    else adjust?.(f, L.far, hx, hy);
    const ax = f.fx - f.mx, ay = f.fy - f.my;
    const [kx, ky] = knee(hx, hy + S.kneeDy, ax, ay, S.thigh, S.shin);
    return { far: L.far, lift, hx, hy, fx: f.fx, fy: f.fy, ax, ay, kx, ky };
  });
}

export interface QuadLook {
  bob: number;
  drop: number;
  /** Avancée du corps (charge, poussée). */
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

/** Allure de base : balancement de marche, respiration (plus lente au repos), ondulation de la queue. */
export function quadLook({ walk, moving, time, action }: Pose, o: { breathPeriod: number; runHead: number; swayFreq: number; swayAmp: number }): QuadLook {
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3.4 : o.breathPeriod)) * (1 - moving) * (rest ? 1.8 : 1);
  return {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp * amp + breath * 1.3, drop: 0, dx: 0,
    legs: "walk", amp, spread: 0, headA: run ? o.runHead : 0, headDy: 0, mouth: 0,
    sway: Math.sin(time * o.swayFreq) * 3 * (1 - moving) + Math.sin(walk) * o.swayAmp * moving * amp, eye: true,
  };
}

/** Gabarit des pattes en piliers : hanches (arrière lointaine, avant lointaine, arrière proche, avant proche), px bruts. */
export interface PillarLegSpec {
  hips: [number, number, number, number];
  far: number;
  skin: number;
  nail: number;
  swing: number;
  lift: number;
  /** Hauteur de l'épaule et de la hanche. */
  frontY: number;
  backY: number;
  /** Rayons de l'épaule et de la cuisse, épaisseur commune. */
  shoulder: Pt;
  thigh: Pt;
  thighH: number;
  /** Rayon haut du bras (avant, arrière), rayon bas, épaisseur. */
  upper: Pt;
  upperB: number;
  upperH: number;
  /** Colonne jusqu'au pied : rayons et épaisseur. */
  lower: [number, number, number];
  foot: Pt;
  /** Ongles en sabot : avancée et rayons. */
  nailDx: number;
  nailR: Pt;
  /** Pattes repliées (repos) : avancée du pied avant, rayon du pied, avancée des ongles. */
  tuckDx: number;
  tuckR: number;
  tuckNailDx: number;
}

/** Pattes en piliers, ongles en sabots ; `bob` = balancement plus affaissement du corps. */
export function pillarLegs(P: Prim[], L: QuadLook, walk: number, moving: number, bob: number, S: PillarLegSpec) {
  const X = L.dx;
  const legs = [
    { hip: S.hips[0], phase: 0, far: true, front: false },
    { hip: S.hips[1], phase: Math.PI, far: true, front: true },
    { hip: S.hips[2], phase: Math.PI, far: false, front: false },
    { hip: S.hips[3], phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? S.far : S.skin;
    const z = G.far ? -70 : 30;
    const hx = G.hip + X;
    if (L.legs === "tuck") {
      const fx = hx + (G.front ? S.tuckDx : -2);
      P.push(e(fx, -7, S.tuckR, 7, m, z, 7));
      for (const t of [-6, 1, 8]) P.push(e(fx + S.tuckNailDx + t * 0.4, -4, S.nailR[0], S.nailR[1], S.nail, z + 6, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * S.lift * L.amp;
    const fx = G.hip + s * S.swing + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : -L.spread * 0.3) + X * 0.2;
    const hy = (G.front ? S.frontY : S.backY) + bob;
    // Cuisse ou épaule, puis colonne jusqu'au pied (coude écarté à l'avant).
    const R = G.front ? S.shoulder : S.thigh;
    P.push(e(hx, hy, R[0], R[1], m, z - 6, S.thighH));
    const kx = (hx + fx) / 2 + (G.front ? 6 : -2), ky = (hy - 8 - lift) / 2;
    P.push(c(hx, hy + 6, kx, ky, G.front ? S.upper[0] : S.upper[1], S.upperB, m, z, S.upperH));
    P.push(c(kx, ky, fx, -9 - lift, S.lower[0], S.lower[1], m, z + 2, S.lower[2]));
    P.push(e(fx + 3, -7 - lift, S.foot[0], S.foot[1], m, z + 2, 8));
    for (const t of [-6, 1, 8]) P.push(e(fx + S.nailDx + t * 0.4, -4 - lift, S.nailR[0], S.nailR[1], S.nail, z + 8, 2));
  }
}

/** Queue en cinq capsules qui s'affinent ; `deco` ajoute les motifs de chaque segment. */
export function taperedTail(P: Prim[], L: QuadLook, bob: number,
  S: { x: number; len: number; y: number; droop: number; r: number; step: number; m: number; h: number },
  deco: (k: number, ax: number, ay: number, bx: number, by: number, ra: number) => void) {
  const X = L.dx;
  const tail: Pt[] = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    tail.push([S.x - t * S.len + X, S.y + bob * (1 - t) + L.drop * t + t * S.droop + L.sway * t * t]);
  }
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = S.r - k * S.step, rb = S.r - (k + 1) * S.step;
    P.push(c(ax, ay, bx, by, ra, Math.max(3, rb), S.m, 2, S.h));
    deco(k, ax, ay, bx, by, ra);
  }
}
