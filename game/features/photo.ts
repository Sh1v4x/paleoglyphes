import { CELL_H, CELL_W } from "../config";
import { golden, isNight } from "../daycycle";
import type { Input } from "../input";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import { SPECIES } from "../species";
import { stageOf } from "../species/life";
import type { SpeciesId } from "../species/types";
import { worldFor, type GameState } from "../state";
import { animalRaster, MINI_H, nestRaster, type Animal } from "../scenes/park";
import { nestCrack } from "../scenes/park-roster";
import { HEADER_ROWS } from "../scenes/types";
import { calm } from "../settings";
import { button, buttonW, fill, put, region, resetUi, text } from "../ui/kit";
import { toast } from "../ui/toast";
import { unlockTrigger } from "../unlock";
import { isWater } from "../world/tiles";
import { blitPhoto } from "./photo-export";
import { actOf, scoreShot, starsText, triggersOf, type Score, type Subject } from "./photo-score";
import { addPhoto, album, captureCells, loadAlbum, MAX_PHOTOS, newPhotoId, type Photo } from "./photo-store";

/**
 * Photo-safari dans la réserve : un viseur (touche P ou bouton) cadre une partie du calque monde ;
 * déclencher copie ces cellules (glyphes + couleurs) dans l'album, note la photo (1 à 5 étoiles)
 * et lui donne un titre. Photographier un animal en pleine action remplit aussi le carnet.
 */
export interface PhotoState {
  aiming: boolean;
  /** Largeur du cadre, en fraction de l'écran (molette). */
  zoom: number;
  /** Déclenchement demandé (traité au dessin, quand l'image du monde est prête). */
  shoot: boolean;
  /** Délai avant la prochaine photo (s). */
  cool: number;
  /** Dernière photo : instant (s.time), position du cadre (cellules d'interface) pour l'animation. */
  last: Photo | null;
  lastT: number;
  lastFrom: { x: number; y: number; w: number; h: number };
  /** Jour de la réserve (compté aux passages de minuit) et heure vue à la dernière image. */
  day: number;
  lastClock: number;
}

const DAY_KEY = "paleoglyphes-photo-day";

export function createPhotoState(): PhotoState {
  let day = 1;
  try {
    day = Math.max(1, Number(localStorage.getItem(DAY_KEY)) || 1);
  } catch {
    // Stockage indisponible : on compte depuis le jour 1.
  }
  return { aiming: false, zoom: 0.6, shoot: false, cool: 0, last: null, lastT: -99, lastFrom: { x: 0, y: 0, w: 1, h: 1 }, day, lastClock: -1 };
}

/** Cadre du viseur en cellules monde (relatives à l'écran), 16:10, centré sur la souris et borné. */
export function viewRect(zoom: number, mx: number, my: number, inside: boolean) {
  const W = metrics.cols * metrics.cellW, H = metrics.rows * metrics.cellH;
  const top = HEADER_ROWS * metrics.uiH, bottom = H - 2 * metrics.uiH;
  const avail = Math.max(40, bottom - top);
  let pw = W * zoom, ph = (pw * 10) / 16;
  if (ph > avail * 0.92) { ph = avail * 0.92; pw = ph * 1.6; }
  const cx = inside ? mx : W / 2, cy = inside ? my : top + avail / 2;
  const x0 = Math.max(0, Math.min(W - pw, cx - pw / 2));
  const y0 = Math.max(top, Math.min(bottom - ph, cy - ph / 2));
  return {
    x: Math.round(x0 / metrics.cellW), y: Math.round(y0 / metrics.cellH),
    w: Math.max(8, Math.round(pw / metrics.cellW)), h: Math.max(5, Math.round(ph / metrics.cellH)),
  };
}
type Rect = ReturnType<typeof viewRect>;

/** Logique du viseur. Renvoie true si l'appareil capte les clics / la caméra cette image. */
export function updatePhoto(s: GameState, input: Input, dt: number): boolean {
  const st = s.photo;
  loadAlbum();
  // Jour de la réserve : l'horloge repasse par minuit.
  if (st.lastClock >= 0 && s.clock < st.lastClock - 1) {
    st.day++;
    try { localStorage.setItem(DAY_KEY, String(st.day)); } catch { /* sans stockage : tant pis */ }
  }
  st.lastClock = s.clock;
  st.cool = Math.max(0, st.cool - dt);
  if (input.pressed.includes("KeyP") || input.ui.includes("photo:toggle")) {
    st.aiming = !st.aiming;
    st.shoot = false;
  }
  if (!st.aiming) return false;
  // Molette : cadrage plus large ou plus serré (et pas d'animal suivant).
  if (input.mouse.wheel) {
    st.zoom = Math.max(0.25, Math.min(0.95, st.zoom - Math.sign(input.mouse.wheel) * 0.05));
    input.mouse.wheel = 0;
  }
  if (input.ui.includes("photo:shoot") || input.worldClicks.length || input.pressed.includes("Space") || input.pressed.includes("Enter")) {
    if (st.cool <= 0) st.shoot = true;
  }
  // Les clics servent au déclencheur : la réserve ne sélectionne rien pendant la visée.
  input.worldClicks.length = 0;
  input.ui = input.ui.filter((id) => id.startsWith("photo:"));
  return true;
}

/** Ce qui est dans le cadre : animaux et nids, avec la part visible de leur silhouette. */
export function subjectsIn(s: GameState, r: Rect): (Subject & { animal?: Animal })[] {
  const p = s.park, w = worldFor(s);
  const camX = Math.floor(p.cam.x / CELL_W), camY = Math.floor(p.cam.y / CELL_H);
  const x0 = camX + r.x, y0 = camY + r.y, x1 = x0 + r.w, y1 = y0 + r.h;
  const out: (Subject & { animal?: Animal })[] = [];
  const count = (cx: number, cy: number, rw: number, rh: number, mat: Uint8Array) => {
    let inside = 0, total = 0, sx = 0, sy = 0;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      if (!mat[j * rw + i]) continue;
      total++;
      const gx = cx + i, gy = cy + j;
      if (gx >= x0 && gx < x1 && gy >= y0 && gy < y1) { inside++; sx += gx; sy += gy; }
    }
    return { inside, total, cx: inside ? (sx / inside - x0) / r.w : 0, cy: inside ? (sy / inside - y0) / r.h : 0 };
  };
  const wet = (x: number, y: number) => {
    const fx = Math.floor(x / CELL_W), fy = Math.floor(y / CELL_H);
    for (let j = -4; j <= 4; j += 2) for (let i = -10; i <= 10; i += 2) {
      const gx = fx + i, gy = fy + j;
      if (gx >= 0 && gy >= 0 && gx < w.cols && gy < w.rows && isWater(w.terrain[gy * w.cols + gx])) return true;
    }
    return false;
  };
  for (const a of p.animals) {
    const spec = SPECIES[a.sp];
    if (!spec) continue;
    const ra = animalRaster(a, s.time);
    if (ra.cx > x1 || ra.cy > y1 || ra.cx + ra.w < x0 || ra.cy + ra.h < y0) continue;
    const c = count(ra.cx, ra.cy, ra.w, ra.h, ra.mat);
    if (!c.inside) continue;
    const habitat = spec.habitat ?? "land";
    out.push({
      kind: "animal", animal: a, sp: a.sp, name: spec.name, stage: stageOf(spec, a.life), act: actOf(a, habitat),
      carnivore: spec.behavior.diet === "carnivore", ...c, water: habitat === "land" && (a.inWater || wet(a.x, a.y)), habitat,
    });
  }
  for (const n of p.nests) {
    const spec = SPECIES[n.sp];
    if (!spec) continue;
    const rn = nestRaster(n);
    if (rn.cx > x1 || rn.cy > y1 || rn.cx + rn.w < x0 || rn.cy + rn.h < y0) continue;
    const c = count(rn.cx, rn.cy, rn.w, rn.h, rn.mat);
    if (!c.inside) continue;
    const hatching = n.hatched === undefined && nestCrack(n) > 0;
    out.push({
      kind: "nest", sp: n.sp, name: spec.name, stage: "adult", act: hatching ? "hatch" : "nest",
      carnivore: spec.behavior.diet === "carnivore", ...c, water: false, habitat: spec.habitat ?? "land",
    });
  }
  return out;
}

function evaluate(s: GameState, r: Rect, subjects: Subject[]): Score {
  const population: Partial<Record<SpeciesId, number>> = {};
  for (const a of s.park.animals) if (a.task !== "dead") population[a.sp] = (population[a.sp] ?? 0) + 1;
  return scoreShot(subjects, { area: r.w * r.h, night: isNight(s.clock), golden: golden(s.clock) > 0.4, hour: s.clock, population });
}

/** Déclenche : capture les cellules du cadre, note, range dans l'album, remplit le carnet. */
function takePhoto(s: GameState, world: Frame, r: Rect) {
  const st = s.photo;
  st.shoot = false;
  st.cool = 0.6;
  if (album.photos.length >= MAX_PHOTOS) {
    toast(s, "Album plein !", `${MAX_PHOTOS} photos au maximum : supprime-en dans l'onglet Photos.`);
    return;
  }
  const subjects = subjectsIn(s, r);
  const sc = evaluate(s, r, subjects);
  const photo: Photo = {
    id: newPhotoId(), day: st.day, clock: s.clock, real: Date.now(),
    title: sc.title, stars: sc.stars, species: sc.species, notes: sc.notes,
    ...captureCells(world, r.x, r.y, r.w, r.h),
  };
  addPhoto(photo);
  // Le carnet : chaque animal bien cadré (au moins la moitié de sa silhouette) compte comme une observation.
  for (const sub of subjects) {
    const a = sub.animal, spec = a && SPECIES[a.sp];
    if (!a || !spec || sub.inside < 4 || sub.inside < sub.total * 0.5) continue;
    for (const t of triggersOf(a, sub.stage)) unlockTrigger(s, a.sp, t);
  }
  st.last = photo;
  st.lastT = s.time;
  const left = MAX_PHOTOS - album.photos.length;
  toast(s, "Photo enregistrée ! (onglet Photos)", `${sc.title}  [${starsText(sc.stars)}]${left <= 5 ? `  -  plus que ${left} place${left > 1 ? "s" : ""} dans l'album` : ""}${album.persistent ? "" : "  (stockage indisponible : photo perdue au rechargement)"}`);
}

/** Écrit un glyphe semi-transparent (lignes des tiers). */
function putA(ui: Frame, x: number, y: number, ch: number, fg: RGB, a: number) {
  if (x < 0 || y < 0 || x >= ui.cols || y >= ui.rows) return;
  put(ui, x, y, ch, fg);
  ui.fg[(y * ui.cols + x) * 4 + 3] = Math.round(a * 255);
}

/** Viseur : extérieur assombri, coins, tiers, mise au point, aperçu du titre et de la note. */
function drawViewfinder(s: GameState, th: Theme, ui: Frame, r: Rect) {
  const u = th.ui, st = s.photo;
  const kx = metrics.cellW / metrics.uiW, ky = metrics.cellH / metrics.uiH;
  const L = Math.round(r.x * kx), R = Math.round((r.x + r.w) * kx) - 1;
  const T = Math.round(r.y * ky), B = Math.round((r.y + r.h) * ky) - 1;
  st.lastFrom = { x: L, y: T, w: R - L + 1, h: B - T + 1 };
  // Tout l'écran déclenche (les boutons dessinés ensuite restent prioritaires).
  region("photo:shoot", 0, HEADER_ROWS, ui.cols, ui.rows - HEADER_ROWS);
  for (let y = HEADER_ROWS; y < ui.rows; y++) for (let x = 0; x < ui.cols; x++) {
    if (x >= L && x <= R && y >= T && y <= B) continue;
    put(ui, x, y, 32, [0, 0, 0], [0, 0, 0], 0.45);
  }
  const white: RGB = [255, 255, 255];
  // Lignes des tiers, discrètes.
  const W = R - L + 1, H = B - T + 1;
  for (const k of [1, 2]) {
    const vx = L + Math.round((W * k) / 3), hy = T + Math.round((H * k) / 3);
    for (let y = T; y <= B; y += 1) putA(ui, vx, y, 58, white, 0.28);
    for (let x = L; x <= R; x += 2) putA(ui, x, hy, 46, white, 0.35);
  }
  // Coins du cadre, juste à l'extérieur de l'image.
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    put(ui, cx, cy, 43, white);
    for (let i = 1; i <= 3; i++) put(ui, cx + dx * i, cy, 45, white);
    for (let j = 1; j <= 1; j++) put(ui, cx, cy + dy * j, 124, white);
  };
  corner(L - 1, T - 1, 1, 1); corner(R + 1, T - 1, -1, 1); corner(L - 1, B + 1, 1, -1); corner(R + 1, B + 1, -1, -1);
  // Mise au point qui suit la souris (verte sur un sujet).
  const subjects = subjectsIn(s, r);
  const sc = evaluate(s, r, subjects);
  const fx = Math.floor(s.mouse.x / metrics.uiW), fy = Math.floor(s.mouse.y / metrics.uiH);
  const focusCol = sc.main >= 0 ? u.ok : white;
  if (fx >= L && fx <= R && fy >= T && fy <= B) {
    for (const [cx, cy, d] of [[fx - 3, fy - 1, 1], [fx + 3, fy - 1, -1], [fx - 3, fy + 1, 1], [fx + 3, fy + 1, -1]] as const) {
      put(ui, cx, cy, 43, focusCol);
      put(ui, cx + d, cy, 45, focusCol);
    }
    put(ui, fx, fy, 43, focusCol);
  }
  // Étiquette en haut et aperçu (titre + étoiles) sous le cadre.
  text(ui, L, T - 1 >= HEADER_ROWS ? T - 1 : T, ` Album ${album.photos.length}/${MAX_PHOTOS} `, album.photos.length >= MAX_PHOTOS ? u.bad : u.text, u.panel, 0.85);
  const info = ` ${sc.title}   [${starsText(sc.stars)}] `;
  const iy = B + 1 < ui.rows - 3 ? B + 1 : T;
  const ix = Math.max(0, Math.min(ui.cols - info.length, Math.round((L + R) / 2 - info.length / 2)));
  text(ui, ix, iy, info, u.hi, u.panel, 0.85);
}

/** Pendant la visée : bouton « Ranger l'appareil » en bas à droite (au-dessus de la ligne d'aide). */
function drawToggle(s: GameState, th: Theme, ui: Frame) {
  const label = "Ranger l'appareil";
  const w = buttonW(label, { key: "P" });
  button(ui, th, "photo:toggle", ui.cols - w - 2, ui.rows - 3, label, { key: "P", variant: "primary", tip: "Ranger l'appareil (P ou Echap)" });
}

/** Flash, obturateur et polaroïd qui file vers le coin de l'écran. */
function drawShotFx(s: GameState, th: Theme, ui: Frame) {
  const st = s.photo;
  const age = s.time - st.lastT;
  if (!st.last || age > 3.2) return;
  const f = st.lastFrom;
  // Obturateur : deux volets noirs qui se ferment sur le cadre, puis le flash blanc.
  if (age < 0.09) {
    const k = Math.ceil((f.h / 2) * (age / 0.09));
    fill(ui, f.x, f.y, f.w, k, [0, 0, 0], 0.95);
    fill(ui, f.x, f.y + f.h - k, f.w, k, [0, 0, 0], 0.95);
  } else if (age < 0.45 && !calm()) {
    fill(ui, 0, HEADER_ROWS, ui.cols, ui.rows - HEADER_ROWS, [255, 255, 250], 0.9 * (1 - (age - 0.09) / 0.36));
  }
  if (age < 0.12) return;
  // Polaroïd : image réduite, cadre crème, étoiles dans la marge du bas.
  const PW = 20, PH = 10, IW = PW - 2, IH = PH - 4;
  const sx = f.x + Math.floor(f.w / 2 - PW / 2), sy = f.y + Math.floor(f.h / 2 - PH / 2);
  const ex = ui.cols - PW - 2, ey = Math.max(HEADER_ROWS + 1, ui.rows - MINI_H - 4 - PH);
  const e = Math.min(1, (age - 0.12) / 0.6), ease = 1 - (1 - e) ** 3;
  const out = Math.max(0, (age - 2.7) / 0.5);
  const x = Math.round(sx + (ex - sx) * ease), y = Math.round(sy + (ey - sy) * ease + out * out * (ui.rows - ey));
  const cream: RGB = [244, 238, 222], ink: RGB = [70, 60, 50];
  fill(ui, x, y, PW, PH, cream, 1);
  blitPhoto(ui, st.last, x + 1, y + 1, IW, IH);
  text(ui, x + 2, y + PH - 2, `[${starsText(st.last.stars)}]`, [190, 120, 20], cream, 1);
  text(ui, x + 10, y + PH - 2, `Jour ${st.last.day}`, ink, cream, 1);
  void th;
}

/** Viseur, flash, bouton appareil. `world` est l'image finale de la réserve (pour la capture). */
export function drawPhoto(s: GameState, th: Theme, world: Frame, ui: Frame): void {
  const st = s.photo;
  if (st.aiming) {
    const r = viewRect(st.zoom, s.mouse.x, s.mouse.y, s.mouse.x >= 0 && s.mouse.y >= 0);
    if (st.shoot) takePhoto(s, world, r);
    // Viseur plein écran : l'interface de la réserve s'efface pour bien cadrer.
    resetUi(ui);
    drawViewfinder(s, th, ui, r);
    drawToggle(s, th, ui);
  }
  drawShotFx(s, th, ui);
}
