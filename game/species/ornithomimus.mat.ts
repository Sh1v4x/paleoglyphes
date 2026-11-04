import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières de l'Ornithomimus (plage 350-359, voir render/materials.ts).
 * « Dinosaure autruche » de Hell Creek : plumage sable et gris-brun, dessous pâle, ailes des bras
 * plus sombres, longues pattes nues et écailleuses, petit bec corné sans dents.
 */
export const OMM = {
  /** Plumage du corps (côté proche). */
  Skin: 350,
  /** Côté lointain (patte, aile), plus sombre. */
  Far: 351,
  /** Gorge, poitrail et ventre pâles. */
  Belly: 352,
  /** Plumes (traits fins) : dos, cuisses, queue. */
  Feather: 353,
  /** Grandes plumes sombres des bras (ailes des adultes). */
  Wing: 354,
  /** Bec corné, sans dents. */
  Beak: 355,
  /** Œil. */
  Eye: 356,
  /** Rayures sombres du dos, trait du bec fermé. */
  Mark: 357,
  /** Griffes des mains et des pieds. */
  Claw: 358,
  /** Longues pattes nues, écailleuses. */
  Leg: 359,
} as const;

export const ORNITHOMIMUS_MATS: MaterialSet = {
  // Nuit : gris-brun sableux, ailes presque noires, pattes grises, bec couleur de corne.
  dark: {
    [OMM.Skin]: { color: hex("#5e5546"), ramp: ".:;=+xX%" },
    [OMM.Far]: { color: hex("#332e27"), ramp: ".:;=+x" },
    [OMM.Belly]: { color: hex("#7c7362"), ramp: ".,:;=+" },
    [OMM.Feather]: { color: hex("#6c6250"), ramp: "\"'" },
    [OMM.Wing]: { color: hex("#3a332c"), ramp: ".-~=" },
    [OMM.Beak]: { color: hex("#8e8676"), ramp: ".:=#" },
    [OMM.Eye]: { color: hex("#c8b070"), ramp: "o" },
    [OMM.Mark]: { color: hex("#25211c"), ramp: ".:;" },
    [OMM.Claw]: { color: hex("#a39a86"), ramp: ")" },
    [OMM.Leg]: { color: hex("#4c4740"), ramp: ".:;=+" },
  },
  // Plein jour : sable doré, ventre crème, ailes brun chocolat, pattes gris bleuté, bec gris.
  cartoon: {
    [OMM.Skin]: { color: hex("#c09a62"), ramp: ".:+oO0" },
    [OMM.Far]: { color: hex("#8a6a40"), ramp: ":+o" },
    [OMM.Belly]: { color: hex("#f3e8cc"), ramp: ":=+=" },
    [OMM.Feather]: { color: hex("#8c6a3e"), ramp: "\"'" },
    [OMM.Wing]: { color: hex("#4e3424"), ramp: "-~=+" },
    [OMM.Beak]: { color: hex("#6e6a66"), ramp: ":=#" },
    [OMM.Eye]: { color: hex("#2a1e14"), ramp: "O@" },
    [OMM.Mark]: { color: hex("#5a3e22"), ramp: "=#" },
    [OMM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
    [OMM.Leg]: { color: hex("#7c8490"), ramp: ":=+o" },
  },
};
