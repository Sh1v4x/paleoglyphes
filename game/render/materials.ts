/** Identifiants de matière des sprites (0 = vide). */
export const M = {
  None: 0,
  Armor: 1,
  Plate: 2,
  Spike: 3,
  Belly: 4,
  Skin: 5,
  SkinFar: 6,
  Club: 7,
  Eye: 8,
  Wood: 9,
  Moss: 10,
  Stone: 11,
  Rune: 12,
  Bone: 13,
  Socket: 14,
  Fern: 15,
  Leaf: 16,
  Petal: 17,
  PetalAlt: 18,
  RSkin: 19,
  RFar: 20,
  Stripe: 21,
  Feather: 22,
  Claw: 23,
  Tooth: 24,
  Mouth: 25,
  RBelly: 26,
} as const;

/**
 * Plages d'identifiants réservées (Uint8) :
 *   0-29    cœur (ci-dessus)
 *   30-59   herbivores        (game/species/herbivores.mat.ts)
 *   60-89   carnivores, faune (game/species/carnivores.mat.ts)
 *   90-119  flore             (game/world/flora.mat.ts)
 *   120-149 fouille, atelier  (game/scenes/scenes.mat.ts)
 *   150-179 reptiles volants et marins (game/species/marine.mat.ts)
 *   180-199 nids et œufs (game/species/nest.mat.ts)
 *   200-207 Archelon (game/species/archelon.mat.ts)
 *   208-213 Xiphactinus (game/species/xiphactinus.mat.ts)
 *   214-221 Pteranodon (game/species/pteranodon.mat.ts)
 *   222-228 Nyctosaurus (game/species/nyctosaurus.mat.ts)
 *   229-236 Pectinodon (game/species/pectinodon.mat.ts)
 *   237-245 Allosaurus (game/species/allosaurus.mat.ts)
 *   246-254 Alamosaurus (game/species/alamosaurus.mat.ts)
 * Les couleurs et rampes de chaque matière dépendent du thème : voir palette.ts.
 */

export interface Material {
  color: readonly [number, number, number];
  /** Glyphes du plus sombre au plus éclairé. */
  ramp: string;
  /** Matière lumineuse : ignore l'éclairage. */
  emissive?: boolean;
}

/** Glyphe orienté pour un trait fin de direction (dx, dy) en px écran. */
export function strokeGlyph(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  const d = a / Math.PI; // 0..1, 0 = horizontal
  if (d < 0.14 || d > 0.86) return 45; // -
  if (d < 0.36) return 92; // \
  if (d < 0.64) return 124; // |
  return 47; // /
}

/** Miroir vertical d'un glyphe (pour les reflets dans l'eau). */
const VFLIP: Record<string, string> = {
  "/": "\\", "\\": "/", "^": "v", v: "^", "'": ",", ",": "'", "`": ".", ".": "`",
  _: "-", "-": "_", A: "V", V: "A", M: "W", W: "M", "!": "i", i: "!",
};
export const VFLIP_CODE = new Uint8Array(128).map((_, c) => {
  const f = VFLIP[String.fromCharCode(c)];
  return f ? f.charCodeAt(0) : c;
});
