import { CELL_H, CELL_W, WORLD_H, WORLD_W } from "../config";
import { addAt } from "../features/lenia";
import type { RGB } from "../palette";
import { emptyProgress, saveProgress } from "../progress";
import { createFrame, setBg, setFg, type Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { hash2 } from "../rng";
import { calm } from "../settings";
import { worldFor, type GameState } from "../state";
import { resetUi, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { knockTree, regrowAll } from "../world/trees";
import { drawSpace, SPACE_DURATION } from "./meteor-space";
import { createDigState } from "./dig";
import { createJournalState } from "./journal";
import { createLabState } from "./lab";
import { createParkState, parkScene, syncPopulation } from "./park";
import type { Scene } from "./types";

/**
 * « Tout recommencer » : la météorite de Chicxulub.
 * 1. Dans l'espace : la Terre du Crétacé, la météorite fonce dessus, impact (meteor-space.ts).
 * 2. Dans la réserve : le ciel rougeoie, des débris tombent, l'onde de choc couche arbres et
 *    dinosaures, la poussière cache le soleil, le noir.
 * 3. La progression est effacée ; la lumière revient, la forêt repousse : tout recommence.
 */

/** Chronologie de la réserve (s depuis la fin de la séquence spatiale). */
const T = { debris: 0.8, shock: 2.2, dust: 5.5, black: 8, reset: 8.6, dawn: 9.2, end: 15 };

export interface MeteorState {
  t: number;
  /** Origine de l'onde de choc (px monde, hors écran) et rayon courant. */
  ox: number;
  oy: number;
  done: boolean;
}

let m: MeteorState = { t: 0, ox: 0, oy: 0, done: false };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Efface toute la progression et repeuple une réserve vide (les arbres repoussent vite). */
function resetAll(s: GameState) {
  s.progress = emptyProgress();
  saveProgress(s.progress);
  try {
    localStorage.removeItem("ascii-dino-journal-seen-v1");
  } catch {
    // Stockage indisponible : rien à effacer.
  }
  // Fouille, atelier et carnet repartent de zéro : nouveau site, établi vide.
  s.dig = createDigState();
  s.lab = createLabState();
  s.journal = createJournalState();
  const keep = { cam: { ...s.park.cam }, regrow: 2 };
  s.park = { ...createParkState(), ...keep };
  parkScene.enter?.(s);
  s.park.regrow = 2;
  regrowAll(worldFor(s));
  syncPopulation(s);
}

export const meteorScene: Scene = {
  enter(s) {
    m = { t: 0, ox: 0, oy: 0, done: false };
    // Préchauffe les textures de la séquence spatiale (~90 ms la première fois) avant le premier dessin.
    drawSpace(createFrame(metrics.cols, metrics.rows), 0);
    // La réserve doit être prête (monde, animaux) pour la deuxième partie.
    parkScene.enter?.(s);
    s.park.follow = false;
    s.park.selected = undefined;
  },

  update(s, input, dt) {
    m.t += dt;
    const tp = m.t - SPACE_DURATION;
    // Échap : passer la cinématique (la remise à zéro a quand même lieu).
    if (input.pressed.includes("Escape") && !m.done) { m.t = SPACE_DURATION + T.reset - 0.01; }
    if (tp < 0) return;
    const p = s.park;
    if (m.ox === 0) {
      // L'impact a lieu loin vers le haut à droite de ce que l'on regarde.
      m.ox = p.cam.x + metrics.cols * CELL_W * 1.4;
      m.oy = p.cam.y - metrics.rows * CELL_H * 0.6;
    }
    const w = worldFor(s);
    // L'onde de choc balaie la réserve : arbres couchés, dinosaures renversés.
    if (tp > T.shock && tp < T.black) {
      const r = (tp - T.shock) * 3300; // la grande carte : le souffle la traverse entière
      for (const t of w.trees) {
        if (t.state !== "up" || Math.abs(t.x - m.ox) > r + 100) continue;
        if (Math.hypot(t.x - m.ox, (t.y - m.oy) * 1.2) < r) knockTree(w, t, t.x >= m.ox ? 1 : -1);
      }
      for (const a of p.animals) {
        if (a.task === "dead" || Math.hypot(a.x - m.ox, (a.y - m.oy) * 1.2) > r) continue;
        a.task = "dead"; a.action = "dead"; a.actionT = 0; a.moving = 0; a.decay = 999; a.meat = 0;
      }
      // Le souffle brûle la végétation (en cases de 32 px de large).
      if (p.eco) addAt(p.eco.veg, m.ox, m.oy, r / 32, -2);
    }
    // Secousses pendant le passage de l'onde.
    // Secousses (aucune si les animations sont réduites).
    const shake = !calm() && tp > T.shock && tp < T.dust + 1 ? (1 - clamp01((tp - T.shock) / 4)) * 14 : 0;
    p.cam.x += (Math.random() - 0.5) * shake;
    p.cam.y += (Math.random() - 0.5) * shake * 0.6;
    p.cam.x = Math.max(0, Math.min(WORLD_W - metrics.cols * CELL_W, p.cam.x));
    p.cam.y = Math.max(0, Math.min(WORLD_H - metrics.rows * CELL_H, p.cam.y));
    if (tp >= T.reset && !m.done) { m.done = true; resetAll(s); }
    // La vie de la réserve continue (sans interaction) : chute des arbres, repousse.
    const quiet = { ...input, dx: 0, dy: 0, pressed: [], ui: [], worldClicks: [], mouse: { ...input.mouse, down: false, clicks: [], wheel: 0, dragX: 0, dragY: 0 } };
    parkScene.update(s, quiet, dt);
    if (tp >= T.end) {
      s.park.regrow = 1;
      s.mode = "park";
      toast(s, "Tout recommence !", "66 millions d'annees plus tard, les fossiles attendent d'etre decouverts. Bonne fouille !");
    }
  },

  compose(s, th, world, ui) {
    const tp = m.t - SPACE_DURATION;
    if (tp < 0) {
      drawSpace(world, Math.min(SPACE_DURATION, m.t));
      resetUi(ui);
      caption(ui, [225, 220, 205], "Echap : passer");
      return;
    }
    parkScene.compose(s, th, world, ui);
    resetUi(ui);
    overlay(s, world, tp);
    if (tp > T.dawn + 1 && tp < T.end) caption(ui, [255, 255, 255], "66 millions d'annees plus tard... la vie reprend ses droits.", true);
    else if (tp > T.shock && tp < T.black) caption(ui, [255, 230, 200], "L'onde de choc balaie Hell Creek. La poussiere va cacher le soleil pendant des annees.", true);
    if (!m.done) caption(ui, [225, 220, 205], "Echap : passer");
  },
};

/** Texte centré en bas (calque d'interface), sur un fond sombre pour rester lisible sur le blanc ; coupé en lignes si besoin. */
function caption(ui: Frame, c: RGB, str: string, big = false) {
  const lines = wrap(str, ui.cols - 4);
  const y = ui.rows - (big ? 4 : 2) - (lines.length - 1);
  lines.forEach((l, i) => text(ui, Math.floor((ui.cols - l.length) / 2), y + i, l, c, [0, 0, 0], 0.55));
}

/** Effets de la catastrophe par-dessus la réserve : ciel en feu, débris, onde, poussière, noir, aube. */
function overlay(s: GameState, f: Frame, tp: number) {
  const { cols, rows } = f;
  const fire: RGB = [255, 110, 40], dust: RGB = [92, 70, 58];
  // Intensités au cours du temps.
  // Sortie du blanc de la séquence spatiale (plus lente si les animations sont réduites).
  const still = calm();
  const white = 1 - clamp01(tp / (still ? 2 : 0.9));
  const glow = clamp01((tp - 0.3) / 1.5) * (1 - clamp01((tp - T.dust) / 2));
  const dusty = clamp01((tp - T.dust + 1.5) / 2.5) * (1 - clamp01((tp - T.dawn) / 4));
  const dark = clamp01((tp - T.black + 1.2) / 1.2) * (1 - clamp01((tp - T.dawn) / 1.6));
  const shockR = (tp - T.shock) * 3300;
  const camX = Math.floor(s.park.cam.x / CELL_W), camY = Math.floor(s.park.cam.y / CELL_H);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, k = i * 4;
      let r = f.fg[k], g = f.fg[k + 1], b = f.fg[k + 2];
      let br = f.bg[k], bg = f.bg[k + 1], bb = f.bg[k + 2];
      // Ciel en feu : plus fort du côté de l'impact (en haut à droite).
      const side = clamp01((x / cols) * 0.7 + (1 - y / rows) * 0.5);
      // Le ciel en feu vacille (bouffées de chaleur).
      const flick = still ? 0.9 : 0.85 + 0.15 * Math.sin(tp * 9 + x * 0.05 + y * 0.08);
      const gl = glow * (0.45 + 0.55 * side) * flick;
      r += (fire[0] - r) * gl * 0.7; g += (fire[1] - g) * gl * 0.55; b += (fire[2] - b) * gl * 0.5;
      br += (fire[0] * 0.55 - br) * gl * 0.65; bg += (fire[1] * 0.35 - bg) * gl * 0.65; bb += (fire[2] * 0.25 - bb) * gl * 0.6;
      // Front de l'onde de choc : une bande brûlante qui avance.
      if (tp > T.shock && tp < T.black) {
        const px = (camX + x + 0.5) * CELL_W, py = (camY + y + 0.5) * CELL_H;
        const d = Math.hypot(px - m.ox, (py - m.oy) * 1.2) - shockR;
        if (d > -60 && d < 0) {
          const a = 1 + d / 60;
          f.ch[i] = a > 0.7 ? 35 : a > 0.4 ? 42 : 43; // # * +
          r = 255; g = 200 * a + 55; b = 120 * a;
          br += (255 - br) * a * 0.5; bg += (120 - bg) * a * 0.5; bb += (40 - bb) * a * 0.3;
        } else if (d < -60 && d > -400 && hash2(x, y, Math.floor(tp * 12)) < 0.05 * (1 + d / 400)) {
          // Braises derrière le front.
          f.ch[i] = 39; r = 255; g = 150; b = 60;
        }
      }
      // Poussière et cendres : tout se voile de brun, des cendres tombent.
      if (dusty > 0) {
        r += (dust[0] - r) * dusty * 0.75; g += (dust[1] - g) * dusty * 0.75; b += (dust[2] - b) * dusty * 0.75;
        br += (dust[0] * 0.6 - br) * dusty * 0.8; bg += (dust[1] * 0.6 - bg) * dusty * 0.8; bb += (dust[2] * 0.6 - bb) * dusty * 0.8;
        if (hash2(x, (y - Math.floor(tp * 9)) | 0, 3) < 0.03 * dusty) { f.ch[i] = 46; r = 200; g = 190; b = 180; }
      }
      // Noir, puis aube.
      const keep = 1 - dark;
      r *= keep; g *= keep; b *= keep; br *= keep; bg *= keep; bb *= keep;
      // Flash blanc au tout début (on sort du blanc de la séquence spatiale).
      if (white > 0) { r += (255 - r) * white; g += (255 - g) * white; b += (255 - b) * white; br += (255 - br) * white; bg += (255 - bg) * white; bb += (255 - bb) * white; }
      setFg(f, i, r, g, b);
      setBg(f, i, br, bg, bb);
    }
  }

  // Boules de feu : des débris incandescents traversent le ciel en diagonale et explosent au sol.
  if (tp > T.debris && tp < T.dust + 1.5) {
    for (let k = 0; k < 34; k++) {
      const period = 1.6 + hash2(k, 1, 9) * 1.4;
      const life = ((tp - T.debris) / period + hash2(k, 2, 9)) % 1;
      // Point d'arrivée dans l'écran, départ en haut à droite (hors champ).
      const ex = hash2(k, 3, 9) * cols, ey = rows * (0.25 + hash2(k, 4, 9) * 0.7);
      const sx = ex + cols * 0.55, sy = ey - rows * 1.1;
      if (life < 0.85) {
        const u = life / 0.85;
        const hx = sx + (ex - sx) * u, hy = sy + (ey - sy) * u;
        const ux = (ex - sx) / Math.hypot(ex - sx, ey - sy), uy = (ey - sy) / Math.hypot(ex - sx, ey - sy);
        for (let j = 0; j < 22; j++) {
          const a = 1 - j / 22;
          for (const off of [-1, 0, 1]) {
            if (off && j > 10) continue; // traînée épaisse près de la tête, fine au bout
            const x = Math.round(hx - ux * j * 1.6 + (off ? -uy * 1.2 * off : 0)), y = Math.round(hy - uy * j * 0.9 + (off ? ux * 0.7 * off : 0));
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
            const i = y * cols + x;
            f.ch[i] = j === 0 && !off ? 64 : j < 4 ? 42 : j < 11 ? 43 : 39; // @ * + '
            setFg(f, i, 255, 140 + 115 * a, 40 + 160 * a * a);
            if (j < 6) setBg(f, i, 200 * a, 70 * a, 10);
          }
        }
      } else {
        // Explosion au sol : un cercle de flammes qui s'élargit puis retombe.
        const u = (life - 0.85) / 0.15;
        const R = 2 + u * 9;
        for (let dy = -Math.ceil(R * 0.6); dy <= Math.ceil(R * 0.6); dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
          const d = Math.hypot(dx / R, dy / (R * 0.6));
          if (d > 1) continue;
          const x = Math.round(ex + dx), y = Math.round(ey + dy);
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const i = y * cols + x;
          const a = (1 - u) * (1 - d * 0.6);
          if (hash2(x, y, k) > a + 0.2) continue;
          f.ch[i] = d < 0.4 ? 35 : d < 0.75 ? 42 : 39; // # * '
          setFg(f, i, 255, 120 + 120 * (1 - d), 40 * (1 - d));
          setBg(f, i, 160 * a, 50 * a, 10 * a);
        }
      }
    }
  }
}
