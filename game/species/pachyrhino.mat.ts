import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières du Pachyrhinosaure (plage 310-319, voir render/materials.ts). */
export const PR = {
  Skin: 310,
  Far: 311,
  Belly: 312,
  /** Taches sombres du dos et de la queue. */
  Mottle: 313,
  /** Collerette. */
  Frill: 314,
  /** Bosse nasale et bosses au-dessus des yeux : os rugueux couvert de corne pâle. */
  Boss: 315,
  /** Pointes et petites cornes de la collerette, ongles des pattes. */
  Spike: 316,
  /** Bec corné. */
  Beak: 317,
  /** Motif de parade sur la collerette. */
  Pattern: 318,
  /** Grandes écailles en rosette sur le flanc. */
  Scale: 319,
} as const;

/** Matières Pachyrhinosaurus (ids 310-319), déclinées par style. */
export const PACHYRHINO_MATS: MaterialSet = {
  // Nuit : gris-brun froid, bosse blafarde.
  dark: {
    [PR.Skin]: { color: hex("#625a50"), ramp: ".:;=+xX%#" },
    [PR.Far]: { color: hex("#36322c"), ramp: ".:;=+x" },
    [PR.Belly]: { color: hex("#706a5e"), ramp: ".,:;=+" },
    [PR.Mottle]: { color: hex("#423c34"), ramp: ".:;=" },
    [PR.Frill]: { color: hex("#6e665a"), ramp: ".:=+oO0" },
    [PR.Boss]: { color: hex("#a49c8a"), ramp: ".:o%@" },
    [PR.Spike]: { color: hex("#b4ab96"), ramp: "'^AA" },
    [PR.Beak]: { color: hex("#848072"), ramp: ":=><" },
    [PR.Pattern]: { color: hex("#4c3f3a"), ramp: ":=oO" },
    [PR.Scale]: { color: hex("#4e483e"), ramp: ".oO" },
  },
  // Plein jour : brun-gris terreux de toundra, bosse crème, collerette à bandes rousses.
  cartoon: {
    [PR.Skin]: { color: hex("#9a8670"), ramp: ".:+oO0" },
    [PR.Far]: { color: hex("#6f5f4e"), ramp: ":+o" },
    [PR.Belly]: { color: hex("#eadfc8"), ramp: ":=+=" },
    [PR.Mottle]: { color: hex("#5e4e40"), ramp: "=+o" },
    [PR.Frill]: { color: hex("#d8c7a6"), ramp: ":oO0" },
    [PR.Boss]: { color: hex("#f2e6c8"), ramp: ":o%@" },
    [PR.Spike]: { color: hex("#fff6e2"), ramp: "^^AA" },
    [PR.Beak]: { color: hex("#4a4a5a"), ramp: "><" },
    [PR.Pattern]: { color: hex("#b5532e"), ramp: "=oO" },
    [PR.Scale]: { color: hex("#7c6a56"), ramp: "oO" },
  },
};
