import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières du Protoceratops (plage 330-339, voir render/materials.ts). */
export const PR = {
  Skin: 330,
  Far: 331,
  Belly: 332,
  /** Bandes sombres du dos et de la queue. */
  Stripe: 333,
  Frill: 334,
  /** Bord épais de la collerette. */
  FrillEdge: 335,
  /** Taches de parade et fenêtres de la collerette. */
  FrillSpot: 336,
  /** Bec de perroquet. */
  Beak: 337,
  /** Ongles en sabots. */
  Nail: 338,
  /** Bosse du museau et pointe des joues. */
  Bump: 339,
} as const;

/** Matières Protoceratops (ids 330-339), déclinées par style. */
export const PROTOCERATOPS_MATS: MaterialSet = {
  // Nuit : sable gris et ocre éteint, comme les dunes sous la lune.
  dark: {
    [PR.Skin]: { color: hex("#7a6a4e"), ramp: ".:;=+xX%#" },
    [PR.Far]: { color: hex("#423929"), ramp: ".:;=+x" },
    [PR.Belly]: { color: hex("#857a60"), ramp: ".,:;=+" },
    [PR.Stripe]: { color: hex("#3e3324"), ramp: ".:;" },
    [PR.Frill]: { color: hex("#8a7a5c"), ramp: ".:=+oO0" },
    [PR.FrillEdge]: { color: hex("#4e3e2c"), ramp: ":=#" },
    [PR.FrillSpot]: { color: hex("#5e3a2e"), ramp: ".:oO" },
    [PR.Beak]: { color: hex("#8c8270"), ramp: ":=><" },
    [PR.Nail]: { color: hex("#aca08a"), ramp: "'^AA" },
    [PR.Bump]: { color: hex("#9a8c72"), ramp: ".^n" },
  },
  // Plein jour : ocre sable du Gobi, collerette crème bordée de brun, taches rouille.
  cartoon: {
    [PR.Skin]: { color: hex("#e0b066"), ramp: ".:+oO0" },
    [PR.Far]: { color: hex("#b08442"), ramp: ":+o" },
    [PR.Belly]: { color: hex("#fbe8bc"), ramp: ":=+=" },
    [PR.Stripe]: { color: hex("#9a6430"), ramp: "=#" },
    [PR.Frill]: { color: hex("#f6dca4"), ramp: ":oO0" },
    [PR.FrillEdge]: { color: hex("#8a5228"), ramp: "=#" },
    [PR.FrillSpot]: { color: hex("#c8562e"), ramp: "oO@" },
    [PR.Beak]: { color: hex("#4a4650"), ramp: "><" },
    [PR.Nail]: { color: hex("#fff6e2"), ramp: "^^AA" },
    [PR.Bump]: { color: hex("#f2d08a"), ramp: "^n" },
  },
};
