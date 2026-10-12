import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Matières des herbivores (plage 30-59, voir render/materials.ts). */
export const H = {
  // Tricératops
  TSkin: 30,
  TFar: 31,
  TBelly: 32,
  TStripe: 33,
  TFrill: 34,
  TDisplay: 35,
  THorn: 36,
  TBeak: 37,
  TScale: 38,
  // Édmontosaure
  ESkin: 40,
  EFar: 41,
  EBelly: 42,
  EStripe: 43,
  EBill: 44,
  EComb: 45,
  EScale: 46,
  // Pachycéphalosaure
  PSkin: 50,
  PFar: 51,
  PBelly: 52,
  PDome: 53,
  PDomePat: 54,
  PKnob: 55,
  PStripe: 56,
} as const;

/** Matières de ce module, déclinées par style. Identifiants : voir les plages dans render/materials.ts. */
export const HERBIVORE_MATS: MaterialSet = {
  // Nuit : teintes éteintes, rampes du clairsemé au dense.
  dark: {
    [H.TSkin]: { color: hex("#6a5a48"), ramp: ".:;=+xX%#" },
    [H.TFar]: { color: hex("#3a332b"), ramp: ".:;=+x" },
    [H.TBelly]: { color: hex("#6e6250"), ramp: ".,:;=+" },
    [H.TStripe]: { color: hex("#2e2722"), ramp: ".:;" },
    [H.TFrill]: { color: hex("#7c705c"), ramp: ".:=+oO0" },
    [H.TDisplay]: { color: hex("#6e3a3a"), ramp: ":=oO@" },
    [H.THorn]: { color: hex("#b0a68e"), ramp: "'^AA" },
    [H.TBeak]: { color: hex("#8a8070"), ramp: ":=><" },
    [H.TScale]: { color: hex("#54483a"), ramp: ".oO" },
    [H.ESkin]: { color: hex("#4f5c58"), ramp: ".:;=+xX%#" },
    [H.EFar]: { color: hex("#2f3836"), ramp: ".:;=+x" },
    [H.EBelly]: { color: hex("#6a6a5c"), ramp: ".,:;=+" },
    [H.EStripe]: { color: hex("#252c2b"), ramp: ".:;" },
    [H.EBill]: { color: hex("#8c8470"), ramp: ":=+=" },
    [H.EComb]: { color: hex("#6a3c40"), ramp: ":nmM" },
    [H.EScale]: { color: hex("#3c4644"), ramp: ".:o" },
    [H.PSkin]: { color: hex("#6e6450"), ramp: ".:;=+xX%#" },
    [H.PFar]: { color: hex("#3c372e"), ramp: ".:;=+x" },
    [H.PBelly]: { color: hex("#77705c"), ramp: ".,:;=+" },
    [H.PDome]: { color: hex("#8e8676"), ramp: ":=oO0@" },
    [H.PDomePat]: { color: hex("#4c4660"), ramp: ":=#" },
    [H.PKnob]: { color: hex("#a89e88"), ramp: "'^AA" },
    [H.PStripe]: { color: hex("#332e28"), ramp: ".:;" },
  },
  // Plein jour : couleurs franches et gaies, une identité par espèce.
  cartoon: {
    [H.TSkin]: { color: hex("#d9823e"), ramp: ".:+oO0" },
    [H.TFar]: { color: hex("#a85e28"), ramp: ":+o" },
    [H.TBelly]: { color: hex("#f7d6a0"), ramp: ":=+=" },
    [H.TStripe]: { color: hex("#7a3b1c"), ramp: "=#" },
    [H.TFrill]: { color: hex("#fbe7bf"), ramp: ":oO0" },
    [H.TDisplay]: { color: hex("#e0453a"), ramp: "oO@" },
    [H.THorn]: { color: hex("#fff6e2"), ramp: "^^AA" },
    [H.TBeak]: { color: hex("#4a4a5a"), ramp: "><" },
    [H.TScale]: { color: hex("#b8652c"), ramp: "oO" },
    [H.ESkin]: { color: hex("#4aa3a8"), ramp: ".:+oO0" },
    [H.EFar]: { color: hex("#2f7a80"), ramp: ":+o" },
    [H.EBelly]: { color: hex("#e9f2d0"), ramp: ":=+=" },
    [H.EStripe]: { color: hex("#2a5a8a"), ramp: "=#" },
    [H.EBill]: { color: hex("#f2b94a"), ramp: "=+=" },
    [H.EComb]: { color: hex("#e8463c"), ramp: "nmM" },
    [H.EScale]: { color: hex("#3a8c92"), ramp: "oO" },
    [H.PSkin]: { color: hex("#e2bf7a"), ramp: ".:+oO0" },
    [H.PFar]: { color: hex("#b8924e"), ramp: ":+o" },
    [H.PBelly]: { color: hex("#fff0c8"), ramp: ":=+=" },
    [H.PDome]: { color: hex("#8a6ad8"), ramp: "oO0@" },
    [H.PDomePat]: { color: hex("#3c6ee0"), ramp: "=#" },
    [H.PKnob]: { color: hex("#fff6e2"), ramp: "^^AA" },
    [H.PStripe]: { color: hex("#9a6a3a"), ramp: "=#" },
  },
};
