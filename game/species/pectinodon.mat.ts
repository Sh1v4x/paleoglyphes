import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Pectinodon (plage 229-236, voir render/materials.ts).
 * Petit troodontidé nocturne : plumage fauve tacheté, et d'énormes yeux qui brillent dans la nuit
 * (matière lumineuse, comme le tapis réfléchissant des chouettes et des chats).
 */
export const PM = {
  /** Plumage du corps (côté proche). */
  Skin: 229,
  /** Côté lointain (pattes, aile), plus sombre. */
  Far: 230,
  /** Ventre et gorge pâles. */
  Belly: 231,
  /** Plumes (traits fins) : dos, queue, ailes. */
  Feather: 232,
  /** Rémiges et éventail de la queue, barrés. */
  Wing: 233,
  /** Grand œil nocturne, lumineux. */
  Eye: 234,
  /** Taches, masque et bandes sombres. */
  Mark: 235,
  /** Griffes (faucille, mains) et pattes écailleuses. */
  Claw: 236,
} as const;

export const PECTINODON_MATS: MaterialSet = {
  // Nuit : brun fauve terne, taches presque noires ; seuls les yeux s'allument, couleur d'ambre.
  dark: {
    [PM.Skin]: { color: hex("#5e5242"), ramp: ".:;=+xX%" },
    [PM.Far]: { color: hex("#332d26"), ramp: ".:;=+x" },
    [PM.Belly]: { color: hex("#7a6c58"), ramp: ".,:;=+" },
    [PM.Feather]: { color: hex("#6a5c4a"), ramp: "\"/" },
    [PM.Wing]: { color: hex("#4a3f36"), ramp: ".-~=" },
    [PM.Eye]: { color: hex("#f2c24a"), ramp: "O", emissive: true },
    [PM.Mark]: { color: hex("#221e1a"), ramp: ".:;" },
    [PM.Claw]: { color: hex("#a59c86"), ramp: ")" },
  },
  // Plein jour : fauve doré, taches chocolat, rémiges rousses, gros yeux jaune vif.
  cartoon: {
    [PM.Skin]: { color: hex("#d9a35a"), ramp: ".:+oO0" },
    [PM.Far]: { color: hex("#a4733a"), ramp: ":+o" },
    [PM.Belly]: { color: hex("#fff0d2"), ramp: ":=+=" },
    [PM.Feather]: { color: hex("#8c5a2a"), ramp: "\"/" },
    [PM.Wing]: { color: hex("#c8562e"), ramp: "-~=+" },
    [PM.Eye]: { color: hex("#ffd34a"), ramp: "O@" },
    [PM.Mark]: { color: hex("#5a3418"), ramp: "=#" },
    [PM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
