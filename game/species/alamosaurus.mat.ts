import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières de l'Alamosaure (plage 246-254, voir render/materials.ts). */
export const AL = {
  Skin: 246,
  Far: 247,
  Belly: 248,
  /** Grandes taches de la peau (flancs, cou, queue). */
  Mottle: 249,
  /** Ostéodermes : plaques osseuses semées dans la peau. */
  Osteo: 250,
  /** Griffes des pattes arrière. */
  Nail: 251,
  /** Museau et lèvres, plus clairs. */
  Face: 252,
  /** Plis de la peau aux genoux et aux coudes. */
  Wrinkle: 253,
  /** Crête de petites écailles le long du dos. */
  Ridge: 254,
} as const;

/** Matières Alamosaurus (ids 246-254), déclinées par style. */
export const ALAMOSAURUS_MATS: MaterialSet = {
  // Nuit : gris-brun olivâtre, éteint.
  dark: {
    [AL.Skin]: { color: hex("#69654f"), ramp: ".:;=+xX%#" },
    [AL.Far]: { color: hex("#3a382c"), ramp: ".:;=+x" },
    [AL.Belly]: { color: hex("#7a755f"), ramp: ".,:;=+" },
    [AL.Mottle]: { color: hex("#4c4939"), ramp: ".:;=" },
    [AL.Osteo]: { color: hex("#8e8672"), ramp: ".oO0" },
    [AL.Nail]: { color: hex("#aaa08a"), ramp: "'^AA" },
    [AL.Face]: { color: hex("#7e7862"), ramp: ":;=+" },
    [AL.Wrinkle]: { color: hex("#45422f"), ramp: "-=~" },
    [AL.Ridge]: { color: hex("#56523f"), ramp: ".:^" },
  },
  // Plein jour : vert sauge doux et taches foncées, plaques dorées : un géant sympathique.
  cartoon: {
    [AL.Skin]: { color: hex("#8fb46c"), ramp: ".:+oO0" },
    [AL.Far]: { color: hex("#668a4a"), ramp: ":+o" },
    [AL.Belly]: { color: hex("#f1ebc2"), ramp: ":=+=" },
    [AL.Mottle]: { color: hex("#5e8a48"), ramp: "=+o" },
    [AL.Osteo]: { color: hex("#e2b85a"), ramp: "oO0" },
    [AL.Nail]: { color: hex("#fff6e2"), ramp: "^^AA" },
    [AL.Face]: { color: hex("#b6d48e"), ramp: ":=+o" },
    [AL.Wrinkle]: { color: hex("#4f7a3c"), ramp: "-=~" },
    [AL.Ridge]: { color: hex("#4f7a3c"), ramp: ":^" },
  },
};
