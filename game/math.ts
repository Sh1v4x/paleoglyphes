import type { RGB } from "./palette";

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hermite ease of `t` clamped to [0, 1]. */
export const smooth01 = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };

export const smoothstep = (a: number, b: number, x: number) => smooth01((x - a) / (b - a));

export const mixRgb = (a: RGB, b: RGB, t: number): RGB =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const scaleRgb = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
