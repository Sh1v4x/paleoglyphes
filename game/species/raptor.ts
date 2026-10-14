import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { CM } from "./carnivores.mat";
import type { Pose, Species } from "./types";

/**
 * Raptor (Dakotaraptor, le grand dromaeosaure à plumes de Hell Creek) modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le bassin).
 * Bipède digitigrade : cuisse, jambe, métatarse, orteils et griffe en faucille relevée.
 * Les poses sont pilotées par un « gréement » (bassin, tangage, cou, tête, mâchoire, ailes…) par action.
 */
const LENGTH_M = 5;
/** Le modèle brut mesure ~255 px de la queue au museau. */
export const RAPTOR_SCALE = (LENGTH_M * PX_PER_M) / 255;

export const e = (x: number, y: number, rx: number, ry: number, m: number, z: number, h: number, yMin?: number, yMax?: number): Prim =>
  ({ k: "e", x, y, rx, ry, m, z, h, yMin, yMax });
export const c = (ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: number, z: number, h: number, stroke = false): Prim =>
  ({ k: "c", ax, ay, bx, by, ra, rb, m, z, h, stroke });

// --- Outils de pose, partagés avec le tyrannosaure ---
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Fenêtre lissée : 0 avant a, 1 après b. */
export const win = (t: number, a: number, b: number) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Tourne (a rad, + = sens horaire à l'écran, donc museau vers le bas) autour de (px, py), puis décale. */
export function rot(ps: Prim[], px: number, py: number, a: number, dx = 0, dy = 0): Prim[] {
  const co = Math.cos(a), si = Math.sin(a);
  const R = (x: number, y: number): [number, number] => [px + (x - px) * co - (y - py) * si + dx, py + (x - px) * si + (y - py) * co + dy];
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

/** Cinématique inverse à deux segments, genou vers l'avant (+x) : position du genou. */
export function knee(hx: number, hy: number, ax: number, ay: number, l1: number, l2: number): [number, number] {
  const dx = ax - hx, dy = ay - hy;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const a = Math.atan2(dy, dx);
  const b = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  return [hx + l1 * Math.cos(a - b), hy + l1 * Math.sin(a - b)];
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

function raptorRig({ action, actionT: t, time }: Pose): TheroRig {
  const r = { ...REST_RIG };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.1, neck: 0.45, head: -0.25, stride: 1.45, tailUp: 6, crest: -0.3 });
      break;
    case "eat": {
      // Arrache des morceaux : la tête tire vers l'arrière par saccades.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.42 - tug * 0.08, neck: 1.0 - tug * 0.25, head: 0.55, jaw: 0.25 + tug * 0.45, dy: 6, stance: 8, tailUp: 14 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.4, neck: 1.05 + s * 0.06, head: 0.75, jaw: 0.05, dy: 8, tailUp: 12 });
      break;
    case "rest": {
      const br = Math.sin(time * 2.4) * 0.04;
      Object.assign(r, { dy: 37, pitch: -0.05, neck: -0.15 + br, head: 0.25, curl: 1, legs: "sit", closed: true });
      break;
    }
    case "attack": {
      // 0-0.25 accroupi, 0.25-0.65 bond griffes en avant ailes ouvertes, 0.65-1 plaque la proie au sol.
      const crouch = win(t, 0, 0.25) * (1 - win(t, 0.3, 0.4));
      const air = win(t, 0.25, 0.4) * (1 - win(t, 0.6, 0.72));
      const pin = win(t, 0.6, 0.75);
      Object.assign(r, {
        dy: crouch * 14 - air * 34 + pin * 10,
        dx: air * 18 + pin * 24,
        pitch: -0.12 * crouch - 0.28 * air + 0.32 * pin,
        neck: 0.15 * crouch + 0.25 * air + 0.45 * pin,
        head: 0.1 + 0.25 * pin,
        jaw: 0.9 * Math.max(air, pin),
        arms: Math.max(air, pin * (0.75 + 0.25 * Math.sin(t * 40))),
        crest: Math.max(crouch, air),
        tailUp: 10 * air + 14 * pin,
        legs: air > 0.5 ? "air" : "stand",
        stance: 10 * pin,
      });
      break;
    }
    case "defend":
      Object.assign(r, { pitch: -0.12, neck: 0.15, head: 0.2, jaw: 0.75 + 0.25 * s, arms: 1, crest: 1, tailUp: 16, stance: 12, dy: 3 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.2, neck: -0.75, head: -0.55, jaw: 0.55 + 0.45 * Math.abs(s), arms: 0.25, crest: 0.8, tailUp: -4 });
      break;
    case "dead":
      Object.assign(r, { dy: 40, pitch: 0.06, neck: 0.95, head: 0.1, jaw: 0.2, curl: 0.2, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

export const RAPTOR_EYE = { x: 66, y: -104 };
/** Bassin (pivot du corps) et base du cou, px bruts. */
const HIP = { x: 2, y: -60 };
const NECK = { x: 30, y: -74 };
const NAPE = { x: 50, y: -96 };

export function raptorModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = raptorRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.9) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Pattes (cinématique inverse : la patte suit le bassin) ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 11 * r.stride;
    const m = L.far ? M.RFar : M.RSkin;
    const z = L.far ? -40 : 22;
    const hx = HIP.x + (L.far ? 4 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 6 + sw * 26 + (L.far ? -r.stance : r.stance), fy = -3 - lift;
    // Métatarse : vecteur de la cheville vers la base des orteils.
    let mx = 13, my = 21 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 14 + (L.far ? 6 : 0); fy = -3; mx = 25; my = 3; }
    else if (r.legs === "air") { fx = hx + 34 + (L.far ? -6 : 4); fy = hy + 44; mx = 16; my = 12; }
    else if (r.legs === "lie") { fx = hx + 58 + (L.far ? -8 : 0); fy = -5 - (L.far ? 0 : 4); mx = 18; my = 3; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 4, ax, ay, 24, 30);
    P.push(e(hx, hy, 17, 20, m, z - 4, 13));
    P.push(c(hx, hy + 4, kx, ky, 12, 7, m, z, 10));
    P.push(c(kx, ky, ax, ay, 6.5, 4, m, z + 2, 6));
    P.push(c(ax, ay, fx, fy, 4.5, 3, m, z + 3, 5));
    // Orteils, griffe en faucille (relevée, ou braquée vers l'avant pendant le bond).
    const toeY = r.legs === "air" ? 6 : 1.5;
    P.push(c(fx - 2, fy, fx + 13, fy + toeY, 3.2, 2, m, z + 3, 4));
    const sk = r.legs === "air" ? [fx + 5, fy + 2, fx + 13, fy + 8] : [fx + 4, fy - 11, fx + 10, fy - 9];
    P.push(c(fx + 1, fy - 3, sk[0], sk[1], 1, 1, M.Claw, z + 8, 2, true));
    P.push(c(sk[0], sk[1], sk[2], sk[3], 1, 1, M.Claw, z + 8, 2, true));
    P.push(c(fx + 13, fy + toeY, fx + 17, fy + toeY + 1.5, 1, 1, M.Claw, z + 8, 2, true));
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Queue rigide (tiges ossifiées), terminée en éventail de plumes.
  const sway = Math.sin(time * 1.6) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving;
  const tail: [number, number][] = [[-30, -68]];
  // La queue compense le tangage du corps (balancier) ; on la garde au-dessus du sol.
  let ang = Math.PI + 0.08 + r.tailUp * 0.01 - r.pitch * 0.85;
  for (let k = 1; k <= 7; k++) {
    ang -= r.curl * 0.33 + sway * 0.004 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 18, Math.min(py + Math.sin(ang) * 18, -Math.max(2, 14 - k * 2) - by - 2)]);
  }
  for (let k = 0; k < 7; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(2, 16 - k * 2), rb = Math.max(2, 16 - (k + 1) * 2);
    B.push(c(ax, ay, qx, qy, ra, rb, M.RSkin, 2, 12));
    if (k % 2 === 0) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.55, 3, ra * 0.4, M.Stripe, 14, 3));
  }
  const [tx, ty] = tail[7], [px7, py7] = tail[6];
  const tdx = (tx - px7) / 18, tdy = (ty - py7) / 18;
  for (let i = -2; i <= 2; i++) {
    B.push(c(tx - tdx * 10, ty - tdy * 10, tx + tdx * 14 - tdy * i * 4, ty + tdy * 14 + tdx * i * 4 + 2, 1, 1, M.Feather, 16, 2, true));
  }

  // Corps.
  B.push(e(0, -68, 46, 22, M.RSkin, 0, 22));
  B.push(e(6, -55, 38, 10, M.RBelly, 8, 9, -56));
  for (let k = 0; k < 6; k++) {
    const x = -34 + k * 12;
    B.push(e(x, -82 + Math.abs(x) * 0.08, 3.2, 8, M.Stripe, 18, 4));
  }
  // Plumes le long du dos.
  for (let k = 0; k < 8; k++) {
    const x = -40 + k * 10;
    const y = -88 + Math.abs(x + 5) * 0.12;
    B.push(c(x, y, x - 9, y - 6 - (k % 2) * 3, 1, 1, M.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 64, hy = -101 + hb;
  H.push(e(hx, hy, 17, 11, M.RSkin, 8, 12));
  H.push(e(hx + 19, hy + 2, 16, 6.5, M.RSkin, 8, 9));
  H.push(c(hx - 5, hy - 8, hx + 9, hy - 8, 2.5, 2, M.Stripe, 16, 2));
  if (r.closed) H.push(c(RAPTOR_EYE.x - 2, RAPTOR_EYE.y + hb, RAPTOR_EYE.x + 2, RAPTOR_EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(RAPTOR_EYE.x, RAPTOR_EYE.y + hb, 3, 3, M.Eye, 30, 1));
  H.push(e(hx + 31, hy, 1.3, 1.3, M.Socket, 16, 1));
  for (let tx2 = hx + 9; tx2 <= hx + 30; tx2 += 5) H.push(e(tx2, hy + 7.5, 1.6, 2, M.Tooth, 16, 1));
  // Gueule ouverte : intérieur sombre sous la ligne des dents, mâchoire inférieure abaissée.
  const jaw = r.jaw * 0.6;
  if (r.jaw > 0.1) H.push(e(hx + 12, hy + 9, 18, 7, M.Mouth, 12, 4, hy + 6));
  const J: Prim[] = [c(hx - 2, hy + 9, hx + 31, hy + 9, 4.5, 3, M.RSkin, 6, 5)];
  if (r.jaw > 0.1) for (let tx2 = hx + 10; tx2 <= hx + 28; tx2 += 6) J.push(e(tx2, hy + 6.5, 1.5, 1.8, CM.ToothUp, 14, 1));
  else J.push(c(hx + 2, hy + 6, hx + 33, hy + 6, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, hx - 4, hy + 6, jaw));
  // Plumes de la nuque : couchées, ou dressées en crête.
  for (let i = 0; i < (r.legs === "lie" ? 0 : 4); i++) {
    const up = Math.max(0, r.crest), len = 15 - i * 2;
    const ox = hx - 10 - i * 4, oy = hy - 6 + i * 3;
    const dx = lerp(-0.92, -0.45, up), dy = lerp(-0.4 + i * 0.1, -0.9, up);
    H.push(c(ox, oy, ox + dx * len, oy + dy * len, 1, 1, i % 2 ? M.Feather : CM.RCrest, 20, 2, true));
  }
  const N: Prim[] = [c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 13, 9, M.RSkin, 6, 12), ...rot(H, NAPE.x, NAPE.y, r.head)];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras : repliés, ou déployés comme des ailes (grandes plumes ancrées sur l'avant-bras).
  for (const far of [true, false]) {
    const m = far ? M.RFar : M.RSkin;
    const z = far ? -30 : 26;
    const a = r.arms;
    const sx = 34 + (far ? -4 : 0), sy = -64;
    const ex = sx + lerp(6, far ? 2 : 10, a), ey = sy + lerp(14, far ? -20 : -18, a);
    const flap = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const wx = ex + lerp(13, far ? 14 : 20, a), wy = ey + lerp(-2 + flap, far ? -10 : -6, a);
    // Plumes de l'aile : le long du corps au repos, en éventail vers le bas une fois ouvertes.
    const fl = lerp(9, 22, a);
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const dx = lerp(-1, -0.35 + u * 0.15, a), dy = lerp(-0.25, 1, a);
      B.push(c(qx, qy, qx + dx * fl * (1 - u * 0.3 * a), qy + dy * fl * (1 - u * 0.3 * a), 1, 1, k % 2 ? M.Feather : CM.RWing, z + 1, 1, true));
    }
    if (a > 0.3) B.push(e((ex + wx) / 2 - 3, (ey + wy) / 2 + 9, 11, 9 * a, CM.RWing, z - 2, 4));
    B.push(c(sx, sy, ex, ey, 5, 3.5, m, z, 4));
    B.push(c(ex, ey, wx, wy, 3.5, 2.5, m, z, 3));
    for (let k = 0; k < 3; k++) B.push(c(wx, wy + k * 2, wx + 4, wy + 4 + k * 2, 1, 1, M.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, RAPTOR_SCALE));
}

/**
 * Squelette : chaque primitive porte l'id de son os (format : voir ankyloSkeleton).
 * Pose debout, regard à droite.
 */
export function raptorSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : long museau, grandes fenêtres (orbite, fenêtre antorbitaire), dents en lame.
  tag("crane",
    e(62, -101, 15, 9, B, 12, 8), e(81, -99, 15, 5, B, 12, 6),
    c(60, -92, 95, -94, 2.5, 1.5, B, 12, 2),
    e(64, -104, 3.5, 3.5, M.Socket, 30, 1), e(78, -100, 5, 2.5, M.Socket, 30, 1), e(52, -98, 3, 3, M.Socket, 30, 1),
    ...[68, 74, 80, 86, 92].map((x) => e(x, -94, 1.3, 1.8, M.Tooth, 16, 1)));
  // Colonne : cou en S, dos horizontal jusqu'au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    spine.push(t < 0.35 ? [48 - t * 50, -96 + t * 70] : [30 - (t - 0.35) * 85, -72 + (t - 0.35) * 2]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 3.5, 3, B, 10, 3));
  // Côtes et gastralia (côtes du ventre), fines.
  for (let k = 5; k <= 11; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 2, x + 4, y + 14, 1, 1, B, 8, 2, true), c(x + 4, y + 14, x + 1, -50, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, pubis vers l'arrière comme chez les oiseaux.
  tag("bassin", e(0, -66, 18, 7, B, 12, 6), c(-2, -62, -12, -44, 3, 2, B, 12, 3), c(6, -62, 14, -54, 3, 2, B, 12, 3));
  // Bras : omoplate, fourchette (furcula), humérus, ulna à bosses de plumes, main à trois griffes.
  tag("bras",
    c(38, -76, 20, -80, 2.5, 2, B, 12, 2), c(38, -66, 42, -58, 1, 1, B, 14, 1, true),
    c(36, -66, 40, -52, 2.5, 2, B, 14, 2), c(40, -52, 54, -54, 2, 1.5, B, 14, 2),
    ...[44, 48, 52].map((x) => e(x, -55, 1, 1, B, 18, 1)),
    ...[0, 2, 4].map((k) => c(54, -54 + k, 58, -50 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, métatarse, orteils.
  for (const [hx, z] of [[6, 4], [2, 16]] as const) {
    tag("pattes", c(hx, -58, hx + 14, -42, 3, 2.5, B, z, 3), c(hx + 14, -42, hx - 3, -22, 2.5, 2, B, z, 2),
      c(hx - 3, -22, hx + 8, -4, 2, 1.5, B, z, 2), c(hx + 6, -3, hx + 20, -2, 1.5, 1, B, z, 1));
  }
  // Griffe en faucille du deuxième orteil, relevée.
  tag("griffe", c(11, -6, 14, -14, 1, 1, B, 20, 2, true), c(14, -14, 20, -12, 1, 1, B, 20, 2, true), e(11, -5, 2, 2, B, 20, 2));
  // Queue : vertèbres caudales gainées de tiges osseuses qui la rigidifient.
  const tail: [number, number][] = [];
  for (let k = 0; k <= 12; k++) tail.push([-26 - k * 10.5, -70 - k * 0.8]);
  for (const [x, y] of tail) tag("queue", e(x, y, 3, 2.4, B, 10, 2));
  tag("queue", c(-40, -73, -150, -82, 1, 1, B, 12, 1, true), c(-40, -67, -150, -76, 1, 1, B, 12, 1, true));
  return P.map((p) => scalePrim(p, RAPTOR_SCALE));
}

export const RAPTOR: Species = {
  id: "raptor",
  name: "Dakotaraptor",
  latin: "Dakotaraptor steini",
  period: "Crétacé supérieur, 66 Ma",
  place: "Formation de Hell Creek, Dakota du Sud (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 300,
  facts: [
    { id: "plumes", title: "Un raptor à plumes", unlock: "discover",
      text: "Les raptors étaient couverts de plumes. Sur l'ulna (un os de l'avant-bras) du Dakotaraptor, on voit de petites bosses où s'ancraient de grandes plumes, comme chez les oiseaux." },
    { id: "cousin", title: "Cousin des oiseaux", unlock: "assemble",
      text: "Les dromaeosaures sont de proches cousins des oiseaux : os creux, plumes, et même une « fourchette » (furcula). Mais l'os d'abord pris pour celle du Dakotaraptor était... un morceau de carapace de tortue !" },
    { id: "faucille", title: "La griffe en faucille", unlock: "attack",
      text: "Sa griffe géante du deuxième orteil servait sans doute à clouer la proie au sol, comme le font les aigles et les faucons. Il battait des ailes pour garder l'équilibre : on appelle cela le modèle « RPR »." },
    { id: "meute", title: "Chasse en meute ?", unlock: "hunt",
      text: "Les films montrent des raptors chassant en meute organisée. En réalité, c'est très débattu : ils vivaient peut-être en petits groupes lâches, comme certains rapaces ou varans." },
    { id: "taille", title: "Un géant parmi les raptors", unlock: "call",
      text: "Avec ses 5 mètres de long, le Dakotaraptor est l'un des plus grands raptors connus. Il a été décrit en 2015, à partir de fossiles du Dakota du Sud." },
    { id: "ailes", title: "Des ailes qui ne volent pas", unlock: "defend",
      text: "Trop lourd pour voler, il gardait pourtant de grandes plumes aux bras : pour parader, impressionner un rival, ou couver ses œufs comme un oiseau." },
    { id: "opportuniste", title: "Rien ne se perd", unlock: "scavenge",
      text: "Comme la plupart des prédateurs actuels, il ne laissait sûrement pas passer une carcasse : manger sans chasser, c'est économiser son énergie." },
    { id: "couveur", title: "Il couvait comme un oiseau", unlock: "nest",
      text: "Les raptors et leurs cousins couvaient sans doute leurs œufs. On a même trouvé un Citipati fossilisé assis sur son nid, les bras ouverts au-dessus des œufs, longs et rangés par paires en cercle." },
    { id: "poussin", title: "Des bébés en duvet", unlock: "baby",
      text: "Les bébés raptors étaient sûrement couverts de duvet, comme des poussins. Ils devaient vite apprendre à courir et à attraper de petites proies : insectes, lézards, petits mammifères." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras et furcula" },
    { id: "pattes", name: "Pattes" },
    { id: "griffe", name: "Griffe en faucille" },
    { id: "queue", name: "Queue à tiges osseuses" },
  ],
  model: raptorModel,
  skeleton: raptorSkeleton,
  center: { x: 10 * RAPTOR_SCALE, y: -70 * RAPTOR_SCALE },
  eye: { x: RAPTOR_EYE.x * RAPTOR_SCALE, y: RAPTOR_EYE.y * RAPTOR_SCALE },
  feet: [8, 12].map((x) => x * RAPTOR_SCALE),
  halfLen: 120 * RAPTOR_SCALE,
  shadow: 0.55,
  walkSpeed: 60,
  runSpeed: 170,
  stride: 9,
  behavior: { diet: "carnivore", herd: [2, 3], browse: null, prey: ["pachy", "edmonto"], defense: "bite", sight: 420, scavenger: true },
};
