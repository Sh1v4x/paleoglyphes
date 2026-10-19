import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Nanuqsaurus (plage 300-309, voir render/materials.ts).
 * Tyrannosaure polaire : courte toison de proto-plumes (hypothèse) gris-brun tachetée,
 * ventre plus pâle, marques sombres, museau rugueux, dents et griffes claires.
 */
export const NM = {
  /** Toison principale, gris-brun. */
  Coat: 300,
  /** Côté lointain (patte et bras), plus sombre. */
  Far: 301,
  /** Dos et marques sombres. */
  Back: 302,
  Belly: 303,
  /** Mèches de duvet ébouriffé sur le bord du cou et du dos. */
  Fuzz: 304,
  /** Taches claires de la robe. */
  Mottle: 305,
  /** Dents (pointe vers le bas). */
  Tooth: 306,
  /** Intérieur de la gueule. */
  Mouth: 307,
  Claw: 308,
  /** Rugosités du museau et arcade au-dessus de l'œil. */
  Brow: 309,
} as const;

export const NANUQ_MATS: MaterialSet = {
  // Nuit : gris-brun froid, marques presque noires, duvet argenté sous la lune.
  dark: {
    [NM.Coat]: { color: hex("#5d5a52"), ramp: ".:;=+xX%#" },
    [NM.Far]: { color: hex("#33312d"), ramp: ".:;=+x" },
    [NM.Back]: { color: hex("#2a2724"), ramp: ":;=x#" },
    [NM.Belly]: { color: hex("#8a857a"), ramp: ".,:;=+" },
    [NM.Fuzz]: { color: hex("#77736a"), ramp: "',\"" },
    [NM.Mottle]: { color: hex("#7a756a"), ramp: ".,:o" },
    [NM.Tooth]: { color: hex("#c9bfa6"), ramp: "vV" },
    [NM.Mouth]: { color: hex("#1c1214"), ramp: " .:" },
    [NM.Claw]: { color: hex("#a59c86"), ramp: ")" },
    [NM.Brow]: { color: hex("#6a6253"), ramp: ":=+o" },
  },
  // Plein jour : brun-taupe chaud tacheté de crème, dos chocolat, ventre neige, arcade orangée.
  cartoon: {
    [NM.Coat]: { color: hex("#a98c6c"), ramp: ".:+oO0" },
    [NM.Far]: { color: hex("#735c44"), ramp: ":+o" },
    [NM.Back]: { color: hex("#4e3a2c"), ramp: "=#" },
    [NM.Belly]: { color: hex("#f4f0e6"), ramp: ":=+=" },
    [NM.Fuzz]: { color: hex("#d8c7ae"), ramp: "\"'" },
    [NM.Mottle]: { color: hex("#efe2c8"), ramp: "oO" },
    [NM.Tooth]: { color: hex("#ffffff"), ramp: "vV" },
    [NM.Mouth]: { color: hex("#7a1e2e"), ramp: "::" },
    [NM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
    [NM.Brow]: { color: hex("#e07a3a"), ramp: "=oO" },
  },
};
