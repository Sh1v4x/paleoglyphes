import { createNoise2D, createNoise3D } from "simplex-noise";
import type { Frame } from "../render/frame";
import { hash2, mulberry32 } from "../rng";

/**
 * Cinématique spatiale : la Terre du Crétacé final (66 Ma) tourne lentement, la météorite de
 * Chicxulub entre en haut à droite, frappe le Yucatan, flash, onde de choc, puis fondu au blanc.
 * Tout est dessiné cellule par cellule (1 caractère = 1 pixel), sans allocation par cellule.
 */

/** Durée totale (s). */
export const SPACE_DURATION = 7;
/** Instant de l'impact (s). */
export const SPACE_IMPACT = SPACE_DURATION - 2.2;
/** Début du fondu au blanc (s) ; l'écran est entièrement blanc à SPACE_DURATION. */
export const SPACE_WHITE = SPACE_DURATION - 0.6;

const T_IN = 0.8;
const CW = 4, CH = 7;
/** Inclinaison du pôle vers l'observateur (rad) et vitesse de rotation (rad/s). */
const TILT = 0.38;
const OMEGA = 0.07;
/** Point d'impact sur le disque (unités de rayon, y vers le bas). */
const IMP_X = -0.3, IMP_Y = 0.1;
/** Soleil (x droite, y haut, z vers l'observateur). */
const SUN = norm3(-0.62, 0.38, 0.69);
const HALF = norm3(SUN[0], SUN[1], SUN[2] + 1);
const HALO = 0.075;
const CAPTION = "Il y a 66 millions d'annees, une meteorite de 10 km frappe la Terre...";

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const code = (s: string, v: number) => s.charCodeAt(Math.min(s.length - 1, Math.max(0, Math.floor(v * s.length))));

// Coordonnées « corps » (lat/lon) du point d'impact : la texture est centrée dessus (lon 0).
const IMP_Z = Math.sqrt(1 - IMP_X * IMP_X - IMP_Y * IMP_Y);
const IMP_BY = -IMP_Y * Math.cos(TILT) + IMP_Z * Math.sin(TILT);
const IMP_BZ = IMP_Y * Math.sin(TILT) + IMP_Z * Math.cos(TILT);
const IMP_LAT = Math.asin(IMP_BY);
const IMP_LONS = Math.atan2(IMP_X, IMP_BZ);
const SIN_LI = Math.sin(IMP_LAT), COS_LI = Math.cos(IMP_LAT);

// --- Textures équirectangulaires (relief + nuages), construites une fois à la demande. ---
const TW = 512, TH = 256;
const TAU = Math.PI * 2;
let LAND: Float32Array | null = null;
let CLOUD: Float32Array | null = null;

/** Masses continentales du Crétacé final [lon, lat, rayon (rad), poids], lon relative au Yucatan. */
const BLOBS: readonly (readonly [number, number, number, number])[] = [
  [-0.32, 0.78, 0.42, 0.95], // Laramidia + Appalachia (Amérique du Nord)
  [-0.15, 1.15, 0.35, 0.7],
  [-0.02, 0.27, 0.12, 0.62], // Yucatan : plate-forme peu profonde
  [-0.18, 0.42, 0.14, 0.6], // Mexique
  [0.5, -0.3, 0.3, 0.9], // Amérique du Sud
  [0.62, -0.75, 0.25, 0.8],
  [1.35, 0.1, 0.4, 1.0], // Afrique
  [1.45, -0.45, 0.3, 0.8],
  [1.15, 0.8, 0.14, 0.55], // archipel européen
  [1.4, 0.88, 0.12, 0.5],
  [2.2, 0.85, 0.45, 1.0], // Asie
  [1.95, -0.3, 0.16, 0.7], // Inde, île en dérive
  [2.9, -1.05, 0.4, 0.9], // Australie + Antarctique
  [-0.4, 0.75, 0.07, -0.9], // Voie maritime intérieure de l'Ouest
  [-0.38, 0.55, 0.07, -0.9],
  [-0.42, 0.95, 0.07, -0.85],
];

function buildTextures() {
  const n3 = createNoise3D(mulberry32(66)), c3 = createNoise3D(mulberry32(1066));
  LAND = new Float32Array(TW * TH);
  CLOUD = new Float32Array(TW * TH);
  const bc = BLOBS.map(([lo, la, r, w]) => [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), r * r * 0.5, w]);
  for (let ty = 0; ty < TH; ty++) {
    const la = (0.5 - (ty + 0.5) / TH) * Math.PI;
    for (let tx = 0; tx < TW; tx++) {
      const lo = ((tx + 0.5) / TW) * TAU;
      const px = Math.cos(la) * Math.sin(lo), py = Math.sin(la), pz = Math.cos(la) * Math.cos(lo);
      let h = -0.5;
      for (const b of bc) h += b[4] * Math.exp((px * b[0] + py * b[1] + pz * b[2] - 1) / b[3]);
      let a = 0.5, fq = 1.7, nn = 0;
      for (let o = 0; o < 5; o++, a *= 0.5, fq *= 2.1) nn += a * n3(px * fq, py * fq, pz * fq);
      LAND[ty * TW + tx] = h + nn * 0.55;
      // Nuages : bruit étiré en longitude (bandes), légèrement déformé.
      const w = 0.6 * n3(px * 1.3 + 5, py * 1.3, pz * 1.3);
      let c = 0;
      a = 0.55; fq = 2.2;
      for (let o = 0; o < 4; o++, a *= 0.5, fq *= 2.2) c += a * c3(px * fq + w, py * fq * 1.8, pz * fq - w);
      CLOUD[ty * TW + tx] = c;
    }
  }
}

// --- Cache par taille d'écran : géométrie de la sphère, fond spatial, étoiles. ---
interface Geo {
  cols: number; rows: number;
  /** Centre du disque (px) et rayon (px). */
  cx: number; cy: number; R: number;
  disk: Uint8Array;
  ty: Int32Array;
  lon: Float32Array;
  sLat: Float32Array; cLat: Float32Array;
  lam: Float32Array; dotL: Float32Array; spec: Float32Array; rim: Float32Array;
  /** Halo d'atmosphère hors disque (0..1). */
  halo: Float32Array;
  space: Uint8Array;
  spaceCh: Uint8Array;
  stars: Int32Array;
  starB: Float32Array; starP: Float32Array; starC: Uint8Array;
}
let GEO: Geo | null = null;

const STAR_COLORS: readonly (readonly [number, number, number])[] = [
  [235, 240, 255], [200, 215, 255], [255, 240, 205], [255, 205, 150], [255, 160, 140], [170, 200, 255],
];

function buildGeo(cols: number, rows: number): Geo {
  const n = cols * rows, W = cols * CW, H = rows * CH;
  const R = Math.min(H * 0.4, W * 0.3);
  const cx = W * 0.42, cy = H * 0.5;
  const g: Geo = {
    cols, rows, cx, cy, R,
    disk: new Uint8Array(n), ty: new Int32Array(n), lon: new Float32Array(n),
    sLat: new Float32Array(n), cLat: new Float32Array(n),
    lam: new Float32Array(n), dotL: new Float32Array(n), spec: new Float32Array(n), rim: new Float32Array(n),
    halo: new Float32Array(n), space: new Uint8Array(n * 3), spaceCh: new Uint8Array(n),
    stars: new Int32Array(0), starB: new Float32Array(0), starP: new Float32Array(0), starC: new Uint8Array(0),
  };
  const neb = createNoise2D(mulberry32(7)), neb2 = createNoise2D(mulberry32(8));
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const ux = ((x + 0.5) * CW - cx) / R, uy = ((y + 0.5) * CH - cy) / R;
      const d2 = ux * ux + uy * uy;
      // Fond : dégradé bleu nuit -> violet, nébuleuses diffuses.
      const gy = y / rows, gx = x / cols;
      let q = 1, nv = 0, nw = 0;
      for (let o = 0; o < 4; o++, q *= 2.1) {
        nv += neb(gx * 2.2 * q, gy * 1.1 * q) / q;
        nw += neb2(gx * 1.6 * q + 3, gy * 0.9 * q) / q;
      }
      const pu = Math.max(0, nv - 0.15) ** 2, te = Math.max(0, nw - 0.2) ** 2;
      g.space[i * 3] = 4 + 6 * gx + 45 * pu + 5 * te;
      g.space[i * 3 + 1] = 4 + 3 * (1 - gy) + 10 * pu + 22 * te;
      g.space[i * 3 + 2] = 14 + 10 * (1 - gy) + 55 * pu + 36 * te;
      g.spaceCh[i] = pu + te > 0.12 && hash2(x, y, 3) < (pu + te) * 1.6 ? (hash2(x, y, 4) < 0.5 ? 46 : 39) : 32;
      if (d2 < 1) {
        const nx = ux, ny = -uy, nz = Math.sqrt(1 - d2);
        const by = ny * ct + nz * st, bz = -ny * st + nz * ct;
        const la = Math.asin(by);
        g.disk[i] = 1;
        g.ty[i] = Math.min(TH - 1, Math.max(0, Math.floor((0.5 - la / Math.PI) * TH)));
        g.lon[i] = Math.atan2(nx, bz);
        g.sLat[i] = Math.sin(la); g.cLat[i] = Math.cos(la);
        const dl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
        g.dotL[i] = dl;
        g.lam[i] = Math.max(0, dl) ** 0.85;
        g.spec[i] = dl > 0 ? Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 60 : 0;
        g.rim[i] = (1 - nz) ** 2.5;
      } else {
        const d = Math.sqrt(d2);
        if (d < 1 + HALO) {
          const lit = Math.max(0, (ux * SUN[0] - uy * SUN[1]) / d);
          g.halo[i] = (1 - (d - 1) / HALO) ** 2 * (0.12 + 0.95 * lit);
        }
      }
    }
  }
  // Étoiles stables (hors disque et halo).
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (!g.disk[i] && g.halo[i] < 0.05 && hash2(i % cols, (i / cols) | 0, 21) < 0.022) idx.push(i);
  g.stars = Int32Array.from(idx);
  g.starB = Float32Array.from(idx, (i) => hash2(i, 1, 22) ** 3);
  g.starP = Float32Array.from(idx, (i) => hash2(i, 2, 23) * TAU);
  g.starC = Uint8Array.from(idx, (i) => {
    const h = hash2(i, 3, 24);
    return h < 0.7 ? 0 : h < 0.8 ? 1 : h < 0.88 ? 2 : h < 0.94 ? 3 : h < 0.97 ? 4 : 5;
  });
  return g;
}

// --- Petits outils de dessin (pas d'allocation). ---
function put(f: Frame, i: number, ch: number, r: number, g: number, b: number, br: number, bgc: number, bb: number) {
  const k = i * 4;
  f.ch[i] = ch;
  f.fg[k] = r; f.fg[k + 1] = g; f.fg[k + 2] = b; f.fg[k + 3] = 255;
  f.bg[k] = br; f.bg[k + 1] = bgc; f.bg[k + 2] = bb; f.bg[k + 3] = 255;
}
/** Lumière additive (fg et fond). */
function glow(f: Frame, i: number, r: number, g: number, b: number, kf: number, kb: number) {
  const k = i * 4;
  f.fg[k] += r * kf; f.fg[k + 1] += g * kf; f.fg[k + 2] += b * kf;
  f.bg[k] += r * kb; f.bg[k + 1] += g * kb; f.bg[k + 2] += b * kb;
}
/** Particule : glyphe + couleur mêlée par `a`, fond réchauffé. */
function spark(f: Frame, xc: number, yc: number, ch: number, r: number, g: number, b: number, a: number) {
  const x = Math.floor(xc), y = Math.floor(yc);
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows || a <= 0) return;
  const i = y * f.cols + x, k = i * 4;
  if (a > 0.25) f.ch[i] = ch;
  f.fg[k] += (r - f.fg[k]) * a; f.fg[k + 1] += (g - f.fg[k + 1]) * a; f.fg[k + 2] += (b - f.fg[k + 2]) * a;
  f.bg[k] += r * a * 0.3; f.bg[k + 1] += g * a * 0.3; f.bg[k + 2] += b * a * 0.3;
}

/** Couleur du feu selon la « chaleur » h (1 = blanc, 0 = rouge sombre) -> FR, FG, FB. */
let FR = 0, FG = 0, FB = 0;
function fire(h: number) {
  h = clamp01(h);
  FR = 90 + 165 * smooth(0, 0.35, h);
  FG = 20 + 120 * smooth(0.2, 0.65, h) + 95 * smooth(0.65, 1, h);
  FB = 10 + 40 * smooth(0.6, 0.8, h) + 180 * smooth(0.85, 1, h);
}

const OCEAN_R = ".-~~=*";
const LAND_R = ".:;+x%#";
const CLOUD_R = ":-=+*%@";
const TAIL_R = ".'+*@";
const RING_R = "()#*";
const FLAME_R = "'^*\"";

// Trajectoire (unités de rayon, y vers le bas) : départ hors champ en haut à droite.
let SX = 0, SY = 0, KX = 0, KY = 0;
let PX = 0, PY = 0;
function path(s: number) {
  const u = 1 - s;
  PX = u * u * SX + 2 * u * s * KX + s * s * IMP_X;
  PY = u * u * SY + 2 * u * s * KY + s * s * IMP_Y;
}
const progress = (t: number) => {
  const k = clamp01((t - T_IN) / (SPACE_IMPACT - T_IN));
  return k * (0.3 + 0.7 * k); // accélère en approchant
};

/** Dessine la séquence spatiale de la météorite dans le calque monde. `t` en secondes depuis le début (0..SPACE_DURATION). */
export function drawSpace(f: Frame, t: number): void {
  if (!LAND) buildTextures();
  if (!GEO || GEO.cols !== f.cols || GEO.rows !== f.rows) GEO = buildGeo(f.cols, f.rows);
  const g = GEO, land = LAND!, cloud = CLOUD!;
  const { cols, rows, cx, cy, R } = g;
  const toX = (ux: number) => (cx + ux * R) / CW, toY = (uy: number) => (cy + uy * R) / CH;
  const dt = t - SPACE_IMPACT;
  const lonShift = IMP_LONS + OMEGA * (t - SPACE_IMPACT);
  const kTex = TW / TAU, cloudShift = t * 0.035;
  // Onde de choc (rayon angulaire sur la sphère) et brasier.
  const post = dt > 0;
  const ringA = post ? 0.62 * dt ** 0.8 : 0, ringW = 0.025 + 0.02 * dt;
  const flick = Math.floor(t * 24);

  // 1. Fond, planète, halo.
  for (let i = 0, n = cols * rows; i < n; i++) {
    const x = i % cols, y = (i / cols) | 0;
    if (!g.disk[i]) {
      const s3 = i * 3;
      let r = g.space[s3], gg = g.space[s3 + 1], b = g.space[s3 + 2];
      const h = g.halo[i];
      let ch = g.spaceCh[i];
      if (h > 0) {
        r += 70 * h; gg += 150 * h; b += 255 * h;
        if (h > 0.08) ch = code(".:-=", h * 1.4);
      }
      put(f, i, ch, r * 1.8 + 8 * h, gg * 1.8 + 10 * h, b * 1.6 + 20 * h, r, gg, b);
      continue;
    }
    const lon = g.lon[i] - lonShift;
    let tx = Math.floor(lon * kTex) % TW; if (tx < 0) tx += TW;
    let tc = Math.floor((lon - cloudShift) * kTex) % TW; if (tc < 0) tc += TW;
    const row = g.ty[i] * TW;
    const h = land[row + tx], c = cloud[row + tc];
    const lam = g.lam[i], dl = g.dotL[i];
    const ca = smooth(0.14, 0.55, c) * 0.9;
    let r: number, gg: number, b: number, ramp: string, ocean = 0;
    if (h < 0) {
      const dp = smooth(0, 0.3, -h);
      r = 30 - 22 * dp; gg = 150 - 112 * dp; b = 170 - 62 * dp;
      ramp = OCEAN_R; ocean = 1;
    } else {
      const lat = Math.abs(g.sLat[i]);
      const arid = smooth(0.15, 0.6, 1 - Math.abs(lat - 0.42) * 3.2 + (c + 0.2) * 0.6) * 0.8;
      const hi = smooth(0.25, 0.6, h);
      r = 46 + 130 * arid + 60 * hi; gg = 112 + 30 * arid - 10 * hi; b = 42 + 30 * arid + 30 * hi;
      if (h < 0.04) { r += 40; gg += 30; b += 20; } // plages, deltas
      ramp = LAND_R;
    }
    // Nuages.
    r += (238 - r) * ca; gg += (242 - gg) * ca; b += (250 - b) * ca;
    if (ca > 0.45) ramp = CLOUD_R;
    // Éclairage : lambert, lueur du terminateur, côté nuit bleuté.
    const L = 0.035 + 1.1 * lam;
    const tw = Math.exp(-(((dl - 0.02) / 0.06) ** 2)) * 0.6;
    r = r * L + 70 * tw; gg = gg * L + 26 * tw; b = b * L + 8 + 6 * (1 - lam);
    const sp = g.spec[i] * ocean * (1 - ca);
    r += 255 * sp; gg += 236 * sp; b += 200 * sp;
    const rim = g.rim[i] * (0.18 + lam);
    r += 60 * rim; gg += 120 * rim; b += 230 * rim;
    let ch: number;
    let lum = (0.3 * r + 0.55 * gg + 0.15 * b) / 255;
    // Impact : brasier et anneau de choc dans le repère du globe.
    if (post) {
      const ang = Math.acos(Math.max(-1, Math.min(1, g.sLat[i] * SIN_LI + g.cLat[i] * COS_LI * Math.cos(lon))));
      if (ang < ringA + ringW * 4) {
        // Bruit stable (texture de nuages décalée) : flammes en plaques, front irrégulier.
        const pn = cloud[row + ((tx + 173) % TW)];
        const wj = ringW * (0.75 + Math.max(0, pn) * 1.4);
        const ring = Math.exp(-(((ang - ringA) / wj) ** 2));
        const hz = hash2(x, y, flick);
        ch = 0;
        if (ang < ringA) {
          // Intérieur : sol calciné, plaques de feu plus vives près du front.
          const q = ang / ringA;
          r = r * 0.3 + 40; gg = gg * 0.25 + 8; b = b * 0.25 + 4;
          const m = smooth(0, 0.3, pn + 0.3 * q - 0.12);
          const heat = (0.12 + 0.45 * q * q + 0.2 * hz) * m;
          fire(heat);
          const k = m * 0.9;
          r += (FR - r) * k; gg += (FG - gg) * k; b += (FB - b) * k;
          ch = m > 0.35 ? code(FLAME_R, hz) : hz < 0.5 ? 46 : 44;
        }
        if (ring > 0.12) {
          fire(0.3 + 0.62 * ring);
          const k = Math.min(1, ring * 1.3);
          r += (FR - r) * k; gg += (FG - gg) * k; b += (FB - b) * k;
          if (ring > 0.35) ch = hz < 0.55 ? (Math.sin(lon) < 0 ? 40 : 41) : code(RING_R, 0.5 + hz * 0.5);
        }
        if (ch) {
          put(f, i, ch, r * 1.3 + 20, gg * 1.25 + 12, b * 1.15 + 6, r * 0.55, gg * 0.45, b * 0.45);
          continue;
        }
      }
    }
    lum = lum + (hash2(x, y, 11) - 0.5) * 0.12;
    ch = lum < 0.03 ? 32 : code(ramp, lum * 1.1);
    put(f, i, ch, r * 1.22 + 10, gg * 1.22 + 10, b * 1.22 + 12, r * 0.55, gg * 0.55, b * 0.58);
  }

  // 2. Étoiles scintillantes.
  for (let s = 0; s < g.stars.length; s++) {
    const i = g.stars[s], bri = g.starB[s];
    const tw = 0.6 + 0.4 * Math.sin(t * (0.8 + 3 * bri) + g.starP[s]);
    const k = (0.35 + 0.65 * bri) * tw;
    const c = STAR_COLORS[g.starC[s]];
    f.ch[i] = bri > 0.55 ? 42 : bri > 0.25 ? 43 : bri > 0.08 ? 39 : 46;
    const q = i * 4;
    f.fg[q] = c[0] * k; f.fg[q + 1] = c[1] * k; f.fg[q + 2] = c[2] * k;
    if (bri > 0.55) glow(f, i, c[0], c[1], c[2], 0, 0.12 * tw);
  }

  // 3. Météorite : traînée de particules puis tête incandescente.
  SX = (cols * CW + 6 - cx) / R; SY = (-10 - cy) / R;
  KX = (SX + IMP_X) * 0.5 + 0.25; KY = (SY + IMP_Y) * 0.5 - 0.12;
  if (t >= T_IN && dt < 0) {
    const s = progress(t);
    const dtk = 0.01, life = 1.1;
    const eNow = Math.floor(t / dtk);
    for (let j = 0; j * dtk < life; j++) {
      const e = eNow - j, te = e * dtk;
      if (te < T_IN) break;
      const age = (t - te) / life;
      path(progress(te));
      for (let p = 0; p < 4; p++) {
        const hx = hash2(e, p, 31) - 0.5, hy = hash2(e, p, 32) - 0.5;
        const spread = 0.012 + age * 0.16 * (p + 1) * 0.5;
        const ax = PX + hx * spread, ay = PY + hy * spread + age * age * 0.02;
        const heat = (1 - age) ** 1.6 * (0.7 + 0.3 * hash2(e, p, 33));
        fire(heat);
        const a = (1 - age) * (p === 0 ? 1 : 0.7);
        spark(f, toX(ax), toY(ay), code(TAIL_R, heat * 0.95 + 0.05), FR, FG, FB, a);
      }
    }
    // Tête : noyau blanc, halo orange, plus gros en approchant (entrée atmosphérique).
    path(s);
    const hx = toX(PX), hy = toY(PY);
    const rh = (0.016 + 0.034 * s) * R; // px
    const rg = rh * (4 + 3 * s);
    const x0 = Math.max(0, Math.floor((hx * CW - rg) / CW)), x1 = Math.min(cols - 1, Math.ceil((hx * CW + rg) / CW));
    const y0 = Math.max(0, Math.floor((hy * CH - rg) / CH)), y1 = Math.min(rows - 1, Math.ceil((hy * CH + rg) / CH));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot((x + 0.5) * CW - hx * CW, (y + 0.5) * CH - hy * CH) / rh;
        const i = y * cols + x;
        if (d < 1) put(f, i, d < 0.55 ? 64 : 35, 255, 255, 235, 255, 230, 170);
        else {
          const k = Math.exp(-(d - 1) * (1.1 - 0.4 * s));
          fire(0.45 + 0.55 * k);
          glow(f, i, FR, FG, FB, k, k * 0.75);
          if (k > 0.45) f.ch[i] = k > 0.75 ? 42 : 43;
        }
      }
    }
  }

  // 4. Impact : lueur du cratère, éjectas, flash.
  if (post) {
    const ix = toX(IMP_X), iy = toY(IMP_Y);
    // Lueur au point d'impact (rayonnement thermique), décroît lentement.
    const gr = (0.06 + 0.1 * Math.min(1, dt)) * R;
    const gi = Math.exp(-dt * 0.6);
    const x0 = Math.max(0, Math.floor(ix - (gr * 3) / CW)), x1 = Math.min(cols - 1, Math.ceil(ix + (gr * 3) / CW));
    const y0 = Math.max(0, Math.floor(iy - (gr * 3) / CH)), y1 = Math.min(rows - 1, Math.ceil(iy + (gr * 3) / CH));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot((x + 0.5 - ix) * CW, (y + 0.5 - iy) * CH) / gr;
        const k = Math.exp(-d * d) * gi;
        if (k < 0.02) continue;
        fire(0.6 + 0.4 * k);
        const i = y * cols + x;
        glow(f, i, FR, FG, FB, k * 1.4, k);
        if (k > 0.5) f.ch[i] = code("*#%@", k * 1.2 - 0.5);
      }
    }
    // Éjectas : gerbe d'étincelles balistiques.
    for (let p = 0; p < 320; p++) {
      const t0 = hash2(p, 0, 41) * 0.5;
      const tau = dt - t0;
      if (tau <= 0) continue;
      const lifeP = 0.9 + hash2(p, 1, 42) * 1.2;
      const age = tau / lifeP;
      if (age >= 1) continue;
      const th = hash2(p, 2, 43) * TAU, v = 0.3 + hash2(p, 3, 44) ** 2 * 2.2;
      const dist = (v * (1 - Math.exp(-tau * 2.2))) / 2.2;
      const ax = IMP_X + Math.cos(th) * dist, ay = IMP_Y + Math.sin(th) * dist * 0.85 + tau * tau * 0.03;
      const ex = Math.cos(th) * 0.012, ey = Math.sin(th) * 0.01;
      for (let q = 0; q < 3; q++) {
        fire((0.5 + 0.5 * (1 - age) * (0.75 + 0.25 * hash2(p, 4, 45))) * (1 - q * 0.25));
        spark(f, toX(ax - ex * q), toY(ay - ey * q), q ? 39 : code(TAIL_R, (1 - age) * 0.9 + 0.05), FR, FG, FB, (1 - age) ** 0.6 * (1 - q * 0.3));
      }
    }
  }

  // 5. Légende pédagogique.
  const ca = smooth(1, 1.5, t) * (1 - smooth(4.4, 4.8, t));
  if (ca > 0) {
    const text = CAPTION.length > cols - 4 ? CAPTION.slice(0, cols - 4) : CAPTION;
    const y = rows - Math.max(3, Math.round(rows * 0.06));
    const x0 = Math.floor((cols - text.length) / 2);
    for (let x = Math.max(0, x0 - 2); x < Math.min(cols, x0 + text.length + 2); x++) {
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        const k = (yy * cols + x) * 4, m = 1 - 0.75 * ca;
        f.bg[k] *= m; f.bg[k + 1] *= m; f.bg[k + 2] *= m;
        f.fg[k] *= m; f.fg[k + 1] *= m; f.fg[k + 2] *= m;
      }
    }
    for (let j = 0; j < text.length; j++) {
      const x = x0 + j;
      if (x < 0 || x >= cols) continue;
      const i = y * cols + x, k = i * 4;
      if (text.charCodeAt(j) !== 32) f.ch[i] = text.charCodeAt(j); else f.ch[i] = 32;
      f.fg[k] += (240 - f.fg[k]) * ca; f.fg[k + 1] += (236 - f.fg[k + 1]) * ca; f.fg[k + 2] += (222 - f.fg[k + 2]) * ca;
    }
  }

  // 6. Flash de l'impact puis fondu au blanc final.
  let wk = 0;
  if (post) wk = dt < 0.06 ? dt / 0.06 : Math.exp(-(dt - 0.06) * 4.5) * 0.97;
  wk = Math.max(wk, smooth(SPACE_WHITE, SPACE_DURATION - 0.05, t));
  if (wk > 0.003) {
    const n = cols * rows, blank = wk > 0.9;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      f.fg[k] += (255 - f.fg[k]) * wk; f.fg[k + 1] += (252 - f.fg[k + 1]) * wk; f.fg[k + 2] += (245 - f.fg[k + 2]) * wk;
      f.bg[k] += (255 - f.bg[k]) * wk; f.bg[k + 1] += (252 - f.bg[k + 1]) * wk; f.bg[k + 2] += (245 - f.bg[k + 2]) * wk;
      if (blank) f.ch[i] = 32;
    }
  }
}
