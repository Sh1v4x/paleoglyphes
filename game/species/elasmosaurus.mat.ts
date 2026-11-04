import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières de l'Elasmosaure (plage 400-409, voir render/materials.ts).
 * Contre-ombrage : dos sombre, flancs gris-bleu, ventre pâle (comme beaucoup d'animaux marins).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const EL = {
  /** Dos et dessus du cou, sombres. */
  Back: 400,
  /** Flancs du corps et du cou. */
  Skin: 401,
  /** Ventre, gorge et dessous du cou, pâles. */
  Belly: 402,
  /** Nageoires du côté opposé (dans l'ombre). */
  Far: 403,
  /** Nageoires proches, longues pales. */
  Fin: 404,
  /** Longues dents en aiguille. */
  Tooth: 405,
  /** Taches claires du dos. */
  Spot: 406,
  /** Poisson attrapé (proie). */
  Fish: 407,
  /** Bulles et souffle à la surface. */
  Bubble: 408,
  /** Paupière close et commissure des lèvres (trait fin). */
  Lid: 409,
} as const;

export const ELASMOSAURUS_MATS: MaterialSet = {
  // Nuit : dos bleu ardoise, flancs gris-bleu, ventre gris perle.
  dark: {
    [EL.Back]: { color: hex("#2c3a46"), ramp: ".:;=+x%#" },
    [EL.Skin]: { color: hex("#4b5d6b"), ramp: ".:;=+xX%" },
    [EL.Belly]: { color: hex("#8e9a9e"), ramp: ".,:;=+" },
    [EL.Far]: { color: hex("#222c35"), ramp: ".:;=+" },
    [EL.Fin]: { color: hex("#40525f"), ramp: ".:;=+x%" },
    [EL.Tooth]: { color: hex("#d6d2c0"), ramp: "!|" },
    [EL.Spot]: { color: hex("#6f8494"), ramp: ".o" },
    [EL.Fish]: { color: hex("#9fb3b8"), ramp: ":=<" },
    [EL.Bubble]: { color: hex("#7f98a8"), ramp: ".oO" },
    [EL.Lid]: { color: hex("#161d24"), ramp: "-" },
  },
  // Plein jour : dos bleu pétrole, flancs bleu-gris, ventre crème, nageoires turquoise.
  cartoon: {
    [EL.Back]: { color: hex("#2f5d7c"), ramp: ":-=+*#" },
    [EL.Skin]: { color: hex("#5b8fae"), ramp: ".:+oO0" },
    [EL.Belly]: { color: hex("#f2ead2"), ramp: ":=+=" },
    [EL.Far]: { color: hex("#2b4c63"), ramp: ":+o" },
    [EL.Fin]: { color: hex("#4fa3b4"), ramp: ":+oO" },
    [EL.Tooth]: { color: hex("#ffffff"), ramp: "!|" },
    [EL.Spot]: { color: hex("#a8d4ea"), ramp: "oO" },
    [EL.Fish]: { color: hex("#d8e8f0"), ramp: "=<" },
    [EL.Bubble]: { color: hex("#cdeefa"), ramp: "oO" },
    [EL.Lid]: { color: hex("#1b2a3a"), ramp: "-" },
  },
};
