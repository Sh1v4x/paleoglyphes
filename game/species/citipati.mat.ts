import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Citipati (plage 340-349, voir render/materials.ts).
 * Oviraptoridé du désert : plumage d'émeu brun-gris, ailes à longues plumes de parade, éventail
 * au bout de la queue, haute crête arrondie (couleur vive en dessin animé) et bec corné sans dents.
 */
export const CIM = {
  /** Plumage du corps (côté proche). */
  Skin: 340,
  /** Côté lointain (pattes, aile), plus sombre. */
  Far: 341,
  /** Gorge et ventre pâles. */
  Belly: 342,
  /** Plumes (traits fins) : dos, cou. */
  Feather: 343,
  /** Grandes plumes des ailes et de l'éventail de la queue. */
  Wing: 344,
  /** Haute crête du crâne. */
  Crest: 345,
  /** Bec corné, sans dents. */
  Beak: 346,
  /** Œil. */
  Eye: 347,
  /** Barres sombres des plumes, masque. */
  Mark: 348,
  /** Griffes et pattes écailleuses. */
  Claw: 349,
} as const;

export const CITIPATI_MATS: MaterialSet = {
  // Nuit : brun-gris terne d'émeu, crête à peine plus claire, bec couleur de corne.
  dark: {
    [CIM.Skin]: { color: hex("#5a5046"), ramp: ".:;=+xX%" },
    [CIM.Far]: { color: hex("#312b26"), ramp: ".:;=+x" },
    [CIM.Belly]: { color: hex("#74685a"), ramp: ".,:;=+" },
    [CIM.Feather]: { color: hex("#665a4c"), ramp: "\"/" },
    [CIM.Wing]: { color: hex("#463c34"), ramp: ".-~=" },
    [CIM.Crest]: { color: hex("#7a5a48"), ramp: ".:=+#" },
    [CIM.Beak]: { color: hex("#9a907c"), ramp: ".:=#" },
    [CIM.Eye]: { color: hex("#d8b45a"), ramp: "o" },
    [CIM.Mark]: { color: hex("#221e1a"), ramp: ".:;" },
    [CIM.Claw]: { color: hex("#a59c86"), ramp: ")" },
  },
  // Plein jour : brun chaud, ailes barrées de noir et blanc, crête rouge vif, bec ivoire.
  cartoon: {
    [CIM.Skin]: { color: hex("#9a6e48"), ramp: ".:+oO0" },
    [CIM.Far]: { color: hex("#6c4a30"), ramp: ":+o" },
    [CIM.Belly]: { color: hex("#efe0c4"), ramp: ":=+=" },
    [CIM.Feather]: { color: hex("#5a3c26"), ramp: "\"/" },
    [CIM.Wing]: { color: hex("#2e2a2c"), ramp: "-~=+" },
    [CIM.Crest]: { color: hex("#e0443a"), ramp: "=+#@" },
    [CIM.Beak]: { color: hex("#f4e6c0"), ramp: ":=#" },
    [CIM.Eye]: { color: hex("#ffcf3a"), ramp: "O@" },
    [CIM.Mark]: { color: hex("#3a2616"), ramp: "=#" },
    [CIM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
