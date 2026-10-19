import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Velociraptor (plage 320-329, voir render/materials.ts).
 * Petit dromaeosaure du désert de Gobi : camouflage de sable (plumage fauve), barres sombres
 * sur les ailes et la queue, ventre pâle, griffes sombres.
 */
export const VM = {
  /** Plumage du corps (côté proche). */
  Skin: 320,
  /** Côté lointain (pattes, aile), plus sombre. */
  Far: 321,
  /** Ventre et gorge pâles. */
  Belly: 322,
  /** Plumes (traits fins) : dos, nuque, éventail de la queue. */
  Feather: 323,
  /** Rémiges et franges de la queue. */
  Wing: 324,
  /** Œil. */
  Eye: 325,
  /** Barres et masque sombres. */
  Mark: 326,
  /** Griffes (faucille, mains) et pattes écailleuses. */
  Claw: 327,
} as const;

export const VELOCIRAPTOR_MATS: MaterialSet = {
  // Nuit : sable terne, barres presque noires, œil ambré sans éclat.
  dark: {
    [VM.Skin]: { color: hex("#6b5a40"), ramp: ".:;=+xX%" },
    [VM.Far]: { color: hex("#3a3126"), ramp: ".:;=+x" },
    [VM.Belly]: { color: hex("#86775c"), ramp: ".,:;=+" },
    [VM.Feather]: { color: hex("#7a6648"), ramp: "\"/" },
    [VM.Wing]: { color: hex("#4d3f2e"), ramp: ".-~=" },
    [VM.Eye]: { color: hex("#c9923a"), ramp: "o" },
    [VM.Mark]: { color: hex("#2a231b"), ramp: ".:;" },
    [VM.Claw]: { color: hex("#a8a090"), ramp: ")" },
  },
  // Plein jour : sable doré, rémiges rousses barrées de brun, ventre crème, œil jaune vif.
  cartoon: {
    [VM.Skin]: { color: hex("#e2b56a"), ramp: ".:+oO0" },
    [VM.Far]: { color: hex("#b0844a"), ramp: ":+o" },
    [VM.Belly]: { color: hex("#fff3d6"), ramp: ":=+=" },
    [VM.Feather]: { color: hex("#9a6a34"), ramp: "\"/" },
    [VM.Wing]: { color: hex("#cf7a36"), ramp: "-~=+" },
    [VM.Eye]: { color: hex("#ffd23a"), ramp: "o@" },
    [VM.Mark]: { color: hex("#5e3a1c"), ramp: "=#" },
    [VM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
  },
};
