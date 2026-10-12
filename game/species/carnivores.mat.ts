import type { MaterialSet } from "./types";

/** Copie locale de `hex` (palette.ts importe ce module : pas d'import circulaire). */
function hex(h: string): readonly [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Matières des carnivores et de la petite faune (plage 60-89, voir render/materials.ts).
 * Rampes : du plus sombre (peu dense) au plus éclairé (dense), comme dans palette.ts.
 */
export const CM = {
  // Tyrannosaure
  RexSkin: 60,
  RexFar: 61,
  RexBack: 62,
  RexBelly: 63,
  RexScale: 64,
  RexTooth: 65,
  RexMouth: 66,
  RexTongue: 67,
  RexClaw: 68,
  RexBrow: 69,
  // Dakotaraptor (en plus des matières du cœur RSkin, Feather…)
  RWing: 70,
  RCrest: 71,
  /** Dents de la mâchoire inférieure (pointe vers le haut), partagées. */
  ToothUp: 72,
  /** Œil fermé (repos, mort), partagé. */
  Lid: 73,
  // Didelphodon
  DidFur: 74,
  DidFar: 75,
  DidBelly: 76,
  DidNose: 77,
  // Ptérosaure (azhdarchidé)
  PteroWing: 78,
  PteroFar: 79,
  PteroBody: 80,
  PteroCrest: 81,
  PteroBeak: 82,
  // Insectes
  FlyWing: 84,
  FlyBody: 85,
  Beetle: 86,
  BeetleLeg: 87,
} as const;

export const CARNIVORE_MATS: MaterialSet = {
  // Nuit : teintes sourdes, dos sombre, ventre pâle.
  dark: {
    [CM.RexSkin]: { color: hex("#5f5b45"), ramp: ".:;=+xX%#" },
    [CM.RexFar]: { color: hex("#34332a"), ramp: ".:;=+x" },
    [CM.RexBack]: { color: hex("#2b2820"), ramp: ":;=x#" },
    [CM.RexBelly]: { color: hex("#7c715b"), ramp: ".,:;=+" },
    [CM.RexScale]: { color: hex("#4c4838"), ramp: ".,:o" },
    [CM.RexTooth]: { color: hex("#c9bfa6"), ramp: "vV" },
    [CM.RexMouth]: { color: hex("#1c1214"), ramp: " .:" },
    [CM.RexTongue]: { color: hex("#6e3c3c"), ramp: "~=" },
    [CM.RexClaw]: { color: hex("#a59c86"), ramp: ")" },
    [CM.RexBrow]: { color: hex("#6f6852"), ramp: ":=+o" },
    [CM.RWing]: { color: hex("#3f384c"), ramp: ".,;/|" },
    [CM.RCrest]: { color: hex("#7c5260"), ramp: "\"/" },
    [CM.ToothUp]: { color: hex("#c9bfa6"), ramp: "^" },
    [CM.Lid]: { color: hex("#24221f"), ramp: "-" },
    [CM.DidFur]: { color: hex("#4d4339"), ramp: ".:;=+x%#" },
    [CM.DidFar]: { color: hex("#2c2622"), ramp: ".:;=+" },
    [CM.DidBelly]: { color: hex("#6c5f4f"), ramp: ".,:;=" },
    [CM.DidNose]: { color: hex("#16121a"), ramp: "o" },
    [CM.PteroWing]: { color: hex("#4b3c44"), ramp: ".-~=+" },
    [CM.PteroFar]: { color: hex("#2a2329"), ramp: ".-~=" },
    [CM.PteroBody]: { color: hex("#5c544b"), ramp: ".:;+x%" },
    [CM.PteroCrest]: { color: hex("#7e4c44"), ramp: ":=A" },
    [CM.PteroBeak]: { color: hex("#8c8472"), ramp: ":=+#" },
    [CM.FlyWing]: { color: hex("#8ea7ba"), ramp: "-~=" },
    [CM.FlyBody]: { color: hex("#3c7c88"), ramp: ":=|" },
    [CM.Beetle]: { color: hex("#3c5444"), ramp: ".:o0" },
    [CM.BeetleLeg]: { color: hex("#1d1c1a"), ramp: "," },
  },
  // Plein jour : couleurs franches et sympathiques.
  cartoon: {
    [CM.RexSkin]: { color: hex("#e2a243"), ramp: ".:+oO0" },
    [CM.RexFar]: { color: hex("#a8702c"), ramp: ":+o" },
    [CM.RexBack]: { color: hex("#9c3a26"), ramp: "=#" },
    [CM.RexBelly]: { color: hex("#ffe2a6"), ramp: ":=+=" },
    [CM.RexScale]: { color: hex("#c8862f"), ramp: "oO" },
    [CM.RexTooth]: { color: hex("#ffffff"), ramp: "vV" },
    [CM.RexMouth]: { color: hex("#7a1e2e"), ramp: "::" },
    [CM.RexTongue]: { color: hex("#f0647e"), ramp: "~=" },
    [CM.RexClaw]: { color: hex("#ffffff"), ramp: ")" },
    [CM.RexBrow]: { color: hex("#bf5a2a"), ramp: "=oO" },
    [CM.RWing]: { color: hex("#2fa79d"), ramp: ";/|" },
    [CM.RCrest]: { color: hex("#ee4a6c"), ramp: "\"/" },
    [CM.ToothUp]: { color: hex("#ffffff"), ramp: "^" },
    [CM.Lid]: { color: hex("#1b1f2e"), ramp: "-" },
    [CM.DidFur]: { color: hex("#8c5c3a"), ramp: ":+oO" },
    [CM.DidFar]: { color: hex("#5e3b24"), ramp: ":+o" },
    [CM.DidBelly]: { color: hex("#f0caa0"), ramp: ":=+" },
    [CM.DidNose]: { color: hex("#1b1f2e"), ramp: "@" },
    [CM.PteroWing]: { color: hex("#b48ae0"), ramp: "-~=+" },
    [CM.PteroFar]: { color: hex("#7a5aa8"), ramp: "-~=" },
    [CM.PteroBody]: { color: hex("#f2ead8"), ramp: ":+oO" },
    [CM.PteroCrest]: { color: hex("#ff8a3a"), ramp: "=A" },
    [CM.PteroBeak]: { color: hex("#ffd34a"), ramp: "=+#" },
    [CM.FlyWing]: { color: hex("#d8f4ff"), ramp: "-~=" },
    [CM.FlyBody]: { color: hex("#25b0e2"), ramp: "=#" },
    [CM.Beetle]: { color: hex("#2aa86a"), ramp: "oO0@" },
    [CM.BeetleLeg]: { color: hex("#1b1f2e"), ramp: "," },
  },
};
