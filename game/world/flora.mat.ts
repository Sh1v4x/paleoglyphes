import type { RGB } from "../palette";
import type { MaterialSet } from "../species/types";

// Copie locale de hex() : palette.ts importe ce module, on évite le cycle à l'exécution.
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Flore de Hell Creek (Crétacé terminal) : identifiants 90-119.
 * Rampes du plus sombre au plus éclairé (clairsemé -> dense), comme dans palette.ts.
 */
export const F = {
  /** Écorce fibreuse rousse des séquoias / métaséquoias. */
  Bark: 90,
  /** Écorce lisse grise (magnolias, ginkgos). */
  BarkSmooth: 91,
  /** Stipe des palmiers : anneaux de bases de feuilles. */
  PalmBark: 92,
  /** Tronc écailleux en losanges des cycas. */
  CycadBark: 93,
  /** Stipe fibreux des fougères arborescentes. */
  FernTrunk: 94,
  /** Feuillage en aiguilles des séquoias (étages). */
  Needle: 95,
  /** Rameaux en cordes écailleuses de l'araucaria. */
  Araucaria: 96,
  /** Frondes pennées (cycas, fougère arborescente). */
  Frond: 97,
  /** Éventail du palmier Sabalites. */
  PalmLeaf: 98,
  /** Palmes mortes pendantes (jupe du palmier). */
  DryFrond: 99,
  /** Feuilles larges et luisantes des premières plantes à fleurs. */
  Broadleaf: 100,
  /** Grandes fleurs de magnolia. */
  Blossom: 101,
  /** Feuilles en éventail du ginkgo. */
  Ginkgo: 102,
  /** Tiges articulées des prêles (Equisetum). */
  Horsetail: 103,
  /** Cônes : épis des prêles, cônes des cycas et des conifères. */
  Cone: 104,
  /** Fougères basses (touffes). */
  Fern: 105,
  /** Coussins de mousse. */
  Moss: 106,
  /** Petites herbacées à fleurs (deux teintes). */
  Herb: 107,
  HerbAlt: 108,
  /** Affleurement de grès et ses strates (fossiles en cartoon). */
  Sandstone: 109,
  Strata: 110,
  /** Bois mort grisâtre (dark uniquement). */
  DeadWood: 111,
} as const;

const D = {
  [F.Bark]: { color: hex("#4e3a32"), ramp: "':!|lI1H" },
  [F.BarkSmooth]: { color: hex("#4c4a4a"), ramp: "':;!|lI" },
  [F.PalmBark]: { color: hex("#4a4236"), ramp: ".-:=#" },
  [F.CycadBark]: { color: hex("#4a4433"), ramp: ".:xX%#" },
  [F.FernTrunk]: { color: hex("#3e3328"), ramp: ".:;%#&" },
  [F.Needle]: { color: hex("#2e3c30"), ramp: ".,:;^*A#" },
  [F.Araucaria]: { color: hex("#34402e"), ramp: ".:;o%&@" },
  [F.Frond]: { color: hex("#3a4a32"), ramp: ".,;=+*#" },
  [F.PalmLeaf]: { color: hex("#3c4934"), ramp: ".,:;=+*" },
  [F.DryFrond]: { color: hex("#4a3e2e"), ramp: ".,;|" },
  [F.Broadleaf]: { color: hex("#2c3a2e"), ramp: ".:oO0@" },
  [F.Blossom]: { color: hex("#9a92a8"), ramp: "o*@" },
  [F.Ginkgo]: { color: hex("#5e5c34"), ramp: ".:;vvwW" },
  [F.Horsetail]: { color: hex("#4a5a3c"), ramp: ":!|" },
  [F.Cone]: { color: hex("#5e4a36"), ramp: ".:o0" },
  [F.Fern]: { color: hex("#3c4a34"), ramp: ",;\"v" },
  [F.Moss]: { color: hex("#46523a"), ramp: ".:o0O" },
  [F.Herb]: { color: hex("#6e6a86"), ramp: ".*" },
  [F.HerbAlt]: { color: hex("#56627a"), ramp: ".*" },
  [F.Sandstone]: { color: hex("#5c5446"), ramp: ".:;=xX#" },
  [F.Strata]: { color: hex("#423a30"), ramp: "-=" },
  [F.DeadWood]: { color: hex("#4a4440"), ramp: "':!|lI1H" },
};

const C = {
  [F.Bark]: { color: hex("#b4643a"), ramp: "!|lI" },
  [F.BarkSmooth]: { color: hex("#9a8a7a"), ramp: ":|lI" },
  [F.PalmBark]: { color: hex("#a07a4c"), ramp: "-=#%" },
  [F.CycadBark]: { color: hex("#9a7444"), ramp: "xX%#" },
  [F.FernTrunk]: { color: hex("#7a5232"), ramp: ";%#&" },
  [F.Needle]: { color: hex("#2e8a5a"), ramp: ".^A#" },
  [F.Araucaria]: { color: hex("#3c9a4a"), ramp: ":o%&" },
  [F.Frond]: { color: hex("#4cbf4f"), ramp: ":=*#" },
  [F.PalmLeaf]: { color: hex("#62cc58"), ramp: ":=+*" },
  [F.DryFrond]: { color: hex("#c09a5a"), ramp: ",;|" },
  [F.Broadleaf]: { color: hex("#2f9e52"), ramp: ".oO@" },
  [F.Blossom]: { color: hex("#ffe0ee"), ramp: "o*@" },
  [F.Ginkgo]: { color: hex("#c2dc48"), ramp: ".vwW" },
  [F.Horsetail]: { color: hex("#74c44c"), ramp: "|" },
  [F.Cone]: { color: hex("#e0873a"), ramp: "o0@" },
  [F.Fern]: { color: hex("#33a03c"), ramp: "|" },
  [F.Moss]: { color: hex("#5cb85c"), ramp: "oO@" },
  [F.Herb]: { color: hex("#ffe14d"), ramp: "*@" },
  [F.HerbAlt]: { color: hex("#ff8fc0"), ramp: "*@" },
  [F.Sandstone]: { color: hex("#e2b67c"), ramp: ".:=#" },
  [F.Strata]: { color: hex("#b88450"), ramp: "-=" },
  [F.DeadWood]: { color: hex("#8a7a6a"), ramp: "|lI#" },
};

/** Matières de ce module, déclinées par style. Identifiants : voir les plages dans render/materials.ts. */
export const FLORA_MATS: MaterialSet = { dark: D, cartoon: C };
