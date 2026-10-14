import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières de l'Archelon (plage 200-207, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const AR = {
  /** Peau du cou, de la tête et des nageoires. */
  Skin: 200,
  /** Nageoires du côté opposé (dans l'ombre). */
  Far: 201,
  /** Carapace : peau épaisse et coriace tendue sur une charpente d'os. */
  Shell: 202,
  /** Crêtes longitudinales de la carapace (traits fins et bosses). */
  Ridge: 203,
  /** Plastron et gorge, pâles. */
  Belly: 204,
  /** Bec corné crochu. */
  Beak: 205,
  /** Taches claires de la peau (comme la tortue luth). */
  Spot: 206,
  /** Nageoires proches, bord de fuite plus clair. */
  Fin: 207,
} as const;

export const ARCHELON_MATS: MaterialSet = {
  // Nuit : cuir gris ardoise, crêtes pâles, ventre crème sale.
  dark: {
    [AR.Skin]: { color: hex("#4f5752"), ramp: ".:;=+xX%" },
    [AR.Far]: { color: hex("#272c2b"), ramp: ".:;=+" },
    [AR.Shell]: { color: hex("#3a413e"), ramp: ".:-=+*%#" },
    [AR.Ridge]: { color: hex("#7d8577"), ramp: "nmA" },
    [AR.Belly]: { color: hex("#8a8670"), ramp: ".,:;=+" },
    [AR.Beak]: { color: hex("#9a9076"), ramp: ":=)>" },
    [AR.Spot]: { color: hex("#8f978c"), ramp: ".o" },
    [AR.Fin]: { color: hex("#46504c"), ramp: ".:;=+x%" },
  },
  // Plein jour : tortue vert d'eau, carapace olive à crêtes dorées, ventre crème.
  cartoon: {
    [AR.Skin]: { color: hex("#5fae95"), ramp: ".:+oO0" },
    [AR.Far]: { color: hex("#33715f"), ramp: ":+o" },
    [AR.Shell]: { color: hex("#4e7a4c"), ramp: ":-=+*#" },
    [AR.Ridge]: { color: hex("#e9c85a"), ramp: "nmA" },
    [AR.Belly]: { color: hex("#f6ecc8"), ramp: ":=+=" },
    [AR.Beak]: { color: hex("#ffd24a"), ramp: "=)>" },
    [AR.Spot]: { color: hex("#c8f0dc"), ramp: "oO" },
    [AR.Fin]: { color: hex("#4c9c84"), ramp: ":+oO" },
  },
};
