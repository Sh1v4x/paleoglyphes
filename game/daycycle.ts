import type { RGB, Theme } from "./palette";

/**
 * Cycle jour / nuit de la réserve. L'horloge avance en heures de jeu (0..24) ;
 * la lumière du thème est recalculée à partir de l'heure.
 */

/** Durée réelle d'une journée complète à vitesse x1 (s). */
export const DAY_SECONDS = 480;
export const START_HOUR = 9;
/** Vitesses proposées par l'horloge (clic pour changer). */
export const CLOCK_SPEEDS = [1, 4, 16] as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Avance l'horloge (heures de jeu) de `dt` secondes réelles. */
export function advanceClock(hour: number, dt: number, speed: number): number {
  return (hour + (dt * speed * 24) / DAY_SECONDS) % 24;
}

/** Jour 1, nuit 0, avec aube (5h-7h) et crépuscule (18h-20h) progressifs. */
export function daylight(hour: number): number {
  if (hour < 5 || hour >= 20) return 0;
  if (hour < 7) return smooth((hour - 5) / 2);
  if (hour < 18) return 1;
  return smooth((20 - hour) / 2);
}

/** Lumière dorée : pic au lever et au coucher du soleil. */
export function golden(hour: number): number {
  const d = Math.min(Math.abs(hour - 6.3), Math.abs(hour - 18.8));
  return clamp01(1 - d / 1.4);
}

export const isNight = (hour: number) => daylight(hour) < 0.35;

export function clockLabel(hour: number): string {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 10) * 10).padStart(2, "0")}`;
}

export function periodName(hour: number): string {
  if (hour < 5) return "Nuit";
  if (hour < 7) return "Aube";
  if (hour < 11) return "Matin";
  if (hour < 14) return "Midi";
  if (hour < 18) return "Apres-midi";
  if (hour < 20) return "Crepuscule";
  return "Nuit";
}

const NIGHT_TINT: RGB = [0.5, 0.6, 1.0];
const GOLD_TINT: RGB = [1.0, 0.72, 0.5];
const LANTERN: RGB = [1.0, 0.85, 0.6];

/** Le thème éclairé à cette heure : ambiance, teinte, lanterne, vignettage, bestioles, reflets. */
export function litTheme(th: Theme, hour: number): Theme {
  const d = daylight(hour), n = 1 - d, g = golden(hour);
  const tint = mix(mix(NIGHT_TINT, th.lightTint, d), GOLD_TINT, g * 0.55);
  return {
    ...th,
    ambient: 0.36 + (th.ambient - 0.36) * d,
    lightTint: tint,
    glow: th.glow + n * 0.8,
    glowRadius: th.glowRadius + n * 60,
    glowTint: mix(th.glowTint, LANTERN, n),
    vignette: [0.95 - 0.4 * n, 2.1 - 0.65 * n],
    critters: n > 0.5 ? "fireflies" : "butterflies",
    water: n > 0.5 ? "moon" : "glints",
  };
}
