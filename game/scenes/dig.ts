import { DEV } from "../config";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import { addBone, saveProgress } from "../progress";
import { setBg, setFg, type Frame } from "../render/frame";
import { M } from "../render/materials";
import { metrics, uiCellAt } from "../render/metrics";
import { hash2 } from "../rng";
import { SPECIES } from "../species";
import type { GameState } from "../state";
import { bar, button, hitAt, panel, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { deName, EXTRA_BY_ID } from "./dig-fossils";
import { buildBackdrop, generateSite, hardness, MATRIX_INFO, SUB, type Backdrop, type Fossil, type Site } from "./dig-site";
import { SM } from "./scenes.mat";
import { UI_TOP, type Scene } from "./types";

/**
 * Fouille : on dégage des os dans une coupe de falaise stratifiée (calque monde, cellules 4x7 px).
 * Pinceau lent et sûr, burin rapide mais dangereux pour les os, loupe qui trahit les formes cachées.
 * Un fossile dégagé à 60 % part tout seul sous plâtre vers l'atelier.
 */

export type Tool = "brush" | "pick" | "loupe";

interface Dust { x: number; y: number; vx: number; vy: number; life: number; ch: number; mat: number }

export interface DigState {
  site: Site | null;
  tool: Tool;
  dust: Dust[];
  /** Le geste en cours creuse (faux s'il a commencé sur l'interface ou sur un fossile prêt). */
  digging: boolean;
  /** Dernière position creusée (cellules du site), pour creuser le long du trajet. */
  last: { x: number; y: number } | null;
  /** Fossile dont on montre l'état (dernier touché ou survolé), -1 sinon. */
  focus: number;
  /** Position de la souris dans le site (cellules, flottant). */
  hover: { x: number; y: number } | null;
  tip: number;
  tipT: number;
  /** Instant du dernier coup de burin sur un os (tremblement). */
  shake: number;
  hint: { text: string; t: number } | null;
  backdrop: Backdrop | null;
}

export function createDigState(): DigState {
  return { site: null, tool: "brush", dust: [], digging: false, last: null, focus: -1, hover: null, tip: 0, tipT: 0, shake: -9, hint: null, backdrop: null };
}

const TOOLS: Record<Tool, { name: string; key: string; code: string; rx: number; ry: number; rate: number; desc: string }> = {
  brush: { name: "Pinceau", key: "E", code: "KeyE", rx: 7, ry: 4, rate: 10, desc: "Lent mais sans danger : parfait tout pres des os." },
  pick: { name: "Burin", key: "R", code: "KeyR", rx: 8, ry: 4.5, rate: 22, desc: "Rapide dans la roche dure... mais il casse les os qu'il touche !" },
  loupe: { name: "Loupe", key: "F", code: "KeyF", rx: 15, ry: 8.5, rate: 0, desc: "Revele la forme des fossiles caches sous la roche, autour du curseur." },
};
const TOOL_ORDER: Tool[] = ["brush", "pick", "loupe"];

const TIPS = [
  "Les paleontologues commencent au burin dans la roche dure, puis finissent au pinceau tout pres des os.",
  "Avant de sortir un os, on le dessine et on le photographie : c'est la carte du site.",
  "Le quadrillage de ficelle sert a noter la position exacte de chaque os, case par case.",
  "Les gros os voyagent dans une coque de platre, comme un bras dans le platre.",
  "Chaque couche de roche est une page d'histoire : plus elle est profonde, plus elle est ancienne.",
  "Un fossile, c'est un os ou la roche a remplace la matiere, petit a petit, en des millions d'annees.",
  "Les os se fossilisent surtout s'ils sont vite recouverts de sable ou de boue, a l'abri de l'air.",
  "A Hell Creek, on trouve les derniers dinosaures, juste avant la chute de la grande meteorite.",
];

const LEFT_W = 27, RIGHT_W = 34;

/** Zone du site sur le calque monde (cellules), selon la taille de l'écran. */
function layout(site: Site | null) {
  const { cols, rows, uiW, uiH, cellW, cellH, ucols } = metrics;
  const left = Math.ceil(((LEFT_W + 2) * uiW) / cellW) + 2;
  const right = Math.floor(((ucols - RIGHT_W - 2) * uiW) / cellW) - 2;
  const top = Math.ceil((uiH * (UI_TOP - 0.6)) / cellH);
  const bottom = Math.ceil((uiH * 1.6) / cellH) + 1;
  const W = site?.W ?? Math.max(90, Math.min(240, right - left));
  const H = site?.H ?? Math.max(45, Math.min(110, rows - top - bottom - 10));
  const gTop = site?.gTop ?? 5;
  const ox = left + Math.floor((right - left - W) / 2);
  const oy = Math.max(top + 4 + gTop, rows - bottom - H);
  return { W, H, ox, oy, cols };
}

/** Cellule monde du coin haut-gauche du site (outils d'aperçu, tests). */
export function digOrigin(s: GameState): { ox: number; oy: number } {
  const L = layout(s.dig.site);
  return { ox: L.ox, oy: L.oy };
}

function ensureSite(s: GameState): Site | null {
  const d = s.dig;
  if (!d.site && metrics.cols > 20) {
    const L = layout(null);
    d.site = generateSite(s.progress, L.W, L.H, (Math.random() * 1e9) | 0);
    d.dust = []; d.focus = -1; d.backdrop = null;
  }
  return d.site;
}

/** Part d'un fossile à dégager avant qu'il parte au laboratoire. */
const READY = 0.6;
const ready = (f: Fossil) => f.state === "buried" && f.exposed >= f.cells * READY;

function fossilAt(site: Site, x: number, y: number): Fossil | undefined {
  const i = Math.floor(x), j = Math.floor(y);
  // Petite tolérance : viser un os fin (côte) doit rester facile.
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) {
    const xi = i + dx, yj = j + dy;
    if (xi < 0 || yj < 0 || xi >= site.W || yj >= site.H) continue;
    const o = site.owner[yj * site.W + xi];
    if (o >= 0) return site.fossils[o];
  }
  return undefined;
}

function breakFossil(s: GameState, site: Site, f: Fossil) {
  f.state = "broken";
  f.t0 = s.time;
  const what = f.kind === "bone" ? "l'os s'est brise" : "le fossile s'est brise";
  toast(s, `Oh non, ${what} !`, "Le burin tape trop fort. Tout pres d'un os, prends le pinceau (touche E).");
  checkComplete(s, site);
}

function checkComplete(s: GameState, site: Site) {
  if (site.complete) return;
  if (site.fossils.some((f) => f.kind === "bone" && (f.state === "buried" || f.state === "lifting"))) return;
  site.complete = true;
  s.progress.digs++;
  saveProgress(s.progress);
  toast(s, "Site termine !", "Bravo ! Clique sur << Site suivant >> pour explorer une nouvelle falaise.");
}

/** Le fossile arrive au camp : on l'ajoute à la collection. */
function reward(s: GameState, f: Fossil) {
  const p = s.progress;
  if (f.kind === "extra") {
    const def = EXTRA_BY_ID[f.id];
    if (!p.extras.includes(f.id)) {
      p.extras.push(f.id);
      saveProgress(p);
      toast(s, `Fossile bonus : ${f.label}`, def?.fact ?? "");
    } else toast(s, `Encore un : ${f.label}`, "Deja dans ta collection, mais toujours aussi beau.");
    return;
  }
  const spec = f.sp ? SPECIES[f.sp] : undefined;
  if (!f.sp || !spec) return;
  const isNew = addBone(p, f.sp, f.id);
  const have = p.bones[f.sp]?.length ?? 0, need = spec.bones.length;
  if (!isNew) toast(s, `Os trouve : ${f.label}`, "Deja dans la collection : il rejoint les reserves du musee.");
  else if (have >= need) toast(s, `Os trouve : ${f.label}`, `Squelette complet ! Va l'assembler a l'atelier (touche 2).`);
  else toast(s, `Os trouve : ${f.label}`, `${have}/${need} os ${deName(spec.name)}. Il t'attend a l'atelier.`);
}

function collect(s: GameState, f: Fossil) {
  f.state = "lifting";
  f.t0 = s.time;
}

/** Mode test : dégage d'un coup tous les fossiles du site et les récolte. */
function revealAll(s: GameState, site: Site) {
  const { cover, owner, fossils } = site;
  for (let k = 0; k < cover.length; k++) {
    const o = owner[k];
    if (o >= 0 && fossils[o].state === "buried" && cover[k] > 0) { cover[k] = 0; fossils[o].exposed++; }
  }
  for (const f of fossils) if (ready(f)) collect(s, f);
}

/** Un coup d'outil centré en (cx, cy), cellules du site. */
function stamp(s: GameState, site: Site, cx: number, cy: number, tool: Tool, dt: number) {
  const T = TOOLS[tool];
  const d = s.dig;
  const { W, H, cover, owner, fossils } = site;
  const hits = new Map<number, number>();
  for (let y = Math.max(0, Math.floor(cy - T.ry)); y <= Math.min(H - 1, Math.ceil(cy + T.ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - T.rx)); x <= Math.min(W - 1, Math.ceil(cx + T.rx)); x++) {
      const ex = (x + 0.5 - cx) / T.rx, ey = (y + 0.5 - cy) / T.ry;
      const e = ex * ex + ey * ey;
      if (e >= 1) continue;
      const k = y * W + x;
      const o = owner[k];
      const f = o >= 0 ? fossils[o] : undefined;
      if (f && f.state !== "buried") continue;
      const c = cover[k];
      if (f) {
        d.focus = o;
        if (tool === "pick" && c < 0.35) hits.set(o, (hits.get(o) ?? 0) + 1);
      }
      if (c <= 0) continue;
      const amt = (T.rate * dt * (1 - e * 0.6)) / hardness(site, k);
      let nc = c - amt;
      if (nc < 0.04) nc = 0;
      cover[k] = nc;
      if (f && nc === 0) f.exposed++;
      if (d.dust.length < 400 && Math.random() < amt * (tool === "pick" ? 0.5 : 1.2)) {
        const st = site.strata[site.layer[k]];
        d.dust.push({
          x: x + 0.5, y: y + 0.5, vx: (Math.random() - 0.5) * (tool === "pick" ? 26 : 10), vy: -Math.random() * (tool === "pick" ? 16 : 6),
          life: 0.5 + Math.random() * 0.7, ch: tool === "pick" ? (Math.random() < 0.5 ? 111 : 59) : Math.random() < 0.5 ? 46 : 39,
          mat: c > SUB ? (site.deco[k] === 1 ? SM.Pebble : st.mat) : SM.Matrix,
        });
      }
    }
  }
  for (const [o, n] of hits) {
    const f = fossils[o];
    f.integrity -= dt * 1.1 * Math.min(1, n / 5);
    d.shake = s.time;
    if (!f.warned && f.integrity < 0.8) {
      f.warned = true;
      toast(s, "Attention, le burin abime l'os !", "Pres des fossiles, passe au pinceau (touche E) : plus lent, mais sans danger.");
    }
    if (f.integrity <= 0) breakFossil(s, site, f);
  }
}

function nextSite(s: GameState) {
  s.dig.site = null;
  ensureSite(s);
}

export const digScene: Scene = {
  update(s, input: Input, dt) {
    const d = s.dig;
    const site = ensureSite(s);
    if (!site) return;
    const L = layout(site);

    const tryCollect = () => {
      const f = site.fossils.find(ready);
      if (f) collect(s, f);
      else if (site.complete) nextSite(s);
    };
    for (const k of input.pressed) {
      for (const t of TOOL_ORDER) if (k === TOOLS[t].code) d.tool = t;
      if (k === "Tab" || k === "Space") d.tool = TOOL_ORDER[(TOOL_ORDER.indexOf(d.tool) + 1) % TOOL_ORDER.length];
      if (k === "Enter") tryCollect();
    }
    for (const id of input.ui) {
      if (id.startsWith("dig:tool:")) d.tool = id.slice(9) as Tool;
      if (id === "dig:next" && site.complete) { nextSite(s); return; }
      if (id === "dig:collect") tryCollect();
      if (id === "dig:reveal") revealAll(s, site);
    }

    // Souris -> cellules du site.
    const toSite = (px: number, py: number) => ({ x: px / metrics.cellW - L.ox, y: py / metrics.cellH - L.oy });
    const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < site.W && p.y < site.H;
    const m = toSite(input.mouse.x, input.mouse.y);
    d.hover = input.mouse.inside && inside(m) && !hitAt(input.mouse.x, input.mouse.y) ? m : null;
    if (d.hover) {
      const f = fossilAt(site, m.x, m.y);
      if (f && f.state === "buried" && f.exposed > 0) d.focus = site.fossils.indexOf(f);
    }

    for (const p of input.mouse.presses) {
      if (p.button !== 0) continue;
      const q = toSite(p.x, p.y);
      const f = inside(q) ? fossilAt(site, q.x, q.y) : undefined;
      d.digging = !hitAt(p.x, p.y) && inside(q) && !(f && ready(f)) && d.tool !== "loupe";
      d.last = null;
    }
    if (!input.mouse.down) { d.digging = false; d.last = null; }
    if (d.digging && inside(m)) {
      // Creuse le long du trajet : frotter vite dégage plus, comme un vrai coup de pinceau.
      const from = d.last ?? m;
      const steps = Math.max(1, Math.ceil(Math.hypot(m.x - from.x, (m.y - from.y) * 1.75) / 1.5));
      for (let i = 1; i <= steps; i++) stamp(s, site, from.x + ((m.x - from.x) * i) / steps, from.y + ((m.y - from.y) * i) / steps, d.tool, dt * (steps > 1 ? 0.8 : 1));
      d.last = { x: m.x, y: m.y };
      // Récolte automatique : dès qu'un fossile est assez dégagé, il part sous plâtre.
      for (const f of site.fossils) if (ready(f)) collect(s, f);
    }

    for (const c of input.worldClicks) {
      const q = toSite(c.x, c.y);
      if (!inside(q)) continue;
      const f = fossilAt(site, q.x, q.y);
      if (!f || f.state !== "buried") continue;
      if (ready(f)) collect(s, f);
      else if (f.exposed > 0) d.hint = { text: `Pas encore : degage-le encore un peu (${Math.round((f.exposed / f.cells) * 100)} % / ${READY * 100} %)`, t: s.time };
    }

    // Fossiles qui partent sous plâtre.
    for (const f of site.fossils) {
      if (f.state !== "lifting" || s.time - f.t0 < 1.2) continue;
      f.state = "done";
      for (let j = 0; j < f.r.h; j++)
        for (let i = 0; i < f.r.w; i++)
          if (f.r.mat[j * f.r.w + i]) site.cover[(f.y + f.r.cy + j) * site.W + f.x + f.r.cx + i] = 0;
      reward(s, f);
      checkComplete(s, site);
    }

    for (const p of d.dust) {
      p.vy += 40 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    d.dust = d.dust.filter((p) => p.life > 0);
    d.tipT += dt;
    if (d.tipT > 16) { d.tipT = 0; d.tip = (d.tip + 1) % TIPS.length; }
  },

  compose(s, th, world, ui) {
    const d = s.dig;
    const site = ensureSite(s);
    if (!site) return;
    const L = layout(site);
    const key = `${world.cols}x${world.rows}|${th.style}|${site.seed}|${L.ox}|${L.oy}`;
    if (!d.backdrop || d.backdrop.key !== key) d.backdrop = { ...buildBackdrop(site, th, world.cols, world.rows, L.ox, L.oy), key };
    world.ch.set(d.backdrop.ch);
    world.fg.set(d.backdrop.fg);
    world.bg.set(d.backdrop.bg);

    const shake = s.time - d.shake < 0.12 ? (hash2(Math.floor(s.time * 60), 1, 3) < 0.5 ? -1 : 1) : 0;
    drawSite(s, th, world, site, L.ox, L.oy, shake);
    drawCursor(s, th, world, site, L.ox, L.oy);
    drawUi(s, th, ui, site);
  },
};

// ---------------------------------------------------------------------------
// Rendu du site
// ---------------------------------------------------------------------------
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const code = (s: string, h: number) => s.charCodeAt(Math.min(s.length - 1, Math.floor(h * s.length)));

function drawSite(s: GameState, th: Theme, f: Frame, site: Site, ox: number, oy: number, shake: number) {
  const { W, H, cover, cover0, owner, fossils, layer, deco, strata } = site;
  const mats = th.mats, P = th.pal, cart = th.cel;
  const hi = th.ui.hi;
  const pulse = 0.5 + 0.5 * Math.sin(s.time * 5);
  const fk = cart ? 0.72 : 0.85, bk = cart ? 0.92 : 0.3;
  const hollow = mats[SM.Hollow].color, matrix = mats[SM.Matrix], stake = mats[SM.Stake].color;
  const GX = 24, GY = 12;

  // Une cellule de fossile est-elle visible (dégagée, encore en place) ?
  const visible = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return -1;
    const k = j * W + i, o = owner[k];
    if (o < 0) return -1;
    const fo = fossils[o];
    return (fo.state === "buried" && cover[k] <= 0) || (fo.state === "lifting") ? o : -1;
  };

  /** Creux : sombre, avec un contour autour des fossiles visibles (lumineux s'ils sont prêts). */
  const paintHollow = (i: number, j: number, idx: number, hx: number, y: number) => {
    let near = -1;
    for (let n = 0; n < 4 && near < 0; n++) near = visible(i + N4[n][0], j + N4[n][1]);
    const h = hash2(hx, y, 23);
    const up = j > 0 ? cover[j * W + i - W] : 0;
    const dk = (up > 0.3 ? 0.65 : 1) * (near >= 0 ? 0.5 : 1);
    f.ch[idx] = near >= 0 || h < 0.8 ? 32 : code(mats[SM.Hollow].ramp, (h - 0.8) * 5);
    if (near >= 0 && ready(fossils[near])) {
      const t = 0.35 + 0.4 * pulse;
      setFg(f, idx, hi[0], hi[1], hi[2]);
      setBg(f, idx, hollow[0] + (hi[0] - hollow[0]) * t, hollow[1] + (hi[1] - hollow[1]) * t, hollow[2] + (hi[2] - hollow[2]) * t);
    } else if (near >= 0 && cart) {
      setFg(f, idx, P.ink[0], P.ink[1], P.ink[2]);
      setBg(f, idx, P.ink[0], P.ink[1], P.ink[2]);
    } else {
      setFg(f, idx, hollow[0] * 1.8, hollow[1] * 1.8, hollow[2] * 1.8);
      setBg(f, idx, hollow[0] * dk, hollow[1] * dk, hollow[2] * dk);
    }
  };

  for (let j = 0; j < H; j++) {
    const y = oy + j;
    if (y < 0 || y >= f.rows) continue;
    for (let i = 0; i < W; i++) {
      const x = ox + i + shake;
      if (x < 0 || x >= f.cols) continue;
      const k = j * W + i, idx = y * f.cols + x;
      const hx = ox + i; // coordonnées de hachage stables (sans tremblement)
      const c = cover[k];
      const o = owner[k];
      const fo = o >= 0 ? fossils[o] : undefined;
      let r = 0, g = 0, b = 0, br = 0, bg = 0, bb = 0, ch = 32;

      if (fo && (fo.state === "lifting" || (fo.state === "buried" && c <= 0))) {
        // --- Fossile dégagé ---
        const ri = i - fo.x - fo.r.cx, rj = j - fo.y - fo.r.cy;
        const rk = rj * fo.r.w + ri;
        const lift = fo.state === "lifting" ? (s.time - fo.t0) / 1.2 : 0;
        if (lift > 0.55) { paintHollow(i, j, idx, hx, y); continue; }
        const raw = fo.r.mat[rk];
        let mid: number = raw === M.Bone || raw === M.Club || raw === M.Claw || raw === M.Tooth ? SM.Fossil : raw === M.Socket ? SM.Hollow : raw;
        if (lift > 0 && ri / fo.r.w < lift / 0.55) mid = SM.Plaster;
        const m = mats[mid];
        let lum = fo.r.lum[rk];
        if (cart) lum = lum < 0.42 ? 0.32 : lum < 0.7 ? 0.62 : 0.95;
        const gl = Math.min(0.999, lum + (hash2(hx, y, 11) - 0.5) * th.dither);
        ch = fo.r.glyph[rk] || code(m.ramp, gl);
        const sh = 0.3 + 0.95 * lum;
        r = m.color[0] * sh; g = m.color[1] * sh; b = m.color[2] * sh;
        const kk = (cart ? 0.72 : 0.3) * sh * 0.9;
        br = P.void[0] * (1 - kk) + m.color[0] * kk; bg = P.void[1] * (1 - kk) + m.color[1] * kk; bb = P.void[2] * (1 - kk) + m.color[2] * kk;
        if (mid === SM.Amber && !cart) { br += 30; bg += 14; }
        // Fissures quand le burin l'a abîmé.
        if (fo.integrity < 1 && hash2(hx, y, 5) < (1 - fo.integrity) * 0.55) {
          ch = code("/\\x", hash2(hx, y, 6));
          r *= 0.45; g *= 0.45; b *= 0.45;
        }
        if (ready(fo)) {
          const t = 0.3 * pulse;
          r += (hi[0] - r) * t; g += (hi[1] - g) * t; b += (hi[2] - b) * t;
        }
      } else if (c <= 0) {
        // --- Creux dégagé (ou débris d'un os brisé) ---
        if (fo && fo.state === "broken") {
          const h = hash2(hx, y, 21);
          const fc = mats[SM.Fossil].color;
          ch = h < 0.5 ? code(",.;'", h * 2) : 32;
          r = fc[0] * 0.55; g = fc[1] * 0.55; b = fc[2] * 0.55;
          br = hollow[0]; bg = hollow[1]; bb = hollow[2];
        } else {
          paintHollow(i, j, idx, hx, y);
          continue;
        }
      } else {
        // --- Sédiment : couche de surface, puis gangue ---
        const h = hash2(hx, y, 17);
        let m = matrix, glyph = 0, sh: number;
        const depth = 1 - c / cover0[k];
        if (c > SUB) {
          const st = strata[layer[k]];
          const dv = deco[k];
          m = mats[dv === 1 ? SM.Pebble : dv === 2 ? SM.Root : st.mat];
          const edge = !dv && j > 0 && layer[k - W] !== layer[k];
          const lam = 0.92 + 0.08 * Math.sin((j + site.gTop) * 1.7 + i * 0.05) + (hash2(hx >> 3, y, 9) - 0.5) * 0.12;
          sh = lam * (edge ? 0.72 : 1) * (1 - depth * 0.3);
          if (edge) glyph = 95;
          else if (dv === 3) glyph = code("/\\-", hash2(hx, y, 6));
          else if (dv === 4) glyph = h < 0.5 ? 44 : 96;
          else if (!dv && h < (cart ? 0.35 : 0.15)) glyph = 32;
          if (dv === 3) sh *= 0.5;
          if (dv === 4) m = mats[SM.Fossil];
        } else {
          sh = 0.66 - (1 - c / SUB) * 0.14;
          if (h < 0.25) glyph = 32;
        }
        ch = glyph || code(m.ramp, h);
        // Ombre portée par le bord plus haut (lumière en haut à gauche).
        const up = j > 0 && i > 0 ? cover[k - W - 1] : c;
        if (up > c + 0.3) sh *= Math.max(0.55, 1 - (up - c) * 0.22);
        r = m.color[0] * fk * sh; g = m.color[1] * fk * sh; b = m.color[2] * fk * sh;
        br = m.color[0] * bk * sh; bg = m.color[1] * bk * sh; bb = m.color[2] * bk * sh;
        // L'os affleure : sa couleur transparaît sous une fine pellicule.
        if (fo && fo.state === "buried" && c < 0.8) {
          const t = ((0.8 - c) / 0.8) * 0.55;
          const fc = mats[SM.Fossil].color;
          r += (fc[0] - r) * t; g += (fc[1] - g) * t; b += (fc[2] - b) * t;
          if (t > 0.3) ch = code(mats[SM.Fossil].ramp, 0.5);
        }
      }

      // Quadrillage de ficelle.
      if ((i % GX === 0 || j % GY === 0) && !(fo && c <= 0 && fo.state === "buried")) {
        ch = i % GX === 0 && j % GY === 0 ? 43 : i % GX === 0 ? 124 : 45;
        r = stake[0] * 1.3; g = stake[1] * 1.3; b = stake[2] * 1.3;
        if (cart) { r = 255; g = 250; b = 235; }
      }
      f.ch[idx] = ch;
      setFg(f, idx, r, g, b);
      setBg(f, idx, br, bg, bb);
    }
  }

  // Coques de plâtre qui s'élèvent.
  for (const fo of fossils) {
    if (fo.state !== "lifting") continue;
    const t = (s.time - fo.t0) / 1.2;
    if (t <= 0.55) continue;
    const up = Math.floor(((t - 0.55) / 0.45) * 8);
    const m = mats[SM.Plaster];
    for (let j = 0; j < fo.r.h; j++)
      for (let i = 0; i < fo.r.w; i++) {
        const rk = j * fo.r.w + i;
        if (!fo.r.mat[rk]) continue;
        const x = ox + fo.x + fo.r.cx + i + shake, y = oy + fo.y + fo.r.cy + j - up;
        if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) continue;
        const idx = y * f.cols + x, sh = 0.5 + 0.6 * fo.r.lum[rk];
        f.ch[idx] = code(m.ramp, fo.r.lum[rk]);
        setFg(f, idx, m.color[0] * sh * 0.8, m.color[1] * sh * 0.8, m.color[2] * sh * 0.8);
        setBg(f, idx, m.color[0] * sh * 0.7, m.color[1] * sh * 0.7, m.color[2] * sh * 0.7);
      }
  }

  // Cadre : cordelette et piquets, repères du quadrillage (A, B, C... / 1, 2, 3...).
  const put = (x: number, y: number, c: number, col: readonly number[], bgc?: readonly number[]) => {
    if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
    const idx = y * f.cols + x;
    f.ch[idx] = c;
    setFg(f, idx, col[0], col[1], col[2]);
    if (bgc) setBg(f, idx, bgc[0], bgc[1], bgc[2]);
  };
  const dark = stake.map((v) => v * 0.35);
  const light = cart ? [255, 250, 235] : stake.map((v) => v * 1.5);
  for (let i = -1; i <= W; i++) { put(ox + i, oy - 1, 61, stake, dark); put(ox + i, oy + H, 61, stake, dark); }
  for (let j = -1; j <= H; j++) { put(ox - 1, oy + j, 124, stake, dark); put(ox + W, oy + j, 124, stake, dark); }
  for (const [x, y] of [[ox - 1, oy - 1], [ox + W, oy - 1], [ox - 1, oy + H], [ox + W, oy + H]]) put(x, y, 35, light, dark);
  for (let i = 0, n = 0; i < W; i += GX, n++) put(ox + i + Math.floor(GX / 2), oy - 1, 65 + (n % 26), light, dark);
  for (let j = 0, n = 1; j < H; j += GY, n++) put(ox - 1, oy + j + Math.floor(GY / 2), 48 + (n % 10), light, dark);

  // Poussière.
  for (const p of s.dig.dust) {
    const x = Math.floor(ox + p.x), y = Math.floor(oy + p.y);
    if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) continue;
    const col = mats[p.mat].color;
    const k = Math.min(1, p.life * 2) * (cart ? 0.9 : 1.2);
    put(x, y, p.ch, col.map((v) => Math.min(255, v * k + (cart ? 40 : 10))));
  }
}

function drawCursor(s: GameState, th: Theme, f: Frame, site: Site, ox: number, oy: number) {
  const d = s.dig, h = d.hover;
  if (!h) return;
  const T = TOOLS[d.tool];
  const hi = th.ui.hi, pulse = 0.5 + 0.5 * Math.sin(s.time * 4);
  const cx = h.x, cy = h.y;
  const put = (x: number, y: number, c: number, col: readonly number[]) => {
    const X = ox + x, Y = oy + y;
    if (X < 0 || Y < 0 || X >= f.cols || Y >= f.rows) return;
    const idx = Y * f.cols + X;
    f.ch[idx] = c;
    setFg(f, idx, col[0], col[1], col[2]);
  };

  // Loupe : révèle le contour des fossiles cachés.
  if (d.tool === "loupe") {
    const { W, H, owner, cover, fossils } = site;
    for (let y = Math.max(0, Math.floor(cy - T.ry)); y <= Math.min(H - 1, Math.ceil(cy + T.ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - T.rx)); x <= Math.min(W - 1, Math.ceil(cx + T.rx)); x++) {
        const e = ((x + 0.5 - cx) / T.rx) ** 2 + ((y + 0.5 - cy) / T.ry) ** 2;
        const k = y * W + x, o = owner[k];
        if (e >= 1 || o < 0 || cover[k] <= 0 || fossils[o].state !== "buried") continue;
        const border = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const xx = x + dx, yy = y + dy;
          return xx < 0 || yy < 0 || xx >= W || yy >= H || owner[yy * W + xx] !== o;
        });
        if (border || (x + y) % 3 === 0) put(x, y, border ? 58 : 46, hi.map((v) => v * (0.55 + 0.45 * pulse * (1 - e))));
      }
  }

  // Empreinte de l'outil.
  for (let y = Math.floor(cy - T.ry - 1); y <= cy + T.ry + 1; y++)
    for (let x = Math.floor(cx - T.rx - 1); x <= cx + T.rx + 1; x++) {
      const e = Math.hypot((x + 0.5 - cx) / T.rx, (y + 0.5 - cy) / T.ry);
      if (Math.abs(e - 1) > (d.tool === "loupe" ? 0.06 : 0.17)) continue;
      put(x, y, d.tool === "loupe" ? 111 : d.tool === "pick" ? 58 : 46, hi);
    }
  const X = Math.floor(cx), Y = Math.floor(cy);
  if (d.tool === "pick") { put(X, Y, 43, hi); put(X - 1, Y, 45, hi); put(X + 1, Y, 45, hi); }
  if (d.tool === "loupe") for (let k = 1; k <= 5; k++) put(Math.floor(cx + T.rx * 0.72) + k, Math.floor(cy + T.ry * 0.72) + Math.floor(k * 0.6), 92, th.mats[SM.Stake].color);
  if (d.tool === "brush") for (let k = 1; k <= 3; k++) put(X + k, Y - k, 47, th.mats[SM.Stake].color);
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
function drawUi(s: GameState, th: Theme, ui: Frame, site: Site) {
  const d = s.dig, u = th.ui;
  const T = (x: number, y: number, str: string, col: RGB = u.text) => text(ui, x, y, str, col, u.panel, u.alpha);

  // --- Outils (gauche) ---
  const lw = LEFT_W, lx = 1, ly = UI_TOP, inner = lw - 4;
  const desc = wrap(TOOLS[d.tool].desc, inner);
  let info: string[] = [], layerName = "", hard = 0;
  if (d.hover) {
    const k = Math.floor(d.hover.y) * site.W + Math.floor(d.hover.x);
    if (site.cover[k] > SUB) {
      const st = site.strata[site.layer[k]];
      layerName = site.deco[k] === 1 ? "Galet" : st.name;
      hard = Math.min(1, hardness(site, k) / 2.6);
      info = wrap(site.deco[k] === 1 ? "Un caillou tres dur, roule par une ancienne riviere." : st.fact, inner);
    } else if (site.cover[k] > 0) {
      layerName = MATRIX_INFO.name; hard = 0.5; info = wrap(MATRIX_INFO.fact, inner);
    }
  }
  const fo = d.focus >= 0 ? site.fossils[d.focus] : undefined;
  const showFo = fo && fo.state === "buried";
  const lh = 3 + TOOL_ORDER.length * 2 + desc.length + 1 + (layerName ? 3 + info.length : 0) + (showFo ? 5 : 0) + 1;
  panel(ui, th, lx, ly, lw, lh, "Outils");
  // Raccourci de test (dev uniquement) : finir le site d'un clic.
  if (DEV && !site.complete) button(ui, th, "dig:reveal", lx, ly + lh + 1, "Tout degager (test)", { w: lw });
  let y = ly + 2;
  for (const t of TOOL_ORDER) {
    button(ui, th, `dig:tool:${t}`, lx + 2, y, `${TOOLS[t].name} (${TOOLS[t].key})`, { w: inner, active: d.tool === t });
    y += 2;
  }
  desc.forEach((l) => T(lx + 2, y++, l, u.dim));
  y++;
  if (layerName) {
    T(lx + 2, y, "Couche : ", u.dim);
    T(lx + 11, y++, layerName, u.hi);
    T(lx + 2, y, "Durete", u.dim);
    bar(ui, th, lx + 9, y++, inner - 7, hard, hard > 0.6 ? u.bad : u.ok);
    info.forEach((l) => T(lx + 2, y++, l));
    y++;
  }
  if (fo && showFo) {
    const pct = fo.exposed / fo.cells;
    T(lx + 2, y++, fo.kind === "bone" ? "Os en cours" : "Fossile en cours", u.hi);
    T(lx + 2, y, "Degage", u.dim);
    bar(ui, th, lx + 9, y++, inner - 7, pct / READY, pct >= READY ? u.ok : u.hi);
    T(lx + 2, y, "Etat", u.dim);
    bar(ui, th, lx + 9, y++, inner - 7, fo.integrity, fo.integrity < 0.5 ? u.bad : u.ok);
    if (ready(fo)) button(ui, th, "dig:collect", lx + 2, y, "Recolter (Entree)", { w: inner });
    else T(lx + 2, y, pct > 0 ? "Continue de degager..." : "Quelque chose de dur ici !", u.dim);
  }

  // --- Site (droite) ---
  const rw = RIGHT_W, rx = ui.cols - rw - 1, ry = UI_TOP, rin = rw - 4;
  const bones = site.fossils.filter((f) => f.kind === "bone");
  const extras = site.fossils.filter((f) => f.kind === "extra" && f.state === "done");
  const tip = wrap(TIPS[d.tip], rin);
  const name = wrap(site.name.replace(/^Site \d+ - /, ""), rin);
  const rh = 4 + name.length + bones.length + (extras.length ? extras.length + 1 : 0) + 2 + tip.length + (site.complete ? 4 : 1);
  panel(ui, th, rx, ry, rw, rh, `Site ${site.n}`);
  y = ry + 1;
  name.forEach((l) => T(rx + 2, y++, l, u.hi));
  const done = bones.filter((f) => f.state === "done").length;
  T(rx + 2, y++, `Os recoltes : ${done} / ${bones.length}`);
  y++;
  for (const f of bones) {
    if (f.state === "done") T(rx + 2, y++, `[x] ${f.label}`.slice(0, rin), u.ok);
    else if (f.state === "broken") T(rx + 2, y++, `[!] Os brise`, u.bad);
    else T(rx + 2, y++, f.exposed > 0 ? "[ ] Os en train d'apparaitre" : "[ ] Os encore cache ?", u.dim);
  }
  if (extras.length) {
    T(rx + 2, y++, "Bonus :", u.dim);
    for (const f of extras) T(rx + 2, y++, `[*] ${f.label}`.slice(0, rin), u.hi);
  }
  y++;
  T(rx + 2, y++, "Le savais-tu ?", u.hi);
  tip.forEach((l) => T(rx + 2, y++, l));
  if (site.complete) {
    y++;
    T(rx + 2, y++, "Site termine, bravo !", u.ok);
    button(ui, th, "dig:next", rx + 2, y, "Site suivant (Entree)", { w: rin });
  }

  // --- Bulle sous la souris ---
  const h = d.hover;
  if (h) {
    const f = fossilAt(site, h.x, h.y);
    const c = uiCellAt(s.mouse.x, s.mouse.y);
    let label = "";
    if (f && ready(f)) label = " Clique pour le recolter ! ";
    else if (f && f.state === "buried" && f.exposed > 0) label = ` Degage : ${Math.round((f.exposed / f.cells) * 100)} % `;
    if (label) text(ui, Math.min(ui.cols - label.length - 1, c.x + 2), c.y - 1, label, ready(f!) ? u.panel : u.text, ready(f!) ? u.hi : u.panel, 0.95);
  }
  if (d.hint && s.time - d.hint.t < 2.5) {
    const w = d.hint.text.length + 4, x = Math.floor((ui.cols - w) / 2);
    panel(ui, th, x, ui.rows - 5, w, 3);
    T(x + 2, ui.rows - 4, d.hint.text);
  }

  text(ui, 1, ui.rows - 1, "Glisser : creuser   E/R/F ou Tab : outil   Clic sur un fossile degage : le recolter   Entree : recolter",
    u.dim, u.panel, 0.7);
}
