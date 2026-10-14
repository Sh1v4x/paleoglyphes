import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Pteranodon (plage 214-221, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const PT = {
  /** Peau du corps, du cou et de la tête (fin duvet de pycnofibres). */
  Skin: 214,
  /** Membres et aile du côté opposé (dans l'ombre). */
  Far: 215,
  /** Gorge et ventre, pâles comme un oiseau de mer. */
  Belly: 216,
  /** Membrane de l'aile proche. */
  Wing: 217,
  /** Membrane de l'aile lointaine. */
  WingFar: 218,
  /** Long bec corné sans dents. */
  Beak: 219,
  /** Grande crête osseuse dirigée vers l'arrière. */
  Crest: 220,
  /** Actinofibrilles : fibres raidissant la membrane (traits fins). */
  Vein: 221,
} as const;

export const PTERANODON_MATS: MaterialSet = {
  // Nuit : gris d'oiseau de mer, ailes ardoise, crête rouille.
  dark: {
    [PT.Skin]: { color: hex("#5d5a55"), ramp: ".:;=+xX%#" },
    [PT.Far]: { color: hex("#302e2c"), ramp: ".:;=+x" },
    [PT.Belly]: { color: hex("#8a867e"), ramp: ".,:;=+" },
    [PT.Wing]: { color: hex("#414753"), ramp: ".-~=+" },
    [PT.WingFar]: { color: hex("#23272e"), ramp: ".-~=" },
    [PT.Beak]: { color: hex("#9c8e68"), ramp: ":=+#" },
    [PT.Crest]: { color: hex("#8c4b36"), ramp: ":=+A" },
    [PT.Vein]: { color: hex("#5b6373"), ramp: "-" },
  },
  // Plein jour : corps blanc de goéland, ailes bleu ardoise, bec jaune, crête rouge-orangé.
  cartoon: {
    [PT.Skin]: { color: hex("#f2eee4"), ramp: ".:+oO0" },
    [PT.Far]: { color: hex("#bbb4a4"), ramp: ":+o" },
    [PT.Belly]: { color: hex("#ffffff"), ramp: ":=+=" },
    [PT.Wing]: { color: hex("#56718f"), ramp: "-~=+" },
    [PT.WingFar]: { color: hex("#364b62"), ramp: "-~=" },
    [PT.Beak]: { color: hex("#f4c44e"), ramp: "=+#" },
    [PT.Crest]: { color: hex("#e4522c"), ramp: "=A#" },
    [PT.Vein]: { color: hex("#24364a"), ramp: "-" },
  },
};
