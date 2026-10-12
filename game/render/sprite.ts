import type { RGB, Theme } from "../palette";
import { hash2 } from "../rng";
import { setBg, setFg, type Frame } from "./frame";
import type { Raster } from "./raster";

export interface SpriteOpts {
  /** Multiplicateur de luminosité (1 = normal). */
  light?: number;
  /** Remplace la couleur de toutes les matières (silhouette, fantôme, verrouillé). */
  tint?: RGB;
  /** Dessine seulement un glyphe pâle sur une cellule sur deux (os manquant, aperçu). */
  ghost?: boolean;
  /** Fond des cellules : true = rempli selon le thème, false = laisser le fond existant. */
  fill?: boolean;
}

const code = (s: string, i: number) => s.charCodeAt(Math.min(s.length - 1, Math.max(0, i)));

/**
 * Dessine une raster dans un calque monde, à la cellule écran (x0, y0), avec un éclairage de studio
 * (indépendant du monde) : sert à l'atelier, au carnet, aux fiches.
 * La raster doit avoir été rastérisée à l'origine 0,0 : ses cellules vont de (cx, cy) à (cx+w, cy+h).
 */
export function drawRaster(f: Frame, th: Theme, r: Raster, x0: number, y0: number, o: SpriteOpts = {}) {
  const light = o.light ?? 1;
  const P = th.pal;
  for (let j = 0; j < r.h; j++) {
    const y = y0 + r.cy + j;
    if (y < 0 || y >= f.rows) continue;
    for (let i = 0; i < r.w; i++) {
      const x = x0 + r.cx + i;
      if (x < 0 || x >= f.cols) continue;
      const k = j * r.w + i;
      const mat = r.mat[k];
      if (!mat) continue;
      const idx = y * f.cols + x;
      const m = th.mats[mat];
      let lum = r.lum[k];
      if (th.cel) lum = lum < 0.42 ? 0.32 : lum < 0.7 ? 0.62 : 0.95;
      const c = o.tint ?? m.color;
      if (o.ghost) {
        if ((x + y) % 2) continue;
        f.ch[idx] = 46; // .
        setFg(f, idx, c[0] * 0.6 * light, c[1] * 0.6 * light, c[2] * 0.6 * light);
        continue;
      }
      const gl = Math.min(0.999, lum + (hash2(x, y, 11) - 0.5) * th.dither);
      f.ch[idx] = r.glyph[k] || code(m.ramp, Math.floor(gl * m.ramp.length));
      const shade = m.emissive && !o.tint ? 1 : (0.3 + 0.95 * lum) * light;
      setFg(f, idx, c[0] * shade, c[1] * shade, c[2] * shade);
      if (o.fill !== false) {
        const bk = th.spriteFill * shade * 0.9;
        setBg(f, idx, P.void[0] * (1 - bk) + c[0] * bk, P.void[1] * (1 - bk) + c[1] * bk, P.void[2] * (1 - bk) + c[2] * bk);
      }
    }
  }
}

/** Remplit tout le calque monde d'un fond uni (écrans hors réserve). */
export function clearWorld(f: Frame, bg: RGB, ch = 32, fg: RGB = bg) {
  for (let i = 0; i < f.cols * f.rows; i++) {
    f.ch[i] = ch;
    setFg(f, i, fg[0], fg[1], fg[2]);
    setBg(f, i, bg[0], bg[1], bg[2]);
  }
}
