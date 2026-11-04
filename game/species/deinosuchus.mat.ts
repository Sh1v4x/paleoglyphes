import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Deinosuchus (plage 360-369, voir render/materials.ts).
 * Alligatoroïde géant des marais : dos blindé olive sombre, ventre pâle, rangées d'ostéodermes,
 * grosses dents émoussées, œil jaune de reptile.
 */
export const DE = {
  Skin: 360,
  /** Côté lointain (pattes), plus sombre. */
  Far: 361,
  Belly: 362,
  /** Ostéodermes : bosses osseuses du dos et crête de la queue. */
  Scute: 363,
  /** Bandes sombres en travers de la queue. */
  Band: 364,
  /** Dents émoussées. */
  Tooth: 365,
  /** Intérieur de la gueule. */
  Mouth: 366,
  /** Œil de reptile (luit la nuit comme celui des crocodiles). */
  Eye: 367,
  /** Paupière close, narines, lèvres. */
  Lid: 368,
  /** Griffes. */
  Claw: 369,
} as const;

export const DEINOSUCHUS_MATS: MaterialSet = {
  // Nuit : vert-de-gris boueux, presque noir sur le dos, œil qui renvoie la lumière.
  dark: {
    [DE.Skin]: { color: hex("#4c5640"), ramp: ".:;=+xX%#" },
    [DE.Far]: { color: hex("#2b3126"), ramp: ".:;=+x" },
    [DE.Belly]: { color: hex("#7c7c62"), ramp: ".,:;=+" },
    [DE.Scute]: { color: hex("#3a4232"), ramp: ".nmA" },
    [DE.Band]: { color: hex("#272c22"), ramp: ":;=" },
    [DE.Tooth]: { color: hex("#c4bc9e"), ramp: "vV" },
    [DE.Mouth]: { color: hex("#2a1a1a"), ramp: " .:" },
    [DE.Eye]: { color: hex("#d8b23a"), ramp: "o", emissive: true },
    [DE.Lid]: { color: hex("#252a20"), ramp: "-=" },
    [DE.Claw]: { color: hex("#9a9480"), ramp: ")" },
  },
  // Plein jour : olive vif sur le dos, ventre crème, crête plus sombre, gueule rose.
  cartoon: {
    [DE.Skin]: { color: hex("#6f8a3e"), ramp: ".:+oO0" },
    [DE.Far]: { color: hex("#4a5e28"), ramp: ":+o" },
    [DE.Belly]: { color: hex("#efe6b8"), ramp: ":=+=" },
    [DE.Scute]: { color: hex("#4c6026"), ramp: "nmA" },
    [DE.Band]: { color: hex("#3c4a20"), ramp: "=#" },
    [DE.Tooth]: { color: hex("#ffffff"), ramp: "vV" },
    [DE.Mouth]: { color: hex("#c8566a"), ramp: "::" },
    [DE.Eye]: { color: hex("#f0c020"), ramp: "@@" },
    [DE.Lid]: { color: hex("#2c3418"), ramp: "-=" },
    [DE.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
