import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières du Pinacosaure (plage 390-399, voir render/materials.ts). */
export const PN = {
  Skin: 390,
  Far: 391,
  Belly: 392,
  /** Peau du dos entre les ostéodermes, plus sombre. */
  Back: 393,
  /** Ostéodermes : plaques d'os de l'armure. */
  Plate: 394,
  /** Pointes en kératine, pâles au bout. */
  Spike: 395,
  Club: 396,
  /** Bec corné. */
  Beak: 397,
  /** Narines multiples (trous sombres autour du nez). */
  Nare: 398,
  /** Sillons sombres entre les rangées de plaques. */
  Band: 399,
} as const;

/** Matières Pinacosaure (ids 390-399), déclinées par style. */
export const PINACOSAURUS_MATS: MaterialSet = {
  // Nuit : ocre sable éteint, plaques brun-gris, pointes pâles sous la lune.
  dark: {
    [PN.Skin]: { color: hex("#7c6a4a"), ramp: ".:;=+xX#" },
    [PN.Far]: { color: hex("#433826"), ramp: ".:;=+x" },
    [PN.Belly]: { color: hex("#8a7c5e"), ramp: ".,:;=+" },
    [PN.Back]: { color: hex("#5e4e36"), ramp: ".:;=+xX%#" },
    [PN.Plate]: { color: hex("#6e5e44"), ramp: ":=+oO0Q@" },
    [PN.Spike]: { color: hex("#b4aa94"), ramp: "'^^AA" },
    [PN.Club]: { color: hex("#9a8a6c"), ramp: ":=oO0@" },
    [PN.Beak]: { color: hex("#8c8270"), ramp: ":=><" },
    [PN.Nare]: { color: hex("#1e1810"), ramp: "oo" },
    [PN.Band]: { color: hex("#3a2f20"), ramp: ".:;" },
  },
  // Plein jour : ocre du Gobi, armure brun chaud, pointes crème, massue claire.
  cartoon: {
    [PN.Skin]: { color: hex("#d8a660"), ramp: ".:+oO0" },
    [PN.Far]: { color: hex("#a87a3c"), ramp: ":+o" },
    [PN.Belly]: { color: hex("#f6e2b4"), ramp: ":=+=" },
    [PN.Back]: { color: hex("#b07a3e"), ramp: ".:+oO0" },
    [PN.Plate]: { color: hex("#8a5a2c"), ramp: "oO0@" },
    [PN.Spike]: { color: hex("#fff2d8"), ramp: "^^AA" },
    [PN.Club]: { color: hex("#e8cc94"), ramp: "oO0@" },
    [PN.Beak]: { color: hex("#4a4650"), ramp: "><" },
    [PN.Nare]: { color: hex("#3a2414"), ramp: "oo" },
    [PN.Band]: { color: hex("#6e4420"), ramp: "=#" },
  },
};
