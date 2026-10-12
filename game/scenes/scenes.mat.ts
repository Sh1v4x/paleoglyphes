import type { MaterialSet } from "../species/types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières de la fouille et de l'atelier (plage 120-149, voir render/materials.ts). */
export const SM = {
  // Couches de sédiments (du haut vers le bas, en général).
  Topsoil: 120,
  Sand: 121,
  Silt: 122,
  Clay: 123,
  Sandstone: 124,
  Shale: 125,
  Lignite: 126,
  Conglo: 127,
  /** Gangue : roche tassée autour des fossiles, sous la couche de surface. */
  Matrix: 128,
  Pebble: 129,
  Root: 130,
  /** Creux déjà dégagé (ombre profonde). */
  Hollow: 131,
  /** Os fossile (brun, minéralisé) tel qu'il sort de la roche. */
  Fossil: 132,
  Ammonite: 133,
  Amber: 134,
  Insect: 135,
  LeafFossil: 136,
  SharkTooth: 137,
  Coprolite: 138,
  /** Plâtre de la coque de transport. */
  Plaster: 139,
  Grass: 140,
  /** Buttes des badlands à l'horizon. */
  Butte: 141,
  /** Piquets, planches et ficelle du quadrillage. */
  Stake: 142,
  // Atelier.
  Wall: 143,
  Grid: 144,
  Bench: 145,
  BenchEdge: 146,
  /** Ligne de balayage de la synthèse (lumineuse). */
  Scan: 147,
  Spark: 148,
  /** Silhouette humaine pour l'échelle. */
  Human: 149,
} as const;

/** Matières de ce module, déclinées par style. Identifiants : voir les plages dans render/materials.ts. */
export const SCENE_MATS: MaterialSet = {
  // Nuit : falaise sous la lune, teintes sourdes, textures denses.
  dark: {
    [SM.Topsoil]: { color: hex("#3c3428"), ramp: ".,:;%" },
    [SM.Sand]: { color: hex("#6e624a"), ramp: ".,:;'`" },
    [SM.Silt]: { color: hex("#5a5448"), ramp: "-~=:." },
    [SM.Clay]: { color: hex("#5e4a44"), ramp: "~=-:;" },
    [SM.Sandstone]: { color: hex("#6a5a46"), ramp: ":=x%#" },
    [SM.Shale]: { color: hex("#46464e"), ramp: "_-=_=" },
    [SM.Lignite]: { color: hex("#26232a"), ramp: ".:%#@" },
    [SM.Conglo]: { color: hex("#5c544a"), ramp: ".,:o.;" },
    [SM.Matrix]: { color: hex("#4a4038"), ramp: ".:;=+" },
    [SM.Pebble]: { color: hex("#7a7884"), ramp: "o0O@" },
    [SM.Root]: { color: hex("#5a4434"), ramp: "|/\\(" },
    [SM.Hollow]: { color: hex("#15121a"), ramp: " .`" },
    [SM.Fossil]: { color: hex("#b0a084"), ramp: ".:-=+oO@" },
    [SM.Ammonite]: { color: hex("#8a8aa0"), ramp: ".:oO@" },
    [SM.Amber]: { color: hex("#d08a2a"), ramp: ":oO0@" },
    [SM.Insect]: { color: hex("#2a1a10"), ramp: "%#" },
    [SM.LeafFossil]: { color: hex("#5a6a48"), ramp: ".:=+*" },
    [SM.SharkTooth]: { color: hex("#9a9aa8"), ramp: ":^AV" },
    [SM.Coprolite]: { color: hex("#6a5236"), ramp: ".:oO@" },
    [SM.Plaster]: { color: hex("#c8c4ba"), ramp: ":=+#" },
    [SM.Grass]: { color: hex("#3b4530"), ramp: ",;\"v" },
    [SM.Butte]: { color: hex("#2a2530"), ramp: "-=" },
    [SM.Stake]: { color: hex("#7a6a52"), ramp: "|=#" },
    [SM.Wall]: { color: hex("#1c1a24"), ramp: " .:" },
    [SM.Grid]: { color: hex("#2c3a34"), ramp: "+-|" },
    [SM.Bench]: { color: hex("#3e3028"), ramp: "-=_~" },
    [SM.BenchEdge]: { color: hex("#5a4636"), ramp: "=#" },
    [SM.Scan]: { color: hex("#9be88a"), ramp: "|", emissive: true },
    [SM.Spark]: { color: hex("#d8ffc8"), ramp: "*", emissive: true },
    [SM.Human]: { color: hex("#4a4458"), ramp: ".:=#" },
  },
  // Plein jour : falaise des badlands en bandes franches, aplats lumineux.
  cartoon: {
    [SM.Topsoil]: { color: hex("#8a5a34"), ramp: ".,:" },
    [SM.Sand]: { color: hex("#f2cf86"), ramp: ".,'`" },
    [SM.Silt]: { color: hex("#d9a873"), ramp: "-~=" },
    [SM.Clay]: { color: hex("#c97b5a"), ramp: "~=-" },
    [SM.Sandstone]: { color: hex("#e8b46a"), ramp: ":=x#" },
    [SM.Shale]: { color: hex("#8e8aa6"), ramp: "_-=" },
    [SM.Lignite]: { color: hex("#4a4050"), ramp: ".:%#" },
    [SM.Conglo]: { color: hex("#c4a07a"), ramp: ".,o.:" },
    [SM.Matrix]: { color: hex("#a8805e"), ramp: ".:;=" },
    [SM.Pebble]: { color: hex("#b8c0d0"), ramp: "oO0@" },
    [SM.Root]: { color: hex("#6e4428"), ramp: "|/\\(" },
    [SM.Hollow]: { color: hex("#4a3226"), ramp: " .`" },
    [SM.Fossil]: { color: hex("#fff1d0"), ramp: "-=oO" },
    [SM.Ammonite]: { color: hex("#8fc6e8"), ramp: ":oO@" },
    [SM.Amber]: { color: hex("#ffae2a"), ramp: "oO0@" },
    [SM.Insect]: { color: hex("#3a1e10"), ramp: "%#" },
    [SM.LeafFossil]: { color: hex("#5ab85a"), ramp: ":=+*" },
    [SM.SharkTooth]: { color: hex("#ffffff"), ramp: "^AV" },
    [SM.Coprolite]: { color: hex("#9a6a3a"), ramp: ":oO@" },
    [SM.Plaster]: { color: hex("#ffffff"), ramp: "=+#" },
    [SM.Grass]: { color: hex("#4aab45"), ramp: ",;\"v" },
    [SM.Butte]: { color: hex("#e09a6a"), ramp: "-=" },
    [SM.Stake]: { color: hex("#8a5a34"), ramp: "|=#" },
    [SM.Wall]: { color: hex("#fdf3dc"), ramp: " .:" },
    [SM.Grid]: { color: hex("#a8cde8"), ramp: "+-|" },
    [SM.Bench]: { color: hex("#c98a4e"), ramp: "-=_~" },
    [SM.BenchEdge]: { color: hex("#8a5a34"), ramp: "=#" },
    [SM.Scan]: { color: hex("#3fe0ff"), ramp: "|", emissive: true },
    [SM.Spark]: { color: hex("#ffe14d"), ramp: "*", emissive: true },
    [SM.Human]: { color: hex("#5b6fd8"), ramp: ":=#" },
  },
};
