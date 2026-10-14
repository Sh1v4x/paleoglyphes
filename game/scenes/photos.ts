import { clockLabel } from "../daycycle";
import { blitPhoto, copyText, downloadPng } from "../features/photo-export";
import { starsText } from "../features/photo-score";
import { album, loadAlbum, MAX_PHOTOS, removePhoto, type Photo } from "../features/photo-store";
import type { RGB, Theme } from "../palette";
import type { Frame } from "../render/frame";
import { metrics } from "../render/metrics";
import type { GameState } from "../state";
import { actions, button, buttonW, clip, emptyState, over, put, region, SP, text, wrap, type Action } from "../ui/kit";
import { toast } from "../ui/toast";
import { UI_TOP, type Scene } from "./types";

/**
 * Onglet Photos : l'album du photo-safari. Grille de vignettes (aperçus ASCII réduits, dessinés
 * dans le calque monde), puis vue en grand façon polaroïd, avec export PNG et copie en texte.
 */
export interface PhotosState {
  ready: boolean;
  /** Photo affichée en grand (index dans l'album), -1 = grille. */
  view: number;
  /** Défilement de la grille (rangées de vignettes). */
  scroll: number;
  wheel: number;
  /** Suppression en attente de confirmation. */
  confirm: boolean;
}
export function createPhotosState(): PhotosState {
  return { ready: false, view: -1, scroll: 0, wheel: 0, confirm: false };
}

/** Vignette : image en cellules d'interface, légende de deux lignes, espacements. */
const TW = 24, TH = 8, GAP_X = 3, GAP_Y = 1, PITCH_Y = TH + 2 + GAP_Y;
const BG: RGB = [18, 16, 24], CREAM: RGB = [244, 238, 222], INK: RGB = [60, 50, 42], GOLD: RGB = [200, 130, 20];

export const photoDate = (p: Photo) => `Jour ${p.day}, ${clockLabel(p.clock)}`;
export const photoCaption = (p: Photo) => `Paleoglyphes - ${p.title} - [${starsText(p.stars)}] - ${photoDate(p)}`;

/** Disposition de la grille selon la taille de l'interface. */
function gridLayout(ui: { cols: number; rows: number }) {
  const perRow = Math.max(1, Math.floor((ui.cols - 4 + GAP_X) / (TW + GAP_X)));
  const x0 = Math.floor((ui.cols - (perRow * (TW + GAP_X) - GAP_X)) / 2);
  const y0 = UI_TOP + 2;
  // La dernière ligne est celle de l'aide (dessinée par le cœur).
  const visRows = Math.max(1, Math.floor((ui.rows - y0 - 2) / PITCH_Y));
  return { perRow, x0, y0, visRows };
}

/** Rectangle d'interface (cellules) -> rectangle du calque monde (cellules). */
function toWorld(x: number, y: number, w: number, h: number) {
  const kx = metrics.uiW / metrics.cellW, ky = metrics.uiH / metrics.cellH;
  const wx = Math.round(x * kx), wy = Math.round(y * ky);
  return { x: wx, y: wy, w: Math.round((x + w) * kx) - wx, h: Math.round((y + h) * ky) - wy };
}

function fillWorld(world: Frame, x: number, y: number, w: number, h: number, c: RGB) {
  for (let j = Math.max(0, y); j < Math.min(world.rows, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(world.cols, x + w); i++) {
      const d = j * world.cols + i, k = d * 4;
      world.ch[d] = 0;
      world.bg[k] = c[0]; world.bg[k + 1] = c[1]; world.bg[k + 2] = c[2]; world.bg[k + 3] = 255;
    }
  }
}

function open(s: GameState, i: number) {
  const ps = s.photos;
  ps.view = Math.max(0, Math.min(album.photos.length - 1, i));
  ps.confirm = false;
}

export const photosScene: Scene = {
  enter(s) {
    loadAlbum();
    s.photos.confirm = false;
  },

  update(s, input) {
    loadAlbum();
    const ps = s.photos, n = album.photos.length;
    ps.ready = album.loaded;
    if (ps.view >= n) ps.view = n - 1;
    if (ps.view >= 0) {
      const p = album.photos[ps.view];
      for (const k of input.pressed) {
        if (k === "ArrowLeft" || k === "KeyA" || k === "KeyQ") open(s, ps.view - 1);
        if (k === "ArrowRight" || k === "KeyD") open(s, ps.view + 1);
      }
      for (const id of input.ui) {
        if (id === "photos:prev") open(s, ps.view - 1);
        if (id === "photos:next") open(s, ps.view + 1);
        if (id === "photos:back") { ps.view = -1; ps.confirm = false; }
        if (id === "photos:del") ps.confirm = true;
        if (id === "photos:del:no") ps.confirm = false;
        if (id === "photos:del:yes" && p) {
          removePhoto(p.id);
          ps.confirm = false;
          toast(s, "Photo supprimée", p.title);
          if (!album.photos.length) ps.view = -1;
          else ps.view = Math.min(ps.view, album.photos.length - 1);
        }
        if (id === "photos:png" && p) {
          void downloadPng(p, photoCaption(p)).then((ok) => toast(s, ok ? "Image téléchargée" : "Téléchargement impossible", ok ? `paleoglyphes-${p.id}.png` : ""));
        }
        if (id === "photos:txt" && p) {
          void copyText(p, photoCaption(p)).then((ok) => toast(s, ok ? "Copiée en texte !" : "Copie impossible", ok ? "Colle-la dans un éditeur en police à chasse fixe." : "Le presse-papiers n'est pas accessible."));
        }
      }
      return;
    }
    // Grille : molette pour défiler, clic sur une vignette pour l'ouvrir.
    ps.wheel += input.mouse.wheel;
    if (Math.abs(ps.wheel) >= 60) { ps.scroll += Math.sign(ps.wheel); ps.wheel = 0; }
    for (const k of input.pressed) {
      if (k === "ArrowDown" || k === "KeyS") ps.scroll++;
      if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ") ps.scroll--;
    }
    ps.scroll = Math.max(0, ps.scroll);
    for (const id of input.ui) {
      if (id.startsWith("photos:open:")) open(s, Number(id.slice(12)));
      if (id === "photos:park") { s.mode = "park"; s.photo.aiming = true; }
    }
    // Album vide : P mène tout droit à l'appareil (comme le bouton de l'état vide).
    if (!n && album.loaded && input.pressed.includes("KeyP")) { s.mode = "park"; s.photo.aiming = true; }
  },

  compose(s, th, world, ui) {
    const u = th.ui, ps = s.photos;
    // Le calque monde sert de toile : fond sombre uni.
    world.fg.fill(0);
    fillWorld(world, 0, 0, world.cols, world.rows, BG);
    const n = album.photos.length;
    const status = `${n}/${MAX_PHOTOS} photo${n > 1 ? "s" : ""}${album.loaded ? "" : "  (chargement...)"}${album.persistent ? "" : "  -  stockage indisponible : les photos ne survivront pas au rechargement"}`;

    if (ps.view >= 0 && album.photos[ps.view]) { drawFull(s, th, world, ui, album.photos[ps.view]); return; }

    const tl = text(ui, 2, UI_TOP, "Album du photo-safari", u.hi, u.panel, u.alpha);
    // Album plein : « (plein) » écrit en plus de la couleur.
    text(ui, 2 + tl + 3, UI_TOP, clip(`${status}${n >= MAX_PHOTOS ? "  (plein)" : ""}`, ui.cols - tl - 6), n >= MAX_PHOTOS ? u.bad : u.dim, u.panel, 0.7);
    if (!n) {
      if (album.loaded) emptyState(ui, th, "Album vide", "Aucune photo pour l'instant. Va dans la reserve et sors l'appareil photo (touche P) : cadre un dinosaure, puis declenche !",
        { id: "photos:park", label: "Aller a la reserve", key: "P" });
      else emptyState(ui, th, "Album", "Chargement de l'album...");
      return;
    }
    const g = gridLayout(ui);
    const totalRows = Math.ceil(n / g.perRow);
    ps.scroll = Math.min(ps.scroll, Math.max(0, totalRows - g.visRows));
    for (let k = ps.scroll * g.perRow; k < Math.min(n, (ps.scroll + g.visRows) * g.perRow); k++) {
      const p = album.photos[k];
      const row = Math.floor(k / g.perRow) - ps.scroll, col = k % g.perRow;
      const x = g.x0 + col * (TW + GAP_X), y = g.y0 + row * PITCH_Y;
      const r = toWorld(x, y, TW, TH);
      blitPhoto(world, p, r.x, r.y, r.w, r.h);
      const hover = over(x, y, TW, TH + 2);
      if (hover) {
        // Coins de sélection autour de l'image.
        for (const [cx, cy] of [[x - 1, y - 1], [x + TW, y - 1], [x - 1, y + TH], [x + TW, y + TH]]) put(ui, cx, cy, 43, u.hi);
      }
      const title = p.title.length > TW ? `${p.title.slice(0, TW - 3)}...` : p.title;
      text(ui, x, y + TH, title.padEnd(TW), hover ? u.hi : u.text, u.panel, 0.85);
      text(ui, x, y + TH + 1, `[${starsText(p.stars)}]`, GOLD, u.panel, 0.85);
      const d = photoDate(p);
      text(ui, x + 8, y + TH + 1, d.padStart(TW - 8), u.dim, u.panel, 0.85);
      region(`photos:open:${k}`, x, y, TW, TH + 2, { focus: true, tip: "Voir en grand" });
    }
    if (totalRows > g.visRows) {
      const pos = `Lignes ${ps.scroll + 1}-${Math.min(totalRows, ps.scroll + g.visRows)} sur ${totalRows}`;
      text(ui, ui.cols - pos.length - 2, UI_TOP, pos, u.dim, u.panel, 0.7);
    }
  },

  hints(s) {
    const ps = s.photos;
    if (ps.view >= 0 && album.photos[ps.view]) {
      if (ps.confirm) return [["Echap", "annuler"]];
      return [["Fleches", "photo precedente / suivante"], ["Echap", "retour a l'album"]];
    }
    return album.photos.length ? [["Clic", "voir en grand"], ["Molette", "defiler"]] : [];
  },

  help() {
    return [
      ["Clic", "ouvrir une photo en grand (ou Tab puis Entree)"],
      ["Molette", "defiler l'album (fleches haut / bas aussi)"],
      ["Fleches", "en grand : photo precedente / suivante"],
      ["Echap", "annuler la suppression, puis revenir a l'album"],
    ];
  },

  back(s) {
    const ps = s.photos;
    if (ps.confirm) { ps.confirm = false; return true; }
    if (ps.view >= 0) { ps.view = -1; return true; }
    return false;
  },
};

/** Vue en grand : la photo à l'échelle 1 (réduite si l'écran est trop petit) dans un polaroïd. */
function drawFull(s: GameState, th: Theme, world: Frame, ui: Frame, p: Photo) {
  const u = th.ui, ps = s.photos;
  const n = album.photos.length;
  text(ui, 2, UI_TOP, `Photo ${ps.view + 1} / ${n}`, u.hi, u.panel, u.alpha);
  // Zone disponible (cellules monde) : sous l'en-tête, au-dessus des boutons et de la légende.
  const top = toWorld(0, UI_TOP + 1, 1, 1).y, bottom = toWorld(0, ui.rows - 3, 1, 1).y;
  const capRows = toWorld(0, 0, 1, 3).h;
  const padX = 4, padY = 3;
  const availW = world.cols - padX * 2 - 4, availH = bottom - top - padY - capRows - 2;
  const k = Math.min(1, availW / p.cols, availH / p.rows);
  const dw = Math.max(4, Math.floor(p.cols * k)), dh = Math.max(3, Math.floor(p.rows * k));
  const fw = dw + padX * 2, fh = dh + padY + capRows;
  const fx = Math.floor((world.cols - fw) / 2), fy = top + Math.max(0, Math.floor((bottom - top - fh) / 2));
  // Ombre portée, papier crème, puis l'image.
  fillWorld(world, fx + 2, fy + 2, fw, fh, [8, 7, 12]);
  fillWorld(world, fx, fy, fw, fh, CREAM);
  blitPhoto(world, p, fx + padX, fy + padY, dw, dh);
  // Légende sur la marge du bas du polaroïd (calque d'interface, fond transparent).
  const kx = metrics.cellW / metrics.uiW, ky = metrics.cellH / metrics.uiH;
  const cx0 = Math.ceil(fx * kx) + 1, cw = Math.floor(fw * kx) - 2;
  const cy = Math.ceil((fy + padY + dh) * ky);
  const title = wrap(p.title, Math.max(10, cw - 10))[0];
  text(ui, cx0, cy, title, INK, null);
  text(ui, cx0 + cw - 7, cy, `[${starsText(p.stars)}]`, GOLD, null);
  const real = new Date(p.real);
  const when = `${photoDate(p)}  -  ${real.toLocaleDateString("fr-FR")}`;
  const notes = p.notes.length ? `  -  ${p.notes.join(", ")}` : "";
  const line2 = `${when}${notes}`;
  text(ui, cx0, cy + 1, line2.length > cw ? `${line2.slice(0, cw - 3)}...` : line2, [120, 108, 96], null);
  if (k < 1) text(ui, 18, UI_TOP, clip("Apercu reduit (fenetre trop petite)", ui.cols - 20), u.dim, u.panel, 0.7);

  // Boutons, au-dessus de la ligne d'aide : navigation à gauche, actions à droite (Retour tout à droite).
  const by = ui.rows - 2;
  if (ps.confirm) {
    const q = "! Supprimer cette photo pour de bon ?";
    const ax = actions(ui, th, SP.margin, by, ui.cols - 2 * SP.margin, [
      { id: "photos:del:no", label: "Non, garder", key: "Echap" },
      { id: "photos:del:yes", label: "Oui, supprimer", variant: "danger" },
    ]);
    text(ui, Math.max(SP.margin, ax - q.length - 2), by, q, u.bad, u.panel, u.alpha);
    return;
  }
  let x = SP.margin;
  const nav: Action[] = [
    { id: "photos:prev", label: "< Precedente", disabled: ps.view <= 0, tip: "Photo precedente (fleche gauche)" },
    { id: "photos:next", label: "Suivante >", disabled: ps.view >= n - 1, tip: "Photo suivante (fleche droite)" },
  ];
  const right: Action[] = [
    { id: "photos:png", label: "Telecharger (PNG)", tip: "Enregistrer l'image" },
    { id: "photos:txt", label: "Copier en texte", tip: "Copier les caracteres ASCII de la photo" },
    { id: "photos:del", label: "Supprimer", variant: "danger" },
    { id: "photos:back", label: "Retour", key: "Echap", variant: "primary", tip: "Retour a l'album" },
  ];
  const ax = actions(ui, th, SP.margin, by, ui.cols - 2 * SP.margin, right);
  for (const b of nav) {
    const w = buttonW(b.label);
    if (x + w >= ax - 1) break;
    x += button(ui, th, b.id, x, by, b.label, b) + SP.gap;
  }
}
