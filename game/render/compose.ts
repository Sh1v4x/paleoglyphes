import { createNoise2D } from "simplex-noise";
import { CELL_H, CELL_W } from "../config";
import { sample, type Field } from "../features/lenia";
import type { Palette, RGB, Theme } from "../palette";
import { hash2, mulberry32 } from "../rng";
import type { World } from "../world/generate";
import { F } from "../world/flora.mat";
import { COVER, T } from "../world/tiles";
import { setBg, setFg, type Frame } from "./frame";
import { computeLight, type PointLight } from "./lighting";
import { M, VFLIP_CODE } from "./materials";
import type { Raster } from "./raster";

const noise = createNoise2D(mulberry32(5));

// Couvert végétal (pas d'herbe au Crétacé) : index 0/1/2 = penché à gauche / droit / à droite.
const FERN_TALL = "{Y}";
const FERN_MID = "(*)";
const HORSETAIL = "\\|/";
const MOSS = ".:oO";
const PLANKTON = ".:;o*";
/** Lueur du plancton (bleu-vert froid), visible surtout la nuit. */
const GLOW: RGB = [110, 250, 215];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const code = (s: string, i: number) => s.charCodeAt(Math.min(s.length - 1, Math.max(0, i)));

// Registres de couleur réutilisés pour éviter toute allocation par cellule.
let R = 0, G = 0, B = 0;
const mix = (a: RGB, b: RGB, t: number) => {
  R = a[0] + (b[0] - a[0]) * t; G = a[1] + (b[1] - a[1]) * t; B = a[2] + (b[2] - a[2]) * t;
};

/** Un animal à dessiner : sa raster déjà placée en cellules monde, et ses pieds en px monde. */
export interface Actor {
  id: number;
  r: Raster;
  /** Pieds (px monde) : sert au tri en profondeur, à l'ombre et à l'eau. */
  x: number;
  y: number;
  inWater: boolean;
  /** Profondeur de tri (défaut : y). Un animal en vol passe devant tout le décor. */
  sortY?: number;
  /** Nage sous la surface (mosasaure) : teinté par l'eau, sans reflet ni ombre. */
  submerged?: boolean;
  shadowRx: number;
  /** Œil (px monde), allumé la nuit. */
  eyeX: number;
  eyeY: number;
}

/** Petite bête lumineuse ou colorée (feu follet, papillon). */
export interface Critter {
  x: number;
  y: number;
  seed: number;
}

/** Tout ce qu'il faut pour composer une vue du monde. */
export interface WorldView {
  world: World;
  time: number;
  /** Coin haut-gauche de la vue, en cellules monde. */
  camX: number;
  camY: number;
  /** Centre de la lueur (px monde) : la lanterne de l'observateur. */
  glowX: number;
  glowY: number;
  actors: Actor[];
  critters: Critter[];
  /** Herbe couchée (par cellule monde), facultatif. */
  trample?: Float32Array;
  /** Végétation vivante (Lenia) : là où elle recule, le sol se dénude. Facultatif. */
  veg?: Field;
  /** Plancton de la mer (Orbium de Lenia), bioluminescent la nuit. Facultatif. */
  plankton?: Field;
  /** Animal sélectionné : son contour prend la couleur d'accent. */
  selected?: number;
}

// Calques d'animaux à l'échelle de l'écran, réalloués seulement si la taille change.
let L_N = 0;
let aMat = new Uint8Array(0), aGlyph = new Uint8Array(0), aHalo = new Int16Array(0), aSel = new Uint8Array(0), aSub = new Uint8Array(0);
let aLum = new Float32Array(0), aBase = new Float32Array(0), aShadow = new Float32Array(0);
let rMat = new Uint8Array(0), rGlyph = new Uint8Array(0), rLum = new Float32Array(0);
function layers(n: number) {
  if (n === L_N) return;
  L_N = n;
  aMat = new Uint8Array(n); aGlyph = new Uint8Array(n); aHalo = new Int16Array(n); aSel = new Uint8Array(n); aSub = new Uint8Array(n);
  aLum = new Float32Array(n); aBase = new Float32Array(n); aShadow = new Float32Array(n);
  rMat = new Uint8Array(n); rGlyph = new Uint8Array(n); rLum = new Float32Array(n);
}

/** Pose les animaux dans les calques : tri par la ligne de sol, pattes dans l'eau, reflets, ombres, contours. */
function stampActors(v: WorldView, cols: number, rows: number) {
  const w = v.world;
  aMat.fill(0); aHalo.fill(-1); aShadow.fill(1); rMat.fill(0); aSel.fill(0);
  for (const a of v.actors) {
    const r = a.r;
    const footRow = Math.floor(a.y / CELL_H);
    for (let j = 0; j < r.h; j++) {
      const wy = r.cy + j, sy = wy - v.camY;
      for (let i = 0; i < r.w; i++) {
        const k = j * r.w + i;
        if (!r.mat[k]) continue;
        const wx = r.cx + i, sx = wx - v.camX;
        if (wx < 0 || wy < 0 || wx >= w.cols || wy >= w.rows) continue;
        const terr = w.terrain[wy * w.cols + wx];
        // Reflet dans l'eau, en miroir autour de la ligne des pieds.
        if (a.inWater) {
          const my = 2 * footRow - wy - 1 - v.camY;
          if (my >= 0 && my < rows && sx >= 0 && sx < cols) {
            const mi = my * cols + sx;
            rMat[mi] = r.mat[k]; rLum[mi] = r.lum[k]; rGlyph[mi] = r.glyph[k];
          }
        }
        if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
        // Les pattes s'enfoncent dans l'eau peu profonde.
        if (terr === T.Shallow && wy >= footRow - 1) continue;
        const si = sy * cols + sx;
        // L'animal sélectionné reste repérable même caché (feuillage, autre animal).
        if (a.id === v.selected) aSel[si] = 1;
        const sy2 = a.sortY ?? a.y;
        if (aMat[si] && aBase[si] > sy2) continue;
        aMat[si] = r.mat[k]; aLum[si] = r.lum[k]; aGlyph[si] = r.glyph[k]; aBase[si] = sy2; aSub[si] = a.submerged ? 1 : 0;
      }
    }
    // Ombre au sol.
    if (a.shadowRx <= 0) continue;
    const ry = 18;
    const y0 = Math.floor((a.y - ry) / CELL_H) - v.camY, y1 = Math.ceil((a.y + ry) / CELL_H) - v.camY;
    const x0 = Math.floor((a.x - a.shadowRx) / CELL_W) - v.camX, x1 = Math.ceil((a.x + a.shadowRx) / CELL_W) - v.camX;
    for (let sy = Math.max(0, y0); sy <= Math.min(rows - 1, y1); sy++) {
      for (let sx = Math.max(0, x0); sx <= Math.min(cols - 1, x1); sx++) {
        const dx = ((v.camX + sx + 0.5) * CELL_W - a.x) / a.shadowRx, dy = ((v.camY + sy + 0.5) * CELL_H - a.y + 4) / ry;
        const d = dx * dx + dy * dy;
        if (d < 1) { const si = sy * cols + sx; aShadow[si] = Math.min(aShadow[si], 0.35 + 0.65 * d); }
      }
    }
  }
  // Contours : cellules vides qui touchent un animal. On retient l'animal le plus proche du spectateur.
  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const si = sy * cols + sx;
      if (aMat[si]) continue;
      let best = -1, by = -Infinity;
      for (const n of [si - 1, si + 1, si - cols, si + cols]) {
        if (n < 0 || n >= cols * rows || !aMat[n]) continue;
        if (aBase[n] > by) { by = aBase[n]; best = n; }
      }
      if (best >= 0) { aHalo[si] = best; aBase[si] = by; }
    }
  }
}

// ---------------------------------------------------------------------------
// Vent : feuillage qui ondule, filets de vent
// ---------------------------------------------------------------------------

/** Matières qui bougent au vent (1 = feuillage d'arbre, 2 = petite plante : plus souple). */
const SWAY = new Uint8Array(256);
for (const m of [M.Leaf, M.Moss, F.Needle, F.Araucaria, F.Frond, F.PalmLeaf, F.DryFrond, F.Broadleaf, F.Blossom, F.Ginkgo, F.Cone]) SWAY[m] = 1;
for (const m of [M.Fern, M.Petal, M.PetalAlt, F.Horsetail, F.Fern, F.Herb, F.HerbAlt]) SWAY[m] = 2;

/** Force du vent 0..1 : un souffle de fond et des rafales lentes. */
const gust = (t: number) => 0.45 + 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1);

/**
 * Décalage (en cellules) du feuillage en (wx, wy) : jusqu'à 2 cellules selon la hauteur au-dessus
 * du pied (le haut d'un arbre balance, le tronc reste fixe ; les petites plantes sont plus souples).
 */
function swayShift(w: World, wi: number, wx: number, wy: number, t: number): number {
  const R = Math.sin(t * 1.3 - wx * 0.021 + wy * 0.013) * (0.55 + 0.45 * gust(t)) + 0.25 * gust(t);
  const guess = wi - (R > 0 ? 1 : -1);
  const probe = SWAY[w.decorMat[guess]] ? guess : SWAY[w.decorMat[wi]] ? wi : -1;
  if (probe < 0) return 0;
  const h = w.decorBase[probe] - (wy + 0.5) * CELL_H;
  const amp = SWAY[w.decorMat[probe]] === 2 ? Math.min(1.1, h / 14) : Math.min(2, Math.max(0, (h - 14) / 70));
  return Math.round(R * amp);
}

/** Cellule du décor à lire pour un décalage `k` ; -1 si des feuilles ont quitté cette cellule. */
function swaySource(w: World, wi: number, k: number): number {
  if (k === 0) return wi;
  const src = wi - k;
  if (SWAY[w.decorMat[src]]) return src;
  return SWAY[w.decorMat[wi]] ? -1 : wi;
}

/**
 * Filets de vent : de longues traînées blanches (`~ - .`) qui filent vers la droite, dans le sens où
 * penchent les plantes. Le monde est découpé en couloirs horizontaux ; dans chaque couloir, des
 * traînées régulièrement espacées avancent ensemble (positions dans le monde : elles ne suivent pas
 * la caméra). Plus nombreuses et plus rapides pendant les rafales. Aucune allocation.
 */
const BAND = 20, SPACING = 130;
function windPass(v: WorldView, th: Theme, f: Frame) {
  const t = v.time;
  const { cols, rows } = f;
  const g = gust(t);
  const c = th.pal.specular;
  for (let lane = Math.floor(v.camY / BAND) - 1; lane <= Math.floor((v.camY + rows) / BAND) + 1; lane++) {
    const speed = 34 + hash2(lane, 1, 7) * 16 + g * 30;
    const offset = t * speed + hash2(lane, 2, 7) * 5000;
    const base = offset % SPACING;
    const shift = Math.floor(offset / SPACING);
    for (let k = Math.floor((v.camX - base) / SPACING) - 1; k <= Math.floor((v.camX + cols + 60 - base) / SPACING) + 1; k++) {
      const id = k - shift; // identité stable de la traînée pendant qu'elle avance
      if (hash2(id, lane, 3) > 0.35 + 0.35 * g) continue;
      const head = base + k * SPACING;
      const wy = lane * BAND + Math.floor(hash2(id, lane, 4) * BAND * 0.8);
      const len = 40 + Math.floor(hash2(id, lane, 5) * 50);
      for (let j = 0; j < len; j++) {
        const wx = Math.floor(head - j);
        const yy = wy + Math.round(Math.sin(wx * 0.06 + id) * 1.6);
        const u = j / len;
        // Fondu aux deux bouts, plus marqué pendant les rafales.
        const a = Math.min(0.95, Math.min(1, u * 4) * Math.min(1, (1 - u) * 2.5) * (0.9 + 0.35 * g));
        if (a < 0.08) continue;
        // Deux lignes : le cœur du filet, et un liseré plus pâle juste au-dessus.
        for (let row = 0; row < 2; row++) {
          const x = wx - v.camX, y = yy - row - v.camY;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const i = y * cols + x, kk = i * 4;
          const L = Math.min(1.05, 0.4 + (f.lr[i] + f.lg[i] + f.lb[i]) / 3);
          const aa = row ? a * 0.45 : a;
          // Cœur en traits pleins (= ~), bouts plus légers (- .), liseré pointillé (').
          if (!row || (wx + id) % 3 === 0) f.ch[i] = row ? 39 : u > 0.85 ? 46 : u < 0.08 || u > 0.7 ? 45 : (wx + id) % 3 === 0 ? 126 : 61;
          f.fg[kk] += (c[0] * L - f.fg[kk]) * aa; f.fg[kk + 1] += (c[1] * L - f.fg[kk + 1]) * aa; f.fg[kk + 2] += (c[2] * L - f.fg[kk + 2]) * aa;
          const ab = aa * (row ? 0.25 : 0.6);
          f.bg[kk] += (c[0] * L - f.bg[kk]) * ab; f.bg[kk + 1] += (c[1] * L - f.bg[kk + 1]) * ab; f.bg[kk + 2] += (c[2] * L - f.bg[kk + 2]) * ab;
        }
      }
    }
  }
}

/** Aplats : 3 paliers d'ombrage nets pour le style cartoon. */
const cel = (l: number) => (l < 0.42 ? 0.32 : l < 0.7 ? 0.62 : 0.95);

const lights: PointLight[] = [];

/** Transforme une vue du monde en grille de cellules éclairées (calque monde). */
export function composeWorld(th: Theme, f: Frame, v: WorldView): void {
  const P = th.pal;
  const w = v.world, t = v.time;
  const { cols, rows } = f;
  const cam = { x: v.camX, y: v.camY };
  layers(cols * rows);

  // --- Sources de lumière ---
  lights.length = 0;
  for (const l of w.lights) lights.push({ x: l.x, y: l.y, radius: l.radius, intensity: runePulse(t, l.phase) * 0.7 });
  if (th.critters === "fireflies") {
    for (const ff of v.critters) lights.push({ x: ff.x, y: ff.y, radius: 42, intensity: fireflyPulse(t, ff.seed) * 0.8 });
    for (const a of v.actors) lights.push({ x: a.eyeX, y: a.eyeY, radius: 16, intensity: 0.3 });
  }
  computeLight(f, th, cam.x, cam.y, v.glowX, v.glowY, lights);

  stampActors(v, cols, rows);
  const eyePulse = 0.75 + 0.25 * Math.sin(t * 1.7);
  const mats = th.mats;

  // --- Passe principale : terrain, décor, personnage ---
  for (let y = 0; y < rows; y++) {
    const wy = cam.y + y;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const wx = cam.x + x;
      f.obj[i] = 0;
      if (wx < 0 || wy < 0 || wx >= w.cols || wy >= w.rows) {
        f.ch[i] = 32;
        setFg(f, i, P.void[0], P.void[1], P.void[2]);
        setBg(f, i, P.void[0], P.void[1], P.void[2]);
        continue;
      }
      const wi = wy * w.cols + wx;
      const lr = f.lr[i], lg = f.lg[i], lb = f.lb[i], acc = f.acc[i];
      const L = (lr + lg + lb) / 3;
      const terr = w.terrain[wi];

      // Objet visible : animal ou décor, trié par la ligne de sol.
      let mat = 0, lum = 0, glyph = 0, isHero = false;
      if (aMat[i]) { mat = aMat[i]; lum = aLum[i]; glyph = aGlyph[i]; isHero = true; }
      // Feuillage et fleurs ondulent au vent : on lit le décor un peu à côté (voir swaySource).
      const sk = swayShift(w, wi, wx, wy, t);
      const si = swaySource(w, wi, sk);
      const dm = si >= 0 ? w.decorMat[si] : 0;
      if (dm && (!(isHero || aHalo[i] >= 0) || w.decorBase[si] > aBase[i])) {
        mat = dm; lum = w.decorLum[si]; glyph = w.decorGlyph[si]; isHero = false;
        // Reflet qui court sur le feuillage au passage d'une rafale.
        if (SWAY[dm]) lum = Math.min(1, lum + 0.14 * Math.max(0, Math.sin(wx * 0.045 + wy * 0.02 - t * 1.4)) * gust(t));
      }
      // Animal sélectionné masqué : on voit sa silhouette à travers, en pointillés d'accent.
      if (aSel[i] && !isHero && mat && (wx + wy) % 2 === 0) {
        f.obj[i] = 1;
        f.ch[i] = 43; // +
        const k = 0.65 + 0.35 * Math.sin(t * 4);
        setFg(f, i, P.accent[0] * k, P.accent[1] * k, P.accent[2] * k);
        setBg(f, i, P.ink[0], P.ink[1], P.ink[2]);
        continue;
      }

      if (mat) {
        f.obj[i] = isHero ? 2 : 1;
        const m = mats[mat];
        if (mat === M.Rune) {
          const pulse = runePulse(t, wx * 0.02);
          f.ch[i] = glyph || 124;
          mix(P.runeOff, P.accent, pulse);
          const k = th.cel ? 1 : 0.5 + 0.5 * L;
          setFg(f, i, R * k, G * k, B * k);
          setBg(f, i, P.void[0] + 20 * pulse * L, P.void[1] + 34 * pulse * L, P.void[2] + 18 * pulse * L);
          if (th.cel) setBg(f, i, P.ink[0], P.ink[1], P.ink[2]);
          continue;
        }
        if (m.emissive) {
          f.ch[i] = code(m.ramp, 0);
          const k = eyePulse;
          setFg(f, i, m.color[0] * k, m.color[1] * k, m.color[2] * k);
          setBg(f, i, P.void[0] + 30 * k, P.void[1] + 50 * k, P.void[2] + 26 * k);
          continue;
        }
        if (th.cel) lum = cel(lum);
        // Glyphe : densité selon ombrage x lumière, avec un léger tramage stable.
        const gl = Math.min(0.999, lum * Math.min(1, 0.55 + L * 0.5) + (hash2(wx, wy, 11) - 0.5) * th.dither);
        f.ch[i] = glyph || code(m.ramp, Math.floor(gl * m.ramp.length));
        // Exposition douce : la lueur révèle le sprite sans le brûler.
        const ex = 1.35 / (1 + L * 0.45);
        const shade = (0.22 + 1.05 * lum) * ex;
        const a = acc * 0.8;
        setFg(f, i,
          m.color[0] * shade * lr + P.accent[0] * a * 0.35,
          m.color[1] * shade * lg + P.accent[1] * a * 0.35,
          m.color[2] * shade * lb + P.accent[2] * a * 0.35);
        const bk = th.spriteFill * shade;
        setBg(f, i,
          P.void[0] * (1 - bk) + m.color[0] * bk * lr + P.accent[0] * acc * 0.1,
          P.void[1] * (1 - bk) + m.color[1] * bk * lg + P.accent[1] * acc * 0.1,
          P.void[2] * (1 - bk) + m.color[2] * bk * lb + P.accent[2] * acc * 0.1);
        // Sous la surface : l'eau teinte le corps, et des vaguelettes passent par-dessus.
        if (isHero && aSub[i] && (terr === T.Deep || terr === T.Shallow)) {
          const k = i * 4, wsh = 0.22 + 0.08 * Math.sin(wx * 0.3 + wy * 0.5 + t * 1.6);
          const wc = P.waterMid;
          for (let q = 0; q < 3; q++) { f.fg[k + q] += (wc[q] * 1.6 * L - f.fg[k + q]) * wsh; f.bg[k + q] += (wc[q] * L - f.bg[k + q]) * wsh * 1.5; }
          if (Math.sin(wx * 0.45 + t * 1.1 + Math.sin(wy * 0.8 + t)) > 0.9) { f.ch[i] = 126; setFg(f, i, P.specular[0] * 0.7 * L, P.specular[1] * 0.7 * L, P.specular[2] * 0.7 * L); }
        }
        continue;
      }

      if (terr === T.Shallow || terr === T.Deep) continue; // passe eau

      // Contour d'une cellule autour des animaux (et du décor en cartoon) : ils se détachent du sol.
      const heroEdge = aHalo[i] >= 0;
      // Le contour à l'encre suit le feuillage qui ondule (contour d'un feuillage voisin décalé).
      const hi = sk !== 0 && (SWAY[w.decorMat[wi - sk - 1]] || SWAY[w.decorMat[wi - sk + 1]]) ? wi - sk : wi;
      if (heroEdge || (th.outline && w.decorHalo[hi])) {
        f.ch[i] = 32;
        const sel = heroEdge && v.selected !== undefined && haloOwner(v, aHalo[i], cols) === v.selected;
        const ink = sel ? P.accent : th.outline ? P.ink : P.void;
        const k = sel ? 0.75 : th.outline ? 1 : 0.8;
        setFg(f, i, ink[0], ink[1], ink[2]);
        setBg(f, i, ink[0] * k, ink[1] * k, ink[2] * k);
        continue;
      }

      // Ombre portée : décor (précalculée) + animaux.
      const sh = Math.min(w.shadow[wi], aShadow[i]);
      const sl = sh * L;

      const tone = w.tone[wi], grain = w.grain[wi];
      if (terr === T.Grass) {
        // Couvert du Crétacé : fougères qui ondulent, prêles au bord de l'eau, mousse, fleurettes.
        const cv = w.cover[wi];
        const tr = v.trample ? v.trample[wi] : 0;
        const kind = hash2(wx, wy, 3);
        let c: number, gust = 0;
        let tint: RGB | null = null;
        if (cv === COVER.Moss) {
          // Mousse : immobile, en coussins.
          c = tr > 0.25 ? 46 : code(MOSS, Math.floor(grain * 3.99 + (kind - 0.5)));
          tint = mats[F.Moss].color;
        } else {
          const wind = noise(wx * 0.02 - t * 0.18, wy * 0.035 + t * 0.05);
          const band = Math.sin(wx * 0.045 + wy * 0.02 - t * 0.8);
          gust = smooth(0.55, 1, band) * (0.6 + 0.4 * noise(wx * 0.008 + t * 0.03, wy * 0.01));
          const lean = (hash2(wx, wy, 5) - 0.5) * 0.6 + wind * 0.5 + gust * 1.1;
          const li = lean < -0.35 ? 0 : lean < 0.4 ? 1 : 2;
          if (tr > 0.25) c = kind < 0.5 ? 95 : kind < 0.8 ? 44 : 126; // frondes couchées : _ , ~
          else if (cv === COVER.Horsetail) {
            c = kind < 0.5 ? code(HORSETAIL, li) : kind < 0.72 ? 33 : kind < 0.86 ? 105 : 58; // tiges, ! i :
            tint = mats[F.Horsetail].color;
          } else if (cv === COVER.Herb && kind > 0.86) {
            c = kind > 0.95 ? 111 : 42; // o *
            tint = mats[hash2(wx, wy, 9) < 0.5 ? F.Herb : F.HerbAlt].color;
          } else if (kind < 0.4) c = code(FERN_TALL, li);
          else if (kind < 0.72) c = code(FERN_MID, li);
          else c = kind < 0.88 ? 44 : 34; // , "
        }
        // Végétation vivante : là où elle a reculé (sécheresse) ou été broutée, le sol se dénude,
        // avec un liseré clairsemé à la lisière.
        const vd = v.veg ? sample(v.veg, wx + 0.5, wy + 0.5) : 1;
        const bare = vd < 0.8 && hash2(wx, wy, 13) > vd * 1.25;
        if (bare) { c = kind < 0.55 ? 46 : kind < 0.8 ? 44 : 32; gust = 0; } // . ,
        // Les zones sombres perdent des frondes : le noir respire.
        if (sl < 0.42 && hash2(wx, wy, 8) > sl * 2.1) c = sl < 0.2 ? 32 : 46;
        f.ch[i] = c;
        if (tint) { const tk = 0.8 + 0.4 * tone; R = tint[0] * tk; G = tint[1] * tk; B = tint[2] * tk; }
        else {
          const gi = Math.min(2.999, tone * 3);
          mix(P.grass[Math.floor(gi)], P.grass[Math.floor(gi) + 1], gi - Math.floor(gi));
        }
        // Tondu ras : entre le vert des fougères et la terre.
        if (bare) { const d0 = P.dirt[Math.min(3, Math.floor(tone * 4))]; R += (d0[0] - R) * 0.55; G += (d0[1] - G) * 0.55; B += (d0[2] - B) * 0.55; }
        const gw = gust * 0.55;
        R += (P.grassGust[0] - R) * gw; G += (P.grassGust[1] - G) * gw; B += (P.grassGust[2] - B) * gw;
        const k = (0.7 + 0.6 * grain) * (tr > 0.25 ? 0.55 : 1) * sh * th.grassGain;
        ground(f, i, P, th, R, G, B, k, lr, lg, lb, sl, acc);
      } else {
        const gl = (0.15 + 0.85 * grain) * Math.min(1.1, sl * 1.4);
        f.ch[i] = code(th.dirtRamp, Math.floor(gl * th.dirtRamp.length));
        const c0 = P.dirt[Math.min(3, Math.floor(tone * 4))];
        const k = (0.8 + 0.5 * grain) * sh * th.dirtGain;
        ground(f, i, P, th, c0[0], c0[1], c0[2], k, lr, lg, lb, sl, acc);
      }
    }
  }

  waterPass(v, th, f);
  crittersPass(v, th, f);
  fogPass(v, th, f);
  windPass(v, th, f);
}

/** Quel animal possède la cellule `si` ? (pour colorer le contour de l'animal sélectionné) */
function haloOwner(v: WorldView, si: number, cols: number): number {
  const sx = (si % cols) + v.camX, sy = Math.floor(si / cols) + v.camY;
  for (const a of v.actors) {
    const r = a.r;
    const i = sx - r.cx, j = sy - r.cy;
    if (i >= 0 && j >= 0 && i < r.w && j < r.h && r.mat[j * r.w + i] && Math.abs(aBase[si] - (a.sortY ?? a.y)) < 0.01) return a.id; // aBase est en Float32
  }
  return -1;
}

/** Écrit une cellule de sol : glyphe teinté + fond rempli selon le thème. */
function ground(f: Frame, i: number, P: Palette, th: Theme, r: number, g: number, b: number, k: number,
  lr: number, lg: number, lb: number, sl: number, acc: number) {
  setFg(f, i, r * k * lr + P.accent[0] * acc * 0.3, g * k * lg + P.accent[1] * acc * 0.3, b * k * lb + P.accent[2] * acc * 0.3);
  const fill = th.groundFill * sl;
  setBg(f, i,
    P.void[0] * (1 - fill) + r * fill + P.accent[0] * acc * 0.08,
    P.void[1] * (1 - fill) + g * fill + P.accent[1] * acc * 0.08,
    P.void[2] * (1 - fill) + b * fill + P.accent[2] * acc * 0.08);
}

function runePulse(t: number, phase: number) {
  const s = 0.5 + 0.5 * Math.sin(t * 0.7 + phase);
  return 0.2 + 0.8 * s * s * s;
}

function fireflyPulse(t: number, seed: number) {
  const s = 0.5 + 0.5 * Math.sin(t * 1.6 + seed * 3.1);
  return s * s;
}

function waterPass(v: WorldView, th: Theme, f: Frame) {
  const w = v.world, t = v.time;
  const cam = { x: v.camX, y: v.camY };
  const P = th.pal;
  const { cols, rows } = f;
  const moonX = w.pond.x - w.pond.rx * 0.3;
  const moonTop = w.pond.y - w.pond.ry * 0.75, moonBot = w.pond.y + w.pond.ry * 0.55;
  const flick = Math.floor(t * 5);
  for (let y = 0; y < rows; y++) {
    const wy = cam.y + y;
    if (wy < 0 || wy >= w.rows) continue;
    for (let x = 0; x < cols; x++) {
      const wx = cam.x + x;
      if (wx < 0 || wx >= w.cols) continue;
      const i = y * cols + x;
      const wi = wy * w.cols + wx;
      const terr = w.terrain[wi];
      if ((terr !== T.Shallow && terr !== T.Deep) || f.obj[i]) continue;
      const lr = f.lr[i], lg = f.lg[i], lb = f.lb[i], acc = f.acc[i];
      const L = (lr + lg + lb) / 3;
      const d = w.depth[wi];
      const wave = Math.sin(wx * 0.31 + t * 1.1 + Math.sin(wy * 0.45 + t * 0.6) * 1.6) * 0.55
        + Math.sin(wy * 0.83 - t * 0.9 + wx * 0.11) * 0.45;
      if (d < 0.5) mix(P.waterShore, P.waterMid, d * 2);
      else mix(P.waterMid, P.waterDeep, (d - 0.5) * 2);
      const br = R, bgc = G, bb = B;
      const wv = wave * 0.8 + (1 - d) * 0.35;
      let c = wv > 0.7 ? 61 : wv > 0.35 ? 126 : wv > 0 ? 45 : wv > -0.4 ? 46 : 32; // = ~ - .
      const crest = Math.max(0, wave);
      const k = th.cel ? 1.15 + 0.5 * crest : (1.4 + 1.2 * crest) * 1.6;
      let fr = br * k * lr, fg = bgc * k * lg, fb = bb * k * lb;

      // Rive : écume qui lèche le bord.
      if (w.shore[wi]) {
        const lap = 0.5 + 0.5 * Math.sin(t * 1.4 + wx * 0.25 + wy * 0.4);
        c = lap > 0.62 ? 126 : lap > 0.3 ? 45 : 46;
        fr = (P.waterShore[0] * 2.4 + P.specular[0] * 0.25 * lap) * L;
        fg = (P.waterShore[1] * 2.4 + P.specular[1] * 0.25 * lap) * L;
        fb = (P.waterShore[2] * 2.4 + P.specular[2] * 0.25 * lap) * L;
      }

      // Reflet : les animaux dans l'eau (autour de leurs pieds) ou le décor de la rive (autour de la ligne d'eau).
      const rip = Math.round(Math.sin(wy * 0.9 + t * 1.6) * 0.9);
      let src = -1;
      const ri = x + rip >= 0 && x + rip < cols ? i + rip : i;
      if (rMat[ri] && wave > -0.55) {
        const m = th.mats[rMat[ri]];
        const fade = (th.cel ? 0.6 : 0.42) * (0.75 + 0.25 * crest) * (0.4 + 0.6 * rLum[ri]) * L;
        c = VFLIP_CODE[rGlyph[ri] || code(m.ramp, Math.floor(rLum[ri] * 0.8 * m.ramp.length))];
        fr = m.color[0] * fade * 0.7 + br * 0.3; fg = m.color[1] * fade * 0.85 + bgc * 0.3; fb = m.color[2] * fade * 1.1 + bb * 0.3;
        src = -2;
      }
      if (src === -1) {
        const top = w.surfTop[wi];
        const mr = 2 * top - 1 - wy;
        const sy = mr - cam.y, sx = x + rip;
        if (wy - top < 40 && sy >= 0 && sy < rows && sx >= 0 && sx < cols && f.obj[sy * cols + sx]) src = sy * cols + sx;
      }
      if (src >= 0 && wave > -0.55) {
        const sk = src * 4;
        const fade = (th.cel ? 0.6 : 0.42) * (0.75 + 0.25 * crest);
        c = VFLIP_CODE[f.ch[src]];
        fr = f.fg[sk] * fade * 0.7 + br * 0.3; fg = f.fg[sk + 1] * fade * 0.85 + bgc * 0.3; fb = f.fg[sk + 2] * fade * 1.1 + bb * 0.3;
      }

      if (th.water === "moon") {
        // Reflet de lune : traînée verticale brisée en tirets qui scintillent.
        const py = (wy + 0.5) * CELL_H;
        if (py > moonTop && py < moonBot) {
          const u = (py - moonTop) / (moonBot - moonTop);
          const half = 30 + 70 * u + Math.sin(wy * 1.3 + t) * 8;
          const dx = Math.abs((wx + 0.5) * CELL_W - moonX + Math.sin(wy * 0.7 + t * 1.2) * 6);
          if (dx < half && Math.sin(wy * 2.1 + t * 1.7 + wx * 0.15) > 0.05 && hash2(wx, wy, flick) > 0.15 + 0.6 * (dx / half)) {
            c = dx < half * 0.4 ? 61 : 45;
            const mk = (1 - dx / half) * (1 - u * 0.6) * (0.7 + 0.3 * L);
            fr = P.specular[0] * (0.35 + 0.65 * mk); fg = P.specular[1] * (0.35 + 0.65 * mk); fb = P.specular[2] * (0.35 + 0.65 * mk);
          }
        }
      } else if (crest > 0.55 && hash2(wx, wy, Math.floor(t * 2.5 + hash2(wx, wy, 4) * 9)) > 0.93) {
        // Éclats de soleil qui pétillent sur les crêtes.
        c = hash2(wx, wy, 6) < 0.5 ? 42 : 43; // * +
        fr = P.specular[0]; fg = P.specular[1]; fb = P.specular[2];
      }

      // Remous autour des animaux dans l'eau peu profonde.
      for (const a of v.actors) {
        if (!a.inWater) continue;
        const px = (wx + 0.5) * CELL_W, py = (wy + 0.5) * CELL_H;
        if (Math.abs(px - a.x) > a.shadowRx + 40 || Math.abs(py - a.y) > 30) continue;
        for (const ox of [a.x - a.shadowRx * 0.5, a.x + a.shadowRx * 0.5]) {
          const dd = Math.hypot(px - ox, (py - a.y) * 2.4);
          const ringR = (t * 24 + ox * 0.37) % 34 + 6;
          if (Math.abs(dd - ringR) < 3.2 && py >= a.y - CELL_H) {
            const fade = 1 - ringR / 40;
            c = Math.abs(px - ox) > dd * 0.7 ? (px < ox ? 40 : 41) : 126; // ( ) ~
            const rk = (0.3 + 0.5 * fade) * L * (th.cel ? 1.6 : 1);
            fr = P.specular[0] * rk; fg = P.specular[1] * rk; fb = P.specular[2] * rk;
          }
        }
      }

      // Plancton : les nuées d'Orbium scintillent au large ; la nuit, elles s'illuminent.
      if (v.plankton && terr === T.Deep && src === -1) {
        const pd = sample(v.plankton, wx + 0.5, wy + 0.5);
        if (pd > 0.08 && hash2(wx, wy, Math.floor(t * 1.5 + hash2(wx, wy, 7) * 5)) < pd * 1.4) {
          c = code(PLANKTON, Math.floor(pd * PLANKTON.length));
          const g = Math.min(1, pd * (0.45 + 1.1 * (1 - L)));
          fr += (GLOW[0] - fr) * g; fg += (GLOW[1] - fg) * g; fb += (GLOW[2] - fb) * g;
        }
      }

      f.ch[i] = c;
      setFg(f, i, fr + P.accent[0] * acc * 0.35, fg + P.accent[1] * acc * 0.35, fb + P.accent[2] * acc * 0.35);
      const bk = (th.cel ? 0.85 : 0.55) + 0.2 * crest;
      setBg(f, i,
        P.void[0] + (br - P.void[0]) * bk * L + P.accent[0] * acc * 0.12,
        P.void[1] + (bgc - P.void[1]) * bk * L + P.accent[1] * acc * 0.12,
        P.void[2] + (bb - P.void[2]) * bk * L + P.accent[2] * acc * 0.12);
    }
  }
}

/** Feux follets (dark) ou papillons (cartoon). */
function crittersPass(v: WorldView, th: Theme, f: Frame) {
  const P = th.pal, t = v.time;
  const cam = { x: v.camX, y: v.camY };
  for (let n = 0; n < v.critters.length; n++) {
    const ff = v.critters[n];
    const x = Math.floor(ff.x / CELL_W) - cam.x, y = Math.floor(ff.y / CELL_H) - cam.y;
    if (x < 1 || y < 1 || x >= f.cols - 1 || y >= f.rows - 1) continue;
    const i = y * f.cols + x;
    if (th.critters === "fireflies") {
      const pl = fireflyPulse(t, ff.seed);
      f.ch[i] = pl > 0.75 ? 42 : pl > 0.45 ? 43 : pl > 0.2 ? 39 : 46; // * + ' .
      const k = 0.35 + 0.75 * pl;
      setFg(f, i, P.accent[0] * k, P.accent[1] * k, P.accent[2] * k);
    } else {
      // Papillon : deux ailes qui battent autour d'un corps.
      const col = P.critters[n % P.critters.length];
      const open = Math.sin(t * 14 + ff.seed * 5) > 0;
      const wings: [number, number][] = open ? [[-1, 0], [1, 0]] : [[0, 0]];
      for (const [dx] of wings) {
        const j = i + dx;
        f.ch[j] = dx < 0 ? 40 : dx > 0 ? 41 : 124; // ( ) |
        setFg(f, j, col[0], col[1], col[2]);
      }
      if (open) { f.ch[i] = 39; setFg(f, i, P.ink[0], P.ink[1], P.ink[2]); }
    }
  }
}

/** Brume pâle (dark) ou ombres de nuages qui glissent sur le sol (cartoon). */
function fogPass(v: WorldView, th: Theme, f: Frame) {
  const t = v.time, w = v.world;
  const cam = { x: v.camX, y: v.camY };
  const P = th.pal;
  const { cols, rows } = f;
  const clouds = th.fog === "clouds";
  for (let y = 0; y < rows; y++) {
    const wy = cam.y + y;
    for (let x = 0; x < cols; x++) {
      const wx = cam.x + x;
      if (wx < 0 || wy < 0 || wx >= w.cols || wy >= w.rows) continue;
      const n = noise(wx * 0.011 + t * 0.022, wy * 0.024 - t * 0.01) * 0.65 + noise(wx * 0.03 - t * 0.035, wy * 0.06 + t * 0.01) * 0.35;
      const i = y * cols + x;
      const k = i * 4;
      if (clouds) {
        const a = smooth(0.3, 0.55, n) * 0.28;
        if (a < 0.01) continue;
        for (let c = 0; c < 3; c++) { f.fg[k + c] *= 1 - a; f.bg[k + c] *= 1 - a; }
        continue;
      }
      const fog = smooth(0.25, 0.9, n) * 0.4;
      if (fog < 0.02) continue;
      const L = (f.lr[i] + f.lg[i] + f.lb[i]) / 3;
      const a = fog * Math.min(1, L * 1.3);
      f.bg[k] += (P.mistBg[0] - P.void[0]) * a;
      f.bg[k + 1] += (P.mistBg[1] - P.void[1]) * a;
      f.bg[k + 2] += (P.mistBg[2] - P.void[2]) * a;
      const mfr = P.mistFg[0] * L, mfg = P.mistFg[1] * L, mfb = P.mistFg[2] * L;
      f.fg[k] += (mfr - f.fg[k]) * a * 0.6;
      f.fg[k + 1] += (mfg - f.fg[k + 1]) * a * 0.6;
      f.fg[k + 2] += (mfb - f.fg[k + 2]) * a * 0.6;
      if (!f.obj[i] && hash2(wx, wy, 21) < fog * 0.45) {
        f.ch[i] = hash2(wx, wy, 22) < 0.7 ? 46 : 58; // . :
        f.fg[k] = mfr * 0.9; f.fg[k + 1] = mfg * 0.9; f.fg[k + 2] = mfb * 0.9;
      }
    }
  }
}

export function drawText(f: Frame, P: Palette, x: number, y: number, text: string, color: RGB = P.text, bg: RGB = P.void) {
  for (let j = 0; j < text.length; j++) {
    if (x + j < 0 || x + j >= f.cols || y < 0 || y >= f.rows) continue;
    const i = y * f.cols + x + j;
    f.ch[i] = text.charCodeAt(j);
    setFg(f, i, color[0], color[1], color[2]);
    setBg(f, i, bg[0], bg[1], bg[2]);
  }
}
