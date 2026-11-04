import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Troodontidé d'Alaska (plage 370-379, voir render/materials.ts).
 * Troodontidé polaire nocturne : épais plumage d'hiver gris-blanc moucheté (camouflage dans la
 * neige), masque sombre autour des yeux, et d'immenses yeux ambrés qui brillent dans la nuit polaire.
 */
export const TM = {
  /** Plumage du corps (côté proche), gris pâle. */
  Skin: 370,
  /** Côté lointain (pattes, aile), plus sombre. */
  Far: 371,
  /** Ventre, gorge et duvet épais, presque blancs. */
  Belly: 372,
  /** Plumes (traits fins) : dos, nuque, rémiges. */
  Feather: 373,
  /** Duvet gonflé (collerette, culottes, frange de la queue). */
  Down: 374,
  /** Immense œil nocturne, lumineux. */
  Eye: 375,
  /** Masque sombre autour des yeux, bandes de la queue. */
  Mask: 376,
  /** Mouchetures sombres du plumage. */
  Speck: 377,
  /** Griffes (faucille, mains) et pattes écailleuses. */
  Claw: 378,
} as const;

export const TROODON_MATS: MaterialSet = {
  // Nuit polaire : gris bleuté presque blanc, mouchetures charbon ; seuls les yeux s'allument, ambre.
  dark: {
    [TM.Skin]: { color: hex("#8e939a"), ramp: ".:;=+xX%" },
    [TM.Far]: { color: hex("#4d5258"), ramp: ".:;=+x" },
    [TM.Belly]: { color: hex("#b4b8bd"), ramp: ".,:;=+" },
    [TM.Feather]: { color: hex("#a3a8ae"), ramp: "\"/" },
    [TM.Down]: { color: hex("#9da2a8"), ramp: ".:~=*" },
    [TM.Eye]: { color: hex("#ffb23a"), ramp: "O", emissive: true },
    [TM.Mask]: { color: hex("#25272b"), ramp: ".:;" },
    [TM.Speck]: { color: hex("#3a3d42"), ramp: ".:" },
    [TM.Claw]: { color: hex("#b8b0a0"), ramp: ")" },
  },
  // Plein jour : blanc neige, mouchetures ardoise, masque noir, gros yeux ambre orangé.
  cartoon: {
    [TM.Skin]: { color: hex("#e6ebf0"), ramp: ".:+oO0" },
    [TM.Far]: { color: hex("#a9b3be"), ramp: ":+o" },
    [TM.Belly]: { color: hex("#ffffff"), ramp: ":=+=" },
    [TM.Feather]: { color: hex("#7d8896"), ramp: "\"/" },
    [TM.Down]: { color: hex("#f4f7fa"), ramp: ".:~=*" },
    [TM.Eye]: { color: hex("#ffa62b"), ramp: "O@" },
    [TM.Mask]: { color: hex("#20232b"), ramp: "=#" },
    [TM.Speck]: { color: hex("#4a5361"), ramp: ":=" },
    [TM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
