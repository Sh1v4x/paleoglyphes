import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Therizinosaure (plage 410-419, voir render/materials.ts).
 * Grand théropode herbivore du Nemegt : plumage hirsute brun-gris, cou et face plus pâles,
 * petit bec corné, et surtout d'immenses griffes sombres gainées de kératine.
 */
export const THM = {
  /** Plumage du corps (côté proche). */
  Skin: 410,
  /** Côté lointain (patte, bras), plus sombre. */
  Far: 411,
  /** Cou, face et ventre pâles. */
  Pale: 412,
  /** Plumes (traits fins) : dos, ventre, nuque. */
  Feather: 413,
  /** Longues plumes hirsutes qui pendent des bras. */
  Shag: 414,
  /** Bec corné. */
  Beak: 415,
  /** Œil. */
  Eye: 416,
  /** Bouche, narine, liserés sombres. */
  Mark: 417,
  /** Griffes géantes (gaines de kératine). */
  Claw: 418,
  /** Pieds écailleux à quatre doigts. */
  Foot: 419,
} as const;

export const THERIZINO_MATS: MaterialSet = {
  // Nuit : brun-gris terne, cou à peine plus clair, griffes de corne sombre luisante.
  dark: {
    [THM.Skin]: { color: hex("#5b5248"), ramp: ".:;=+xX%" },
    [THM.Far]: { color: hex("#332d28"), ramp: ".:;=+x" },
    [THM.Pale]: { color: hex("#7a7062"), ramp: ".,:;=+" },
    [THM.Feather]: { color: hex("#6c6052"), ramp: "\"/" },
    [THM.Shag]: { color: hex("#4a4038"), ramp: "|" },
    [THM.Beak]: { color: hex("#9a907c"), ramp: ".:=#" },
    [THM.Eye]: { color: hex("#d8b45a"), ramp: "o" },
    [THM.Mark]: { color: hex("#221e1a"), ramp: ".:;" },
    [THM.Claw]: { color: hex("#b0a48a"), ramp: ")" },
    [THM.Foot]: { color: hex("#3e3832"), ramp: ".:=" },
  },
  // Plein jour : brun roux hirsute, cou crème, griffes presque noires, bec ivoire.
  cartoon: {
    [THM.Skin]: { color: hex("#8a6a4c"), ramp: ".:+oO0" },
    [THM.Far]: { color: hex("#5e4632"), ramp: ":+o" },
    [THM.Pale]: { color: hex("#e6d4b0"), ramp: ":=+=" },
    [THM.Feather]: { color: hex("#5a4028"), ramp: "\"/" },
    [THM.Shag]: { color: hex("#6e5238"), ramp: "|" },
    [THM.Beak]: { color: hex("#f4e6c0"), ramp: ":=#" },
    [THM.Eye]: { color: hex("#ffcf3a"), ramp: "O@" },
    [THM.Mark]: { color: hex("#3a2616"), ramp: "=#" },
    [THM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
    [THM.Foot]: { color: hex("#4a3a2e"), ramp: ":=#" },
  },
};
