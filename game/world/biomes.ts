/**
 * Biomes de la réserve. Chacun reprend un vrai site fossilifère de la fin du Crétacé : la réserve
 * rassemble des lieux et des époques proches, que le Carnet présente comme tels.
 *
 *   nord       : toundra et montagnes enneigées (Alaska, formation de Prince Creek, ~70 Ma)
 *   centre     : forêts et prairies de fougères (Montana, Hell Creek, 66 Ma)
 *   sud-ouest  : désert de dunes (Mongolie, Gobi, formation de Djadochta, ~75 Ma)
 *   sud        : marais côtiers (Hell Creek et plaines côtières de Laramidia)
 *   est        : la mer (Voie maritime intérieure de l'Ouest)
 */

export const BIOME = {
  HellCreek: 0,
  Swamp: 1,
  Tundra: 2,
  Desert: 3,
  Sea: 4,
} as const;
export type BiomeId = (typeof BIOME)[keyof typeof BIOME];

export interface BiomeInfo {
  name: string;
  /** Le vrai site fossilifère, pour le Carnet et l'interface. */
  site: string;
  age: string;
}

export const BIOME_INFO: Record<BiomeId, BiomeInfo> = {
  [BIOME.HellCreek]: { name: "Forets de Hell Creek", site: "Montana, formation de Hell Creek", age: "66 Ma" },
  [BIOME.Swamp]: { name: "Marais cotiers", site: "Plaines cotieres de Laramidia", age: "66 Ma" },
  [BIOME.Tundra]: { name: "Toundra enneigee", site: "Alaska, formation de Prince Creek", age: "70 Ma" },
  [BIOME.Desert]: { name: "Desert de Gobi", site: "Mongolie, formation de Djadochta", age: "75 Ma" },
  [BIOME.Sea]: { name: "Voie maritime interieure", site: "Mer peu profonde qui coupait l'Amerique du Nord", age: "66 Ma" },
};

/**
 * Biome d'un point, en coordonnées normalisées (u = x / largeur, v = y / hauteur, 0..1).
 * `n` est un bruit 2D (-1..1) : les frontières ondulent au lieu d'être des lignes droites.
 * `coastU` est la position de la côte (fraction de largeur) à cette hauteur.
 */
export function biomeAt(u: number, v: number, coastU: number, n: (x: number, y: number) => number): BiomeId {
  if (u >= coastU) return BIOME.Sea;
  const wob = 0.045 * n(u * 3.1 + 11, v * 3.1) + 0.015 * n(u * 11, v * 11 + 4);
  if (v < 0.3 + wob) return BIOME.Tundra;
  if (v > 0.62 - wob) return u < 0.4 + wob * 1.5 ? BIOME.Desert : BIOME.Swamp;
  return BIOME.HellCreek;
}
