import { CELL_H, CELL_W } from "../config";
import type { Theme } from "../palette";
import type { Frame } from "./frame";

export interface PointLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}


const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Remplit la lumière de chaque cellule : lune ou soleil ambiant + lueur autour du joueur + vignettage,
 * puis la lumière d'accent des petites sources (feux follets, runes).
 */
export function computeLight(f: Frame, th: Theme, camX: number, camY: number, gx: number, gy: number, lights: PointLight[]) {
  const { cols, rows } = f;
  const [v0, v1] = th.vignette;
  const A = th.ambient, M = th.lightTint, G = th.glowTint;
  for (let y = 0; y < rows; y++) {
    const ny = (y / rows - 0.5) * 2;
    const py = (camY + y + 0.5) * CELL_H;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const nx = (x / cols - 0.5) * 2;
      const vig = 1 - smooth(v0, v1, Math.hypot(nx, ny * 0.9));
      const px = (camX + x + 0.5) * CELL_W;
      const d = Math.hypot(px - gx, (py - gy) * 1.25) / th.glowRadius;
      const g = d < 1 ? (1 - d) * (1 - d) * th.glow : 0;
      f.lr[i] = (M[0] * A + G[0] * g) * vig;
      f.lg[i] = (M[1] * A + G[1] * g) * vig;
      f.lb[i] = (M[2] * A + G[2] * g) * vig;
      f.acc[i] = 0;
    }
  }
  for (const l of lights) {
    if (l.intensity <= 0.01) continue;
    const x0 = Math.max(0, Math.floor((l.x - l.radius) / CELL_W) - camX);
    const x1 = Math.min(cols - 1, Math.ceil((l.x + l.radius) / CELL_W) - camX);
    const y0 = Math.max(0, Math.floor((l.y - l.radius) / CELL_H) - camY);
    const y1 = Math.min(rows - 1, Math.ceil((l.y + l.radius) / CELL_H) - camY);
    for (let y = y0; y <= y1; y++) {
      const py = (camY + y + 0.5) * CELL_H;
      for (let x = x0; x <= x1; x++) {
        const px = (camX + x + 0.5) * CELL_W;
        const d = Math.hypot(px - l.x, py - l.y) / l.radius;
        if (d < 1) f.acc[y * cols + x] += (1 - d) * (1 - d) * l.intensity;
      }
    }
  }
}
