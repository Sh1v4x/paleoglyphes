import { M, type Material } from "./render/materials";
import { HERBIVORE_MATS } from "./species/herbivores.mat";
import { CARNIVORE_MATS } from "./species/carnivores.mat";
import { FLORA_MATS } from "./world/flora.mat";
import { SCENE_MATS } from "./scenes/scenes.mat";
import { MARINE_MATS } from "./species/marine.mat";

export type { Material };

export type RGB = readonly [number, number, number];
export type Style = "dark" | "cartoon";

export function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface Palette {
  /** Fond hors du monde et base de tous les fonds de cellule. */
  void: RGB;
  /** Encre des contours (cartoon). */
  ink: RGB;
  dirt: RGB[];
  grass: RGB[];
  /** Teinte des brins au passage d'une rafale. */
  grassGust: RGB;
  waterDeep: RGB;
  waterMid: RGB;
  waterShore: RGB;
  /** Reflet de lune (dark) ou éclats de soleil (cartoon). */
  specular: RGB;
  mistFg: RGB;
  mistBg: RGB;
  /** Couleur lumineuse rare : yeux, runes, feux follets. */
  accent: RGB;
  runeOff: RGB;
  text: RGB;
  /** Couleurs des petites bêtes (papillons en cartoon). */
  critters: RGB[];
}

/** Couleurs de l'interface (calque lisible par-dessus le monde). */
export interface UiSkin {
  panel: RGB;
  panelAlt: RGB;
  border: RGB;
  text: RGB;
  dim: RGB;
  hi: RGB;
  ok: RGB;
  bad: RGB;
  /** Opacité des panneaux (0..1). */
  alpha: number;
}

export interface Theme {
  style: Style;
  ui: UiSkin;
  pal: Palette;
  mats: Material[];
  /** Lumière ambiante (lune ou soleil) et sa teinte. */
  ambient: number;
  lightTint: RGB;
  /** Lueur autour du personnage. */
  glow: number;
  glowRadius: number;
  glowTint: RGB;
  /** Vignettage : début et fin du fondu (rayon normalisé). */
  vignette: readonly [number, number];
  /** Brume pâle (dark) ou ombres de nuages (cartoon). */
  fog: "mist" | "clouds";
  water: "moon" | "glints";
  critters: "fireflies" | "butterflies";
  /** Ombrage en aplats (3 paliers) et contours à l'encre. */
  cel: boolean;
  outline: boolean;
  /** Tramage aléatoire des glyphes de sprite. */
  dither: number;
  /** Remplissage du fond des cellules : terrain, sprites. */
  groundFill: number;
  spriteFill: number;
  grassGain: number;
  dirtGain: number;
  /** Glyphes du sol nu, du plus vide au plus dense. */
  dirtRamp: string;
}

const EXTRA = [HERBIVORE_MATS, CARNIVORE_MATS, FLORA_MATS, SCENE_MATS, MARINE_MATS];

/** Table des matières d'un style : cœur + matières déclarées par les espèces, la flore et les scènes. */
function materials(def: Record<number, Material>, style: Style): Material[] {
  const out: Material[] = [];
  for (const [k, v] of Object.entries(def)) out[Number(k)] = v;
  for (const set of EXTRA) for (const [k, v] of Object.entries(set[style])) out[Number(k)] = v;
  // Toute matière manquante retombe sur une pierre neutre plutôt que de planter le rendu.
  for (let i = 0; i < 256; i++) out[i] ??= def[M.Stone];
  return out;
}

// ---------------------------------------------------------------------------
// Dark fantasy : nuit, lune froide, brume, végétation malade.
// ---------------------------------------------------------------------------
const DARK_PAL: Palette = {
  void: hex("#0b0a0f"),
  ink: hex("#0b0a0f"),
  dirt: [hex("#2c2620"), hex("#3a3129"), hex("#4a4036"), hex("#45423c")],
  grass: [hex("#2f3828"), hex("#3b4530"), hex("#4a5236"), hex("#5c6142")],
  grassGust: hex("#7a7840"),
  waterDeep: hex("#070b14"),
  waterMid: hex("#0f1a2a"),
  waterShore: hex("#1b2b3d"),
  specular: hex("#9fb2c6"),
  mistFg: hex("#6c6f7a"),
  mistBg: hex("#2a2a33"),
  accent: hex("#9be88a"),
  runeOff: hex("#2e2236"),
  text: hex("#6c6f7a"),
  critters: [hex("#9be88a")],
};

const bone = hex("#a59c86");
export const DARK: Theme = {
  style: "dark",
  ui: {
    panel: hex("#100e15"), panelAlt: hex("#1a1722"), border: hex("#4a4458"), text: hex("#c4bed2"),
    dim: hex("#6d6880"), hi: hex("#9be88a"), ok: hex("#9be88a"), bad: hex("#d0625a"), alpha: 0.92,
  },
  pal: DARK_PAL,
  mats: materials({
    [M.None]: { color: DARK_PAL.void, ramp: " " },
    [M.Armor]: { color: hex("#4c5446"), ramp: ".:;=+xX%#@" },
    [M.Plate]: { color: hex("#7a8070"), ramp: ":=+oO0Q@" },
    [M.Spike]: { color: hex("#8a8270"), ramp: "'^^AA" },
    [M.Belly]: { color: hex("#5a4a3a"), ramp: ".,:;=+" },
    [M.Skin]: { color: hex("#646a58"), ramp: ".:;=+xX#" },
    [M.SkinFar]: { color: hex("#343a31"), ramp: ".:;=+x" },
    [M.Club]: { color: bone, ramp: ":=oO0@#B" },
    [M.Eye]: { color: DARK_PAL.accent, ramp: "o", emissive: true },
    [M.Wood]: { color: hex("#4b3f3a"), ramp: "':!|lI1H" },
    [M.Moss]: { color: hex("#56603a"), ramp: ".:o0O8&@" },
    [M.Leaf]: { color: hex("#4a5532"), ramp: ".:o0O8&@" },
    [M.Stone]: { color: hex("#5a5862"), ramp: ".:;=xX$&#@" },
    [M.Rune]: { color: DARK_PAL.accent, ramp: "|", emissive: true },
    [M.Bone]: { color: bone, ramp: ".:-=+oO@" },
    [M.Socket]: { color: hex("#2e2236"), ramp: " ." },
    [M.Fern]: { color: hex("#3a2b44"), ramp: ",;\"v" },
    [M.Petal]: { color: hex("#4a3550"), ramp: ".:o*" },
    [M.PetalAlt]: { color: hex("#3e3a52"), ramp: ".:o*" },
    [M.RSkin]: { color: hex("#5b5c4c"), ramp: ".:;=+xX%#" },
    [M.RFar]: { color: hex("#383a31"), ramp: ".:;=+x" },
    [M.Stripe]: { color: hex("#24221f"), ramp: ":=#" },
    [M.Feather]: { color: hex("#4a4258"), ramp: "\"/" },
    [M.Claw]: { color: bone, ramp: ")" },
    [M.Tooth]: { color: hex("#b9b09a"), ramp: "v" },
    [M.Mouth]: { color: hex("#1a1418"), ramp: "_" },
    [M.RBelly]: { color: hex("#6e624f"), ramp: ".,:;=+" },
  }, "dark"),
  ambient: 0.8,
  lightTint: [0.78, 0.84, 1.0],
  glow: 1.05,
  glowRadius: 300,
  glowTint: [1.0, 0.94, 0.84],
  vignette: [0.55, 1.45],
  fog: "mist",
  water: "moon",
  critters: "fireflies",
  cel: false,
  outline: false,
  dither: 0.1,
  groundFill: 0.07,
  spriteFill: 0.3,
  grassGain: 1.75,
  dirtGain: 1.5,
  dirtRamp: "  ..,,`':;",
};

// ---------------------------------------------------------------------------
// Cartoon : plein jour, couleurs franches, aplats et contours à l'encre.
// ---------------------------------------------------------------------------
const CARTOON_PAL: Palette = {
  void: hex("#1e2b33"),
  ink: hex("#1b1f2e"),
  dirt: [hex("#9c7a58"), hex("#a8784c"), hex("#b8875a"), hex("#c79a68")],
  grass: [hex("#3c9638"), hex("#4aab45"), hex("#5ac052"), hex("#6fd266")],
  grassGust: hex("#c4f27a"),
  waterDeep: hex("#1c5aa6"),
  waterMid: hex("#2d82cf"),
  waterShore: hex("#6cc6ef"),
  specular: hex("#ffffff"),
  mistFg: hex("#ffffff"),
  mistBg: hex("#ffffff"),
  accent: hex("#ffd34a"),
  runeOff: hex("#6a7a99"),
  text: hex("#ffffff"),
  critters: [hex("#ff7eb6"), hex("#ffd34a"), hex("#8fd3ff"), hex("#c59bff"), hex("#ffffff")],
};

const cream = hex("#fff1d0");
export const CARTOON: Theme = {
  style: "cartoon",
  ui: {
    panel: hex("#fff6e0"), panelAlt: hex("#f3e4c2"), border: hex("#1b1f2e"), text: hex("#1b1f2e"),
    dim: hex("#8a7f6a"), hi: hex("#e8553a"), ok: hex("#3c9a3a"), bad: hex("#d03a3a"), alpha: 0.96,
  },
  pal: CARTOON_PAL,
  mats: materials({
    [M.None]: { color: CARTOON_PAL.void, ramp: " " },
    [M.Armor]: { color: hex("#3fa38a"), ramp: ".:+oO0" },
    [M.Plate]: { color: hex("#f2c14e"), ramp: "oO0@" },
    [M.Spike]: { color: cream, ramp: "^^AA" },
    [M.Belly]: { color: hex("#f6c89a"), ramp: ":=+=" },
    [M.Skin]: { color: hex("#56b89c"), ramp: ":+oO" },
    [M.SkinFar]: { color: hex("#2c7a66"), ramp: ":+o" },
    [M.Club]: { color: cream, ramp: "oO0@" },
    [M.Eye]: { color: CARTOON_PAL.ink, ramp: "@@" },
    [M.Wood]: { color: hex("#8a5a34"), ramp: "|lI#" },
    [M.Moss]: { color: hex("#46b44c"), ramp: "oO0@&" },
    [M.Leaf]: { color: hex("#4cc152"), ramp: ".oO0@&" },
    [M.Stone]: { color: hex("#9aa3b5"), ramp: ".:o0O" },
    [M.Rune]: { color: CARTOON_PAL.accent, ramp: "|", emissive: true },
    [M.Bone]: { color: hex("#f4ecd8"), ramp: "-=oO" },
    [M.Socket]: { color: CARTOON_PAL.ink, ramp: "@" },
    [M.Fern]: { color: hex("#2f8a35"), ramp: "|" },
    [M.Petal]: { color: hex("#ff7eb6"), ramp: "o*@" },
    [M.PetalAlt]: { color: hex("#ffe14d"), ramp: "o*@" },
    [M.RSkin]: { color: hex("#f08a3c"), ramp: ".:+oO0" },
    [M.RFar]: { color: hex("#c4692a"), ramp: ":+o" },
    [M.Stripe]: { color: hex("#5b3fa0"), ramp: "=#" },
    [M.Feather]: { color: hex("#3fc0b5"), ramp: "\"/" },
    [M.Claw]: { color: hex("#ffffff"), ramp: ")" },
    [M.Tooth]: { color: hex("#ffffff"), ramp: "v" },
    [M.Mouth]: { color: hex("#7a1e2e"), ramp: "_" },
    [M.RBelly]: { color: hex("#ffe0b0"), ramp: ":=+=" },
  }, "cartoon"),
  ambient: 1.02,
  lightTint: [1.0, 0.98, 0.92],
  glow: 0.22,
  glowRadius: 320,
  glowTint: [1.0, 1.0, 1.0],
  vignette: [0.95, 2.1],
  fog: "clouds",
  water: "glints",
  critters: "butterflies",
  cel: true,
  outline: true,
  dither: 0,
  groundFill: 0.5,
  spriteFill: 0.72,
  grassGain: 1.25,
  dirtGain: 1.1,
  dirtRamp: "   ..,`'",
};

export const THEMES: Record<Style, Theme> = { dark: DARK, cartoon: CARTOON };
