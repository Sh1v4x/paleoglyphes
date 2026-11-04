import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières du Shuvuuia (plage 380-389, voir render/materials.ts).
 * Minuscule alvarezsaure nocturne du Gobi : plumage chamois pâle couleur de sable, à peine barré,
 * face et gorge blanches, grosse griffe du pouce sombre, et un grand œil qui brille dans la nuit.
 */
export const SM = {
  /** Plumage du corps (côté proche). */
  Skin: 380,
  /** Côté lointain (patte, bras), plus sombre. */
  Far: 381,
  /** Face, gorge et ventre blancs. */
  Belly: 382,
  /** Plumes (traits fins) : dos, nuque, queue. */
  Feather: 383,
  /** Barres pâles et discrètes du plumage. */
  Bar: 384,
  /** Grand œil nocturne, lumineux. */
  Eye: 385,
  /** Grosse griffe du pouce et petites griffes des pieds. */
  Claw: 386,
  /** Longues pattes fines et écailleuses (traits fins). */
  Leg: 387,
  /** Long museau fin. */
  Snout: 388,
} as const;

export const SHUVUUIA_MATS: MaterialSet = {
  // Nuit : sable gris-beige, barres à peine plus sombres ; l'œil s'allume, vert-jaune pâle.
  dark: {
    [SM.Skin]: { color: hex("#6e6656"), ramp: ".:;=+xX" },
    [SM.Far]: { color: hex("#3c3830"), ramp: ".:;=+" },
    [SM.Belly]: { color: hex("#8c877a"), ramp: ".,:;=+" },
    [SM.Feather]: { color: hex("#7a705e"), ramp: "\"'" },
    [SM.Bar]: { color: hex("#4e483d"), ramp: ".:;" },
    [SM.Eye]: { color: hex("#d8e86a"), ramp: "o", emissive: true },
    [SM.Claw]: { color: hex("#2a2622"), ramp: ")" },
    [SM.Leg]: { color: hex("#5a5246"), ramp: "|" },
    [SM.Snout]: { color: hex("#625a4c"), ramp: ".-=" },
  },
  // Plein jour : chamois clair, barres caramel, face blanche, griffe presque noire.
  cartoon: {
    [SM.Skin]: { color: hex("#e2c690"), ramp: ".:+oO0" },
    [SM.Far]: { color: hex("#b3965f"), ramp: ":+o" },
    [SM.Belly]: { color: hex("#fffaf0"), ramp: ":=+=" },
    [SM.Feather]: { color: hex("#c9a467"), ramp: "\"'" },
    [SM.Bar]: { color: hex("#a9814a"), ramp: "-=" },
    [SM.Eye]: { color: hex("#2a2214"), ramp: "o@" },
    [SM.Claw]: { color: hex("#1b1f2e"), ramp: ")" },
    [SM.Leg]: { color: hex("#9a7a5a"), ramp: "|" },
    [SM.Snout]: { color: hex("#cdb07c"), ramp: "-=" },
  },
};
