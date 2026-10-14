import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Xiphactinus (plage 208-213, voir render/materials.ts).
 * Contre-ombrage des poissons de pleine eau : dos sombre, flancs argentés, ventre blanc.
 */
export const XR = {
  /** Dos bleu sombre. */
  Back: 208,
  /** Flancs argentés, écailles. */
  Silver: 209,
  /** Ventre et gorge, presque blancs. */
  Belly: 210,
  /** Nageoires (rayons en traits fins). */
  Fin: 211,
  /** Crocs. */
  Fang: 212,
  /** Intérieur de la gueule, opercule, ligne latérale. */
  Mouth: 213,
} as const;

export const XIPHACTINUS_MATS: MaterialSet = {
  dark: {
    [XR.Back]: { color: hex("#25334a"), ramp: ".:;=+x#" },
    [XR.Silver]: { color: hex("#7d8a96"), ramp: ".:;=+xX%" },
    [XR.Belly]: { color: hex("#a9aca4"), ramp: ".,:;=+" },
    [XR.Fin]: { color: hex("#3c4a5c"), ramp: ".:;=+" },
    [XR.Fang]: { color: hex("#d6ccb0"), ramp: "vV" },
    [XR.Mouth]: { color: hex("#1a1418"), ramp: " .:" },
  },
  // Plein jour : dos bleu marine, flancs argent bleuté, ventre blanc, nageoires jaunes comme un tarpon.
  cartoon: {
    [XR.Back]: { color: hex("#2f5d96"), ramp: ":+o#" },
    [XR.Silver]: { color: hex("#b8cde0"), ramp: ".:+oO0" },
    [XR.Belly]: { color: hex("#f4f8fa"), ramp: ":=+=" },
    [XR.Fin]: { color: hex("#e8b23c"), ramp: ":+oO" },
    [XR.Fang]: { color: hex("#ffffff"), ramp: "vV" },
    [XR.Mouth]: { color: hex("#7a1e2e"), ramp: "::" },
  },
};
