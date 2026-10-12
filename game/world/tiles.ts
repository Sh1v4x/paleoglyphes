export const T = {
  Dirt: 0,
  /** Couvert végétal bas : fougères, mousses, prêles, herbacées (pas de prairie d'herbe au Crétacé). */
  Grass: 1,
  Shallow: 2,
  Deep: 3,
} as const;

/** Nature du couvert végétal d'une cellule T.Grass (World.cover). */
export const COVER = {
  None: 0,
  /** Prairie de fougères basses. */
  Fern: 1,
  /** Coussins de mousse (sous-bois). */
  Moss: 2,
  /** Prêles (Equisetum), au bord de l'eau. */
  Horsetail: 3,
  /** Fougères piquées de petites fleurs (angiospermes pionnières). */
  Herb: 4,
} as const;

export const isWater = (t: number) => t === T.Shallow || t === T.Deep;
