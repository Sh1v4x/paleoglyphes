import { clamp01, mixRgb, smooth01 } from "./math";
import type { Theme } from "./palette";
import { STORAGE_KEYS } from "./storage-keys";

/**
 * Cycle jour / nuit de la réserve. L'horloge avance en heures de jeu (0..24) ;
 * la lumière du thème est recalculée à partir de l'heure.
 */

/** Durée réelle d'une journée complète à vitesse x1 (s). */
export const DAY_SECONDS = 480;
export const START_HOUR = 9;
/** Vitesses proposées par l'horloge (clic pour changer). */
export const CLOCK_SPEEDS = [1, 4, 16] as const;

export interface Clock {
  /** Heure de jeu (0..24). */
  clock: number;
  clockSpeed: number;
  /** Jour de la réserve, compté à chaque passage de minuit, où que soit le joueur. */
  day: number;
}

/** Avance l'horloge de `dt` secondes réelles et compte les minuits franchis (gardés dans le navigateur). */
export function advanceClock(c: Clock, dt: number): void {
  const h = c.clock + (dt * c.clockSpeed * 24) / DAY_SECONDS;
  c.clock = h % 24;
  const days = Math.floor(h / 24);
  if (!days) return;
  c.day += days;
  try {
    localStorage.setItem(STORAGE_KEYS.day, String(c.day));
  } catch {
    // Sans stockage, le jour repart de 1 au prochain chargement.
  }
}

export function loadDay(): number {
  try {
    return Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.day)) || 1);
  } catch {
    return 1;
  }
}

/** Jour 1, nuit 0, avec aube (5h-7h) et crépuscule (18h-20h) progressifs. */
export function daylight(hour: number): number {
  if (hour < 5 || hour >= 20) return 0;
  if (hour < 7) return smooth01((hour - 5) / 2);
  if (hour < 18) return 1;
  return smooth01((20 - hour) / 2);
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


/**
 * Le thème éclairé à cette heure : ambiance, teinte, lanterne, vignettage, bestioles, reflets.
 * `d` et `g` remplacent la lumière et l'heure dorée de l'horloge (jour et nuit polaires de la toundra).
 */
export function litTheme(th: Theme, hour: number, d = daylight(hour), g = golden(hour)): Theme {
  const n = 1 - d;
  const tint = mixRgb(mixRgb(th.nightTint, th.lightTint, d), th.goldTint, g * 0.55);
  return {
    ...th,
    ambient: 0.36 + (th.ambient - 0.36) * d,
    lightTint: tint,
    glow: th.glow + n * 0.8,
    glowRadius: th.glowRadius + n * 60,
    glowTint: mixRgb(th.glowTint, th.lanternTint, n),
    vignette: [0.95 - 0.4 * n, 2.1 - 0.65 * n],
    critters: n > 0.5 ? "fireflies" : "butterflies",
    water: n > 0.5 ? "moon" : "glints",
  };
}
