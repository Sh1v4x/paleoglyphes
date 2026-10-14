import { CELL_H, CELL_W, FONT_SIZE, UI_FONT_SIZE } from "../config";
import type { Frame } from "../render/frame";
import { ascii } from "../ui/kit";
import { photoText, type Photo } from "./photo-store";

/**
 * Affichage et export d'une photo : vignette réduite dans une grille (monde ou interface),
 * image PNG téléchargeable, copie en texte brut.
 */

/**
 * Dessine la photo réduite (ou à l'échelle 1) dans le rectangle (x, y, w, h) d'une grille.
 * Chaque cellule cible prend le glyphe du centre de son bloc et la moyenne des fonds du bloc.
 */
export function blitPhoto(f: Frame, p: Photo, x: number, y: number, w: number, h: number, fade = 1) {
  const sx = p.cols / w, sy = p.rows / h;
  for (let j = 0; j < h; j++) {
    const ty = y + j;
    if (ty < 0 || ty >= f.rows) continue;
    for (let i = 0; i < w; i++) {
      const tx = x + i;
      if (tx < 0 || tx >= f.cols) continue;
      const ci = Math.min(p.cols - 1, Math.floor((i + 0.5) * sx)), cj = Math.min(p.rows - 1, Math.floor((j + 0.5) * sy));
      const c = cj * p.cols + ci;
      // Fond : moyenne de quelques échantillons du bloc (au plus 3 x 3).
      let r = 0, g = 0, b = 0, n = 0;
      const nx = Math.min(3, Math.max(1, Math.round(sx))), ny = Math.min(3, Math.max(1, Math.round(sy)));
      for (let v = 0; v < ny; v++) for (let u = 0; u < nx; u++) {
        const si = Math.min(p.cols - 1, Math.floor((i + (u + 0.5) / nx) * sx)), sj = Math.min(p.rows - 1, Math.floor((j + (v + 0.5) / ny) * sy));
        const k = (sj * p.cols + si) * 3;
        r += p.bg[k]; g += p.bg[k + 1]; b += p.bg[k + 2]; n++;
      }
      const d = ty * f.cols + tx, k4 = d * 4;
      f.ch[d] = p.ch[c];
      f.fg[k4] = p.fg[c * 3] * fade; f.fg[k4 + 1] = p.fg[c * 3 + 1] * fade; f.fg[k4 + 2] = p.fg[c * 3 + 2] * fade; f.fg[k4 + 3] = 255;
      f.bg[k4] = (r / n) * fade; f.bg[k4 + 1] = (g / n) * fade; f.bg[k4 + 2] = (b / n) * fade; f.bg[k4 + 3] = 255;
    }
  }
}

/** Police du jeu (posée sur <html> par next/font). */
function gameFont(): string {
  try {
    const f = getComputedStyle(document.documentElement).fontFamily;
    if (f) return f;
  } catch {
    // Pas de DOM : police par défaut.
  }
  return "monospace";
}

const rgb = (a: Uint8Array, k: number) => `rgb(${a[k]},${a[k + 1]},${a[k + 2]})`;

/** Rend la photo dans un canvas 2D : fonds, puis glyphes à la police du jeu, puis un bandeau de légende. */
export function photoCanvas(p: Photo, caption: string): HTMLCanvasElement {
  const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const cw = CELL_W * scale, chh = CELL_H * scale;
  const strip = Math.round(UI_FONT_SIZE * scale * 2.2);
  const cv = document.createElement("canvas");
  cv.width = p.cols * cw;
  cv.height = p.rows * chh + strip;
  const g = cv.getContext("2d")!;
  // Fonds : par segments de même couleur sur chaque rangée.
  for (let j = 0; j < p.rows; j++) {
    let i0 = 0;
    for (let i = 1; i <= p.cols; i++) {
      const a = (j * p.cols + i0) * 3, b = (j * p.cols + i) * 3;
      if (i < p.cols && p.bg[a] === p.bg[b] && p.bg[a + 1] === p.bg[b + 1] && p.bg[a + 2] === p.bg[b + 2]) continue;
      g.fillStyle = rgb(p.bg, a);
      g.fillRect(i0 * cw, j * chh, (i - i0) * cw, chh);
      i0 = i;
    }
  }
  // Glyphes, comme l'atlas du moteur (centrés dans la cellule).
  g.font = `${FONT_SIZE * scale}px ${gameFont()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let last = "";
  for (let j = 0; j < p.rows; j++) {
    for (let i = 0; i < p.cols; i++) {
      const c = j * p.cols + i, code = p.ch[c];
      if (code <= 32 || code > 126) continue;
      const col = rgb(p.fg, c * 3);
      if (col !== last) { g.fillStyle = col; last = col; }
      g.fillText(String.fromCharCode(code), i * cw + cw / 2, j * chh + chh / 2 + 0.5 * scale);
    }
  }
  // Bandeau de légende.
  const y0 = p.rows * chh;
  g.fillStyle = "#14121a";
  g.fillRect(0, y0, cv.width, strip);
  g.fillStyle = "#f2e6c8";
  g.font = `${UI_FONT_SIZE * scale}px ${gameFont()}`;
  g.textAlign = "left";
  g.fillText(ascii(caption), UI_FONT_SIZE * scale, y0 + strip / 2);
  return cv;
}

/** Télécharge la photo en PNG (paleoglyphes-<id>.png). */
export function downloadPng(p: Photo, caption: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      photoCanvas(p, caption).toBlob((blob) => {
        if (!blob) { resolve(false); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `paleoglyphes-${p.id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        resolve(true);
      }, "image/png");
    } catch {
      resolve(false);
    }
  });
}

/** Copie la photo en texte brut dans le presse-papiers. */
export async function copyText(p: Photo, caption: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`${photoText(p)}\n\n${ascii(caption)}\n`);
    return true;
  } catch {
    return false;
  }
}
