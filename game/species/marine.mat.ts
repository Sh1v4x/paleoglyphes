import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières des reptiles volants et marins (plage 150-179, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const MR = {
  // Quetzalcoatlus
  QSkin: 150,
  QFar: 151,
  QBelly: 152,
  /** Pycnofibres : duvet filamenteux du corps et du cou. */
  QFuzz: 153,
  QWing: 154,
  QWingFar: 155,
  /** Actinofibrilles : fibres raidissant la membrane (traits fins). */
  QVein: 156,
  QBeak: 157,
  QCrest: 158,
  QClaw: 159,
  // Mosasaure
  MSkin: 160,
  MFar: 161,
  MBack: 162,
  MBelly: 163,
  MStripe: 164,
  MScale: 165,
  MFin: 166,
  MFinFar: 167,
  MFluke: 168,
  MTooth: 169,
  MToothUp: 170,
  MMouth: 171,
  MTongue: 172,
  MLip: 173,
  /** Œil fermé (repos, mort), partagé. */
  Lid: 179,
} as const;

export const MARINE_MATS: MaterialSet = {
  // Nuit : teintes sourdes ; dos sombre et ventre pâle (contre-ombrage) pour le mosasaure.
  dark: {
    [MR.QSkin]: { color: hex("#5e5349"), ramp: ".:;=+xX%#" },
    [MR.QFar]: { color: hex("#312b27"), ramp: ".:;=+x" },
    [MR.QBelly]: { color: hex("#7a6d5e"), ramp: ".,:;=+" },
    [MR.QFuzz]: { color: hex("#74685a"), ramp: ".'\"" },
    [MR.QWing]: { color: hex("#4e3c42"), ramp: ".-~=+" },
    [MR.QWingFar]: { color: hex("#2a2226"), ramp: ".-~=" },
    [MR.QVein]: { color: hex("#6c525a"), ramp: "-" },
    [MR.QBeak]: { color: hex("#8e8670"), ramp: ":=+#" },
    [MR.QCrest]: { color: hex("#7e4a40"), ramp: ":=A" },
    [MR.QClaw]: { color: hex("#a59c86"), ramp: ")" },
    [MR.MSkin]: { color: hex("#3f4b59"), ramp: ".:;=+xX%#" },
    [MR.MFar]: { color: hex("#232a33"), ramp: ".:;=+x" },
    [MR.MBack]: { color: hex("#1f2630"), ramp: ":;=x#" },
    [MR.MBelly]: { color: hex("#878a82"), ramp: ".,:;=+" },
    [MR.MStripe]: { color: hex("#2a323d"), ramp: ".:;" },
    [MR.MScale]: { color: hex("#56636f"), ramp: ".,:o" },
    [MR.MFin]: { color: hex("#37424e"), ramp: ".:;=+x" },
    [MR.MFinFar]: { color: hex("#1e242c"), ramp: ".:;=" },
    [MR.MFluke]: { color: hex("#303a46"), ramp: ".:;=+x%" },
    [MR.MTooth]: { color: hex("#d6ccb0"), ramp: "vV" },
    [MR.MToothUp]: { color: hex("#d6ccb0"), ramp: "^" },
    [MR.MMouth]: { color: hex("#1a1216"), ramp: " .:" },
    [MR.MTongue]: { color: hex("#6e3c44"), ramp: "~=" },
    [MR.MLip]: { color: hex("#15191f"), ramp: "_" },
    [MR.Lid]: { color: hex("#24221f"), ramp: "-" },
  },
  // Plein jour : ptérosaure crème aux ailes rouille, mosasaure bleu océan au ventre blanc.
  cartoon: {
    [MR.QSkin]: { color: hex("#efe2c4"), ramp: ".:+oO0" },
    [MR.QFar]: { color: hex("#b9a684"), ramp: ":+o" },
    [MR.QBelly]: { color: hex("#fffaf0"), ramp: ":=+=" },
    [MR.QFuzz]: { color: hex("#d6c4a0"), ramp: "'\"" },
    [MR.QWing]: { color: hex("#de7a4c"), ramp: "-~=+" },
    [MR.QWingFar]: { color: hex("#a8522c"), ramp: "-~=" },
    [MR.QVein]: { color: hex("#8c3a1e"), ramp: "-" },
    [MR.QBeak]: { color: hex("#ffcf4a"), ramp: "=+#" },
    [MR.QCrest]: { color: hex("#e8363c"), ramp: "=A" },
    [MR.QClaw]: { color: hex("#1b1f2e"), ramp: ")" },
    [MR.MSkin]: { color: hex("#3f80b8"), ramp: ".:+oO0" },
    [MR.MFar]: { color: hex("#285a8a"), ramp: ":+o" },
    [MR.MBack]: { color: hex("#234a78"), ramp: "=#" },
    [MR.MBelly]: { color: hex("#e9f2f0"), ramp: ":=+=" },
    [MR.MStripe]: { color: hex("#2c5f92"), ramp: "=#" },
    [MR.MScale]: { color: hex("#62a2d6"), ramp: "oO" },
    [MR.MFin]: { color: hex("#3473a8"), ramp: ":+oO" },
    [MR.MFinFar]: { color: hex("#22507a"), ramp: ":+o" },
    [MR.MFluke]: { color: hex("#2c6aa0"), ramp: ":+oO" },
    [MR.MTooth]: { color: hex("#ffffff"), ramp: "vV" },
    [MR.MToothUp]: { color: hex("#ffffff"), ramp: "^" },
    [MR.MMouth]: { color: hex("#7a1e2e"), ramp: "::" },
    [MR.MTongue]: { color: hex("#f0647e"), ramp: "~=" },
    [MR.MLip]: { color: hex("#1b1f2e"), ramp: "_" },
    [MR.Lid]: { color: hex("#1b1f2e"), ramp: "-" },
  },
};
