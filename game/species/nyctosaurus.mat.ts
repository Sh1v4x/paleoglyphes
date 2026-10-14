import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Nyctosaurus (plage 222-228, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const NY = {
  /** Peau du corps, du cou et de la tête. */
  Skin: 222,
  /** Membres et aile du côté opposé (dans l'ombre). */
  Far: 223,
  /** Gorge et ventre clairs (comme une frégate ou un albatros). */
  Belly: 224,
  /** Membrane de l'aile proche, longue et étroite. */
  Wing: 225,
  /** Membrane de l'aile lointaine. */
  WingFar: 226,
  /** Bec pointu sans dents. */
  Beak: 227,
  /** Immense crête en bois de cerf (traits fins). */
  Crest: 228,
} as const;

export const NYCTOSAURUS_MATS: MaterialSet = {
  // Nuit : sombre comme une frégate, crête couleur de corne.
  dark: {
    [NY.Skin]: { color: hex("#4e4a52"), ramp: ".:;=+xX%#" },
    [NY.Far]: { color: hex("#29262c"), ramp: ".:;=+x" },
    [NY.Belly]: { color: hex("#837d84"), ramp: ".,:;=+" },
    [NY.Wing]: { color: hex("#46394d"), ramp: ".-~=+" },
    [NY.WingFar]: { color: hex("#241d28"), ramp: ".-~=" },
    [NY.Beak]: { color: hex("#8f8872"), ramp: ":=+#" },
    [NY.Crest]: { color: hex("#9a7442"), ramp: ":=+#" },
  },
  // Plein jour : dos et ailes anthracite, ventre blanc, crête dorée.
  cartoon: {
    [NY.Skin]: { color: hex("#4a5163"), ramp: ".:+oO0" },
    [NY.Far]: { color: hex("#2c3140"), ramp: ":+o" },
    [NY.Belly]: { color: hex("#f6f1e6"), ramp: ":=+=" },
    [NY.Wing]: { color: hex("#3a4052"), ramp: "-~=+" },
    [NY.WingFar]: { color: hex("#252a37"), ramp: "-~=" },
    [NY.Beak]: { color: hex("#d9cfa8"), ramp: "=+#" },
    [NY.Crest]: { color: hex("#f2a72c"), ramp: "=+#" },
  },
};
