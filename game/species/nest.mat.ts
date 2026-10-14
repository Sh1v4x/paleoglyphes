import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières des nids et des œufs (plage 180-199, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const NM = {
  /** Terre du nid (butte ou bourrelet). */
  Earth: 180,
  /** Creux du nid, à l'ombre. */
  Hollow: 181,
  /** Plantes en décomposition qui couvrent et chauffent les œufs. */
  Veg: 182,
  /** Brindilles (traits fins). */
  Twig: 183,
  /** Sable (ptérosaure). */
  Sand: 184,
  /** Petit creux de sable autour d'un œuf enterré. */
  SandDim: 185,
  /** Coquilles : cératopsiens, ankylosaures, pachycéphalosaures (crème pâle). */
  ShellCream: 186,
  /** Hadrosaures (brun clair). */
  ShellTan: 187,
  /** Raptor (bleu-vert, comme certains œufs de théropodes). */
  ShellBlue: 188,
  /** T. rex (brun-gris). */
  ShellBrown: 189,
  /** Ptérosaure : coquille souple, parcheminée. */
  ShellLeather: 190,
  Speck: 191,
  /** Fissures (traits fins). */
  Crack: 192,
  /** Intérieur d'une coquille ouverte. */
  Inside: 193,
  /** Peau du nouveau-né qui sort de l'œuf. */
  Baby: 194,
  /** Cailloux au bord d'un nid creusé. */
  Pebble: 195,
} as const;

export const NEST_MATS: MaterialSet = {
  // Nuit : terres et coquilles sourdes, le bleu-vert du raptor reste discret.
  dark: {
    [NM.Earth]: { color: hex("#4d3f31"), ramp: ".,:;=+x%#" },
    [NM.Hollow]: { color: hex("#2a221b"), ramp: " .,:;" },
    [NM.Veg]: { color: hex("#4f5634"), ramp: ".,;\"v%&" },
    [NM.Twig]: { color: hex("#5d4a38"), ramp: "-" },
    [NM.Sand]: { color: hex("#6a604e"), ramp: ".,:;~=+" },
    [NM.SandDim]: { color: hex("#3e372c"), ramp: ".,:" },
    [NM.ShellCream]: { color: hex("#b3aa92"), ramp: ".:=+oO0@" },
    [NM.ShellTan]: { color: hex("#957f63"), ramp: ".:=+oO0@" },
    [NM.ShellBlue]: { color: hex("#6f8f8a"), ramp: ".:=+oO0@" },
    [NM.ShellBrown]: { color: hex("#7c6c5c"), ramp: ".:=+oO0@" },
    [NM.ShellLeather]: { color: hex("#a39a88"), ramp: ".,:~=+o" },
    [NM.Speck]: { color: hex("#5e4c3c"), ramp: ".:=+oO0@" },
    [NM.Crack]: { color: hex("#3d332a"), ramp: "-" },
    [NM.Inside]: { color: hex("#1a1612"), ramp: " .:" },
    [NM.Baby]: { color: hex("#7a7a60"), ramp: ".:;=+xX" },
    [NM.Pebble]: { color: hex("#5a5862"), ramp: ".:oO" },
  },
  // Plein jour : nid brun chaud, coquilles claires et franches, bébé vert tendre.
  cartoon: {
    [NM.Earth]: { color: hex("#8a5a36"), ramp: ".:+oO" },
    [NM.Hollow]: { color: hex("#5e3b22"), ramp: ".:;" },
    [NM.Veg]: { color: hex("#6f8a3a"), ramp: ",;vw&" },
    [NM.Twig]: { color: hex("#6e4526"), ramp: "-" },
    [NM.Sand]: { color: hex("#e8cf94"), ramp: ".:~=" },
    [NM.SandDim]: { color: hex("#b89a62"), ramp: ".:" },
    [NM.ShellCream]: { color: hex("#f6ead2"), ramp: ":+oO0" },
    [NM.ShellTan]: { color: hex("#d9b48a"), ramp: ":+oO0" },
    [NM.ShellBlue]: { color: hex("#8fd0c4"), ramp: ":+oO0" },
    [NM.ShellBrown]: { color: hex("#c79a76"), ramp: ":+oO0" },
    [NM.ShellLeather]: { color: hex("#f2e6d0"), ramp: ":~=o" },
    [NM.Speck]: { color: hex("#8a6040"), ramp: ":+oO0" },
    [NM.Crack]: { color: hex("#1b1f2e"), ramp: "-" },
    [NM.Inside]: { color: hex("#7a5236"), ramp: ".:" },
    [NM.Baby]: { color: hex("#9ed36a"), ramp: ":+oO" },
    [NM.Pebble]: { color: hex("#a39e94"), ramp: "oO" },
  },
};
