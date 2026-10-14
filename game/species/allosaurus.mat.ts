import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières de l'Allosaurus (plage 237-245, voir render/materials.ts).
 * Grand théropode du Jurassique : peau écailleuse rayée en travers, ventre pâle,
 * petites cornes vives au-dessus des yeux (parade), griffes et dents en lame.
 */
export const AM = {
  Skin: 237,
  /** Côté lointain (patte et bras), plus sombre. */
  Far: 238,
  /** Bandes transversales et arête du dos. */
  Back: 239,
  Belly: 240,
  /** Écailles en bosses. */
  Scale: 241,
  /** Cornes lacrymales au-dessus des yeux, colorées pour la parade. */
  Horn: 242,
  /** Dents en lame (pointe vers le bas). */
  Tooth: 243,
  /** Intérieur de la gueule. */
  Mouth: 244,
  /** Grandes griffes des mains et des pieds. */
  Claw: 245,
} as const;

export const ALLOSAURUS_MATS: MaterialSet = {
  // Nuit : brun-gris terne, rayures presque noires, cornes d'un rouge éteint.
  dark: {
    [AM.Skin]: { color: hex("#5e5644"), ramp: ".:;=+xX%#" },
    [AM.Far]: { color: hex("#33302a"), ramp: ".:;=+x" },
    [AM.Back]: { color: hex("#29251e"), ramp: ":;=x#" },
    [AM.Belly]: { color: hex("#7e735e"), ramp: ".,:;=+" },
    [AM.Scale]: { color: hex("#4e4a3b"), ramp: ".,:o" },
    [AM.Horn]: { color: hex("#7c4436"), ramp: ":=A" },
    [AM.Tooth]: { color: hex("#c9bfa6"), ramp: "vV" },
    [AM.Mouth]: { color: hex("#1c1214"), ramp: " .:" },
    [AM.Claw]: { color: hex("#a59c86"), ramp: ")" },
  },
  // Plein jour : vert olive rayé de brun, ventre crème, cornes rouge vif.
  cartoon: {
    [AM.Skin]: { color: hex("#86a24a"), ramp: ".:+oO0" },
    [AM.Far]: { color: hex("#5a7430"), ramp: ":+o" },
    [AM.Back]: { color: hex("#4c3a24"), ramp: "=#" },
    [AM.Belly]: { color: hex("#f4ecc4"), ramp: ":=+=" },
    [AM.Scale]: { color: hex("#6c8a38"), ramp: "oO" },
    [AM.Horn]: { color: hex("#e8463a"), ramp: "=A" },
    [AM.Tooth]: { color: hex("#ffffff"), ramp: "vV" },
    [AM.Mouth]: { color: hex("#7a1e2e"), ramp: "::" },
    [AM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
