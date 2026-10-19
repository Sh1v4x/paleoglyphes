export const T = {
  Dirt: 0,
  /** Couvert végétal bas : fougères, mousses, prêles, herbacées (pas de prairie d'herbe au Crétacé). */
  Grass: 1,
  Shallow: 2,
  Deep: 3,
  /** Toundra (Alaska) : neige tassée, praticable. */
  Snow: 4,
  /** Désert (Gobi) : dunes de sable. */
  Sand: 5,
  /** Marais : vase gorgée d'eau, praticable. */
  Mud: 6,
  /** Montagnes : falaises et éboulis infranchissables (aussi marqués `solid`). */
  Rock: 7,
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
