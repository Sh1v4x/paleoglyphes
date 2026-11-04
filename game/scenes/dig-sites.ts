import { saveProgress, type Progress } from "../progress";
import { SPECIES } from "../species";
import type { SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { toast } from "../ui/toast";
import { BIOME, type BiomeId } from "../world/biomes";
import { SM } from "./scenes.mat";

/**
 * Sites de fouille : chacun reprend un vrai gisement de fossiles, avec ses roches, son décor et ses
 * espèces. Les espèces y sont rangées d'après leur milieu et leurs biomes (`sitesOf`), sauf exception.
 */

const DIG_SITE_IDS = ["hellcreek", "princecreek", "djadochta", "niobrara"] as const;
export type DigSiteId = (typeof DIG_SITE_IDS)[number];
export const isDigSiteId = (v: unknown): v is DigSiteId => (DIG_SITE_IDS as readonly unknown[]).includes(v);

/** Une couche de roche possible du site (sa position est tirée au sort à chaque falaise). */
export interface StratumDef {
  mat: number;
  name: string;
  /** Dureté : 1 = argile ; le pinceau va 2x moins vite dans une roche de dureté 2. */
  hard: number;
  fact: string;
  /** Part de galets semés dans la couche (conglomérat, graviers). */
  pebbles?: number;
  /** Couche mince (charbon, cendre). */
  thin?: boolean;
}

export interface DigSiteDef {
  id: DigSiteId;
  /** Nom court (bouton, panneau). */
  name: string;
  /** Lieu affiché sous le nom du site. */
  place: string;
  age: string;
  /** Présentation du site (choix du site). */
  about: string;
  /** Squelettes assemblés requis pour ouvrir le site. */
  unlock: number;
  topsoil: StratumDef;
  pool: StratumDef[];
  /** Fossiles bonus qu'on peut y trouver (ids de EXTRAS). */
  extras: string[];
  /** Chance d'un œuf fossile par falaise. */
  eggs: number;
  /** Décor : relief à l'horizon, matière du relief, du sol et du caillou isolé. */
  hills: number;
  butte: number;
  ground: number;
  pebble: string;
  /** Le nom du lieu suit l'espèce visée (badlands de l'Ouest américain). */
  byPlace?: boolean;
  /** « Le savais-tu ? » propres au site. */
  facts: string[];
}

export const DIG_SITES: DigSiteDef[] = [
  {
    id: "hellcreek", name: "Hell Creek", place: "Montana (Etats-Unis)", age: "66 Ma", unlock: 0,
    about: "Les badlands du Montana : roches de rivieres et de marais, les derniers dinosaures. On y fouille aussi d'autres falaises de l'Ouest americain aux memes roches : Morrison (Allosaure, bien plus ancien, 150 Ma) et Javelina au Texas (Alamosaure, Quetzalcoatlus).",
    topsoil: { mat: SM.Topsoil, name: "Terre vegetale", hard: 0.5, fact: "Le sol d'aujourd'hui, plein de racines. Les fossiles sont bien plus bas." },
    pool: [
      { mat: SM.Sand, name: "Sable", hard: 0.6, fact: "Du sable de riviere : depose tres vite, il a protege les os de l'air." },
      { mat: SM.Silt, name: "Limon", hard: 0.8, fact: "Une boue fine laissee par les crues de la riviere." },
      { mat: SM.Clay, name: "Argile", hard: 1, fact: "L'argile garde les os a l'abri : un ideal pour les fossiles." },
      { mat: SM.Sandstone, name: "Gres", hard: 2, fact: "Du sable devenu roche dure en des millions d'annees. Le burin aide ici." },
      { mat: SM.Shale, name: "Argilite", hard: 1.4, fact: "De la boue tassee en fines feuilles, couche apres couche." },
      { mat: SM.Lignite, name: "Lignite", hard: 1.1, fact: "Un charbon tendre : ce sont d'anciennes plantes de marais ecrasees.", thin: true },
      { mat: SM.Conglo, name: "Conglomerat", hard: 1.6, fact: "Des galets cimentes : la trace d'une ancienne riviere rapide.", pebbles: 0.16 },
    ],
    extras: ["ambre", "feuille", "dent-requin", "coprolithe", "oeuf", "cone"],
    eggs: 0.25, hills: 0.5, butte: SM.Butte, ground: SM.Grass,
    pebble: "Un caillou tres dur, roule par une ancienne riviere.", byPlace: true,
    facts: [
      "A Hell Creek, on trouve les derniers dinosaures, juste avant la chute de la grande meteorite.",
      "Le premier squelette de T. rex a ete trouve a Hell Creek en 1902, par Barnum Brown.",
      "Il y a 66 millions d'annees, Hell Creek etait une plaine chaude pleine de rivieres, de forets et de marais.",
      "Tout en haut des falaises, une fine couche d'argile garde la poussiere de la meteorite : la fin des dinosaures.",
    ],
  },
  {
    id: "niobrara", name: "Niobrara", place: "Kansas et Dakota du Sud (Etats-Unis)", age: "85-75 Ma", unlock: 2,
    about: "Le fond d'une ancienne mer qui coupait l'Amerique du Nord en deux : craie blanche pleine de dents de requin, reptiles marins, poissons geants et pterosaures. Au-dessus, l'argilite noire de Pierre, celle de l'Archelon.",
    topsoil: { mat: SM.Topsoil, name: "Sol de prairie", hard: 0.5, fact: "Le sol des grandes plaines, ou poussent les herbes hautes. La mer est bien plus bas." },
    pool: [
      { mat: SM.Chalk, name: "Craie blanche", hard: 1.2, fact: "De la craie : des milliards de minuscules coquilles d'algues tombees au fond de la mer." },
      { mat: SM.YellowChalk, name: "Craie jaune", hard: 1, fact: "A l'air libre, la craie jaunit : le fer qu'elle contient rouille, comme un vieux clou." },
      { mat: SM.Ash, name: "Bentonite", hard: 0.7, fact: "Une fine couche de cendre de volcan, tombee dans la mer et devenue argile.", thin: true },
      { mat: SM.DarkShale, name: "Argilite de Pierre", hard: 1.3, fact: "La boue noire d'une mer plus profonde. C'est dans ces << Pierre Shale >> qu'on a trouve l'Archelon." },
    ],
    extras: ["ammonite", "dent-requin", "coprolithe"],
    eggs: 0, hills: 0.3, butte: SM.ChalkTower, ground: SM.Prairie,
    pebble: "Une boule de pyrite rouillee, formee dans la boue du fond de la mer.",
    facts: [
      "Il y a 85 millions d'annees, une mer chaude coupait l'Amerique du Nord en deux, du golfe du Mexique jusqu'a l'Arctique.",
      "On a trouve ici un Xiphactinus de 4 m avec un poisson de 2 m dans le ventre : le << poisson dans le poisson >>.",
      "Cretoxyrhina, un requin de 7 m, a laisse ses dents partout dans la craie du Kansas.",
      "Les Monument Rocks sont des tours de craie de plus de 20 m, sculptees par le vent dans la prairie.",
      "Les Pteranodon du Kansas sont trouves loin de l'ancienne cote : ils pechaient au-dessus de la haute mer.",
    ],
  },
  {
    id: "princecreek", name: "Prince Creek", place: "Alaska (Etats-Unis)", age: "70 Ma", unlock: 3,
    about: "Les falaises de la riviere Colville, tout au nord de l'Alaska : sol gele, graviers et cendres de volcan. Des dinosaures vivaient ici, pres du pole, avec des mois de nuit en hiver.",
    topsoil: { mat: SM.Snow, name: "Neige et mousse", hard: 0.5, fact: "La toundra d'aujourd'hui : neige, mousse et sol gele. L'ete de fouille ne dure que quelques semaines." },
    pool: [
      { mat: SM.Permafrost, name: "Limon gele", hard: 2.2, fact: "Le pergelisol : un sol gele toute l'annee, dur comme du beton. Il faut parfois le laisser degeler au soleil." },
      { mat: SM.Gravel, name: "Gravier", hard: 1.5, fact: "Des graviers roules par d'anciennes rivieres descendues des montagnes.", pebbles: 0.22 },
      { mat: SM.Sand, name: "Sable de riviere", hard: 0.7, fact: "Du sable depose par les crues : il a vite recouvert les os des troupeaux." },
      { mat: SM.Shale, name: "Argilite", hard: 1.4, fact: "La boue fine des plaines inondees, tassee en feuilles." },
      { mat: SM.Ash, name: "Cendre volcanique", hard: 0.8, fact: "La cendre de volcans lointains, devenue argile claire. Elle sert a dater les couches.", thin: true },
      { mat: SM.Lignite, name: "Charbon", hard: 1.1, fact: "D'anciennes forets de marais, ecrasees en charbon, tout pres du pole Nord.", thin: true },
    ],
    extras: ["feuille", "cone", "coprolithe"],
    eggs: 0.2, hills: 0.85, butte: SM.Peaks, ground: SM.Snow,
    pebble: "Un galet gele dans le pergelisol, roule par une riviere du Cretace.",
    facts: [
      "Il y a 70 millions d'annees, Prince Creek etait encore plus pres du pole Nord qu'aujourd'hui : des mois de nuit chaque hiver !",
      "Les premiers os de dinosaures d'Alaska, trouves en 1961, ont d'abord ete pris pour des os de mammiferes.",
      "Les os de Prince Creek sont a peine changes en pierre : ils sont legers et fragiles, le pinceau est de rigueur.",
      "On a trouve ici des os de bebes dinosaures : ils naissaient et grandissaient tout pres du pole.",
      "Pour fouiller dans le sol gele, les paleontologues ont meme creuse un tunnel dans la falaise.",
    ],
  },
  {
    id: "djadochta", name: "Djadochta", place: "Desert de Gobi (Mongolie)", age: "75 Ma", unlock: 4,
    about: "Les falaises rouges du desert de Gobi : dunes fossiles et gres rouge. Des dunes effondrees ont enterre des animaux d'un coup : les squelettes sont souvent entiers, et les nids nombreux.",
    topsoil: { mat: SM.RedSand, name: "Sable du desert", hard: 0.4, fact: "Le sable d'aujourd'hui : chaque tempete de vent fait apparaitre de nouveaux fossiles." },
    pool: [
      { mat: SM.RedSandstone, name: "Gres rouge", hard: 1.6, fact: "Du sable colle en roche. Le rouge vient du fer rouille, comme un vieux clou." },
      { mat: SM.DuneSandstone, name: "Gres de dune", hard: 1.3, fact: "Les lignes en biais sont les flancs d'anciennes dunes, poussees par le vent il y a 75 millions d'annees." },
      { mat: SM.RedSand, name: "Sable effondre", hard: 0.7, fact: "Une dune detrempee s'est effondree d'un coup : les animaux dessous sont restes entiers, comme endormis." },
      { mat: SM.Caliche, name: "Caliche", hard: 2.4, fact: "Des boules de calcaire tres dures, formees par l'eau qui s'evapore dans un sol sec.", pebbles: 0.12 },
    ],
    extras: ["oeuf", "coprolithe"],
    eggs: 0.5, hills: 0.4, butte: SM.RedCliff, ground: SM.RedSand,
    pebble: "Un nodule de caliche, dur comme de la pierre a feu.",
    facts: [
      "Les premiers nids de dinosaures connus ont ete trouves ici en 1923, par l'expedition de Roy Chapman Andrews.",
      "On a trouve un Velociraptor et un Protoceratops figes en plein combat : les << dinosaures combattants >>.",
      "Un Citipati a ete trouve couche sur son nid, les bras ouverts au-dessus de ses oeufs, comme un oiseau qui couve.",
      "Au coucher du soleil, les falaises de Bayanzag brillent en rouge : on les appelle les Falaises Flamboyantes.",
    ],
  },
];

export const DIG_SITE: Record<DigSiteId, DigSiteDef> = Object.fromEntries(DIG_SITES.map((d) => [d.id, d])) as Record<DigSiteId, DigSiteDef>;

/** Exceptions à la règle générale de `sitesOf`. */
const SITE_OVERRIDE: Partial<Record<SpeciesId, DigSiteId[]>> = {
  // Ptérosaure géant des plaines du Texas (Javelina), loin de la mer : avec les espèces de l'Ouest américain.
  quetzal: ["hellcreek"],
};

const BIOME_SITE: Record<BiomeId, DigSiteId> = {
  [BIOME.HellCreek]: "hellcreek",
  [BIOME.Swamp]: "hellcreek",
  [BIOME.Tundra]: "princecreek",
  [BIOME.Desert]: "djadochta",
  [BIOME.Sea]: "niobrara",
};

/**
 * Sites où l'on trouve les os d'une espèce : table d'exceptions, sinon la mer pour les espèces marines
 * et volantes, sinon le site de chacun de ses biomes (défaut : Hell Creek).
 */
export function sitesOf(sp: SpeciesId): DigSiteId[] {
  const spec = SPECIES[sp];
  if (SITE_OVERRIDE[sp]) return SITE_OVERRIDE[sp];
  if (spec?.habitat === "sea" || spec?.habitat === "air") return ["niobrara"];
  return [...new Set((spec?.biomes ?? [BIOME.HellCreek]).map((b) => BIOME_SITE[b]))];
}

export const siteOpen = (p: Progress, id: DigSiteId) => p.assembled.length >= DIG_SITE[id].unlock;

/** Site de fouille choisi (Hell Creek par défaut, ou si le site sauvegardé n'existe plus). */
export function currentDigSite(p: Progress): DigSiteDef {
  const d = p.digSite ? DIG_SITE[p.digSite] : undefined;
  return d && siteOpen(p, d.id) ? d : DIG_SITE.hellcreek;
}

/** Annonce les sites qui viennent de s'ouvrir (une fois chacun). */
export function noteNewSites(s: GameState) {
  const p = s.progress;
  const seen = p.digSites ?? ["hellcreek"];
  const fresh = DIG_SITES.filter((d) => siteOpen(p, d.id) && !seen.includes(d.id));
  if (!fresh.length) return;
  p.digSites = [...seen, ...fresh.map((d) => d.id)];
  saveProgress(p);
  for (const d of fresh) toast(s, `Nouveau site de fouille : ${d.name} !`, `${d.place}, ${d.age}. Dans la fouille (touche 2), touche M pour changer de site.`);
}
