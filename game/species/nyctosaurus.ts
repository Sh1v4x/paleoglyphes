import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { MR } from "./marine.mat";
import { NY } from "./nyctosaurus.mat";
import { pteroModel, pteroSkeleton, rp, type Pt, type PteroKit } from "./pteranodon";
import { c, e, rot } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Nyctosaurus (Nyctosaurus gracilis), construit avec le kit ptérosaure du Pteranodon (voir pteranodon.ts :
 * mêmes conventions de pose, « attack » = piqué de pêche au ras de l'eau). Px bruts, regard à droite,
 * origine au sol ; échelle sur l'envergure : 2 x 165 px bruts = 2,8 m.
 * Particularités : crête en bois de cerf plus longue que le corps (traits fins, toujours lisibles), mains
 * sans aucun doigt griffu (il ne reste que le doigt de l'aile), posture accroupie et maladroite au sol,
 * ailes très longues et étroites de planeur océanique. Le corps et la tête sont un peu grossis pour rester
 * lisibles à cette petite taille.
 */
const SPAN_M = 2.8;
export const NYCTOSAURUS_SCALE = (SPAN_M * PX_PER_M) / 330;

/** Tête : petit crâne, bec pointu sans dents, crête à deux branches. Pivot (x0, y0) à la base du crâne. */
function nyctoHead(x0: number, y0: number, jaw: number, closed: boolean, fish: number): Prim[] {
  const H: Prim[] = [
    e(x0 + 4, y0 - 1, 11, 8, NY.Skin, 6, 8),
    // Crête : socle, longue branche dressée vers le haut et l'arrière, seconde branche vers l'arrière.
    c(x0 + 2, y0 - 5, x0 - 6, y0 - 18, 5, 3, NY.Crest, 8, 4),
    c(x0 - 6, y0 - 18, x0 - 40, y0 - 90, 1, 1, NY.Crest, 12, 1, true),
    c(x0 - 40, y0 - 90, x0 - 54, y0 - 100, 1, 1, NY.Crest, 12, 1, true),
    c(x0 - 6, y0 - 18, x0 - 70, y0 - 44, 1, 1, NY.Crest, 12, 1, true),
    // Bec supérieur effilé.
    c(x0 + 8, y0 - 3, x0 + 48, y0 + 3, 6, 1.2, NY.Beak, 8, 5),
  ];
  if (closed) H.push(c(x0 + 3, y0 - 3, x0 + 9, y0 - 3, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(x0 + 6, y0 - 3, 4, 4, M.Eye, 20, 1));
  if (jaw > 0.08) H.push(e(x0 + 26, y0 + 4, 20, 2 + jaw * 9, MR.MMouth, 3, 2, y0 + 1));
  const J: Prim[] = [
    c(x0 + 8, y0 + 4, x0 + 44, y0 + 4, 4.5, 1, NY.Beak, 7, 4),
    e(x0 + 12, y0 + 6, 8, 3.5, NY.Belly, 5, 3),
  ];
  H.push(...rot(J, x0 + 8, y0 + 4, jaw * 0.4));
  if (fish > 0) {
    // Petit poisson tenu en travers du bec.
    const fx = x0 + 38, fy = y0 + 4, f = fish;
    H.push(e(fx, fy + 3 * f, 4.5 * f, 12 * f, MR.MScale, 16, 3));
    H.push(c(fx, fy + 13 * f, fx + 5 * f, fy + 20 * f, 3 * f, 1, MR.MScale, 16, 2));
    H.push(c(fx, fy + 13 * f, fx - 5 * f, fy + 20 * f, 3 * f, 1, MR.MScale, 16, 2));
  }
  return H;
}

const N_KIT: PteroKit = {
  mats: { skin: NY.Skin, far: NY.Far, belly: NY.Belly, wing: NY.Wing, wingFar: NY.WingFar, vein: 0 },
  head: nyctoHead,
  tip: [48, 3],
  hip: [-18, -44],
  sho: [16, -64],
  neck0: [20, -66],
  neck1: [36, -94],
  headA: 0.1,
  torso: [15, 17],
  neckR: [9, 7],
  arm: [20, 26, 40],
  leg: [17, 21],
  fold: [-40, -52],
  claws: false,
  // Il se posait rarement : accroupi, ventre près du sol.
  crouch: 12,
  flyY: -182,
  edge: [[14, 8], [0, 24], [18, 48], [10, 76], [-64, 165]],
  chord: 0.7,
  flyBody: [[-22, 2], [12, -4]],
  flyNeck: [32, -16],
};

const EYE: Pt = rp(N_KIT.neck1[0] + 6, N_KIT.neck1[1] - 3 + N_KIT.crouch, N_KIT.neck1[0], N_KIT.neck1[1] + N_KIT.crouch, N_KIT.headA);

export function nyctosaurusModel(pose: Pose): Prim[] {
  return pteroModel(pose, N_KIT).map((p) => scalePrim(p, NYCTOSAURUS_SCALE));
}

export function nyctosaurusSkeleton(pose: Pose): Prim[] {
  void pose;
  const [x0, y0] = N_KIT.neck1, B = M.Bone;
  // Crâne : bec effilé, grande fenêtre, et la crête en deux longues baguettes d'os.
  const skull = [
    e(x0 + 4, y0 - 1, 10, 7, B, 12, 7),
    c(x0 + 2, y0 - 5, x0 - 6, y0 - 18, 4, 2.5, B, 14, 3),
    c(x0 - 6, y0 - 18, x0 - 40, y0 - 90, 1, 1, B, 14, 1, true),
    c(x0 - 6, y0 - 18, x0 - 70, y0 - 44, 1, 1, B, 14, 1, true),
    c(x0 + 8, y0 - 3, x0 + 48, y0 + 3, 5.5, 1.2, B, 12, 5),
    c(x0 + 8, y0 + 4, x0 + 44, y0 + 4, 4, 1, B, 12, 4),
    e(x0 + 6, y0 - 3, 4, 4, M.Socket, 30, 1),
  ];
  return pteroSkeleton(N_KIT, skull, { sternum: "vertebres", bassin: "vertebres" }, 1.8).map((p) => scalePrim(p, NYCTOSAURUS_SCALE));
}

export const NYCTOSAURUS: Species = {
  id: "nyctosaurus",
  name: "Nyctosaurus",
  latin: "Nyctosaurus gracilis",
  period: "Crétacé supérieur, 85 Ma",
  place: "Formation de Niobrara, Kansas (États-Unis)",
  lengthM: SPAN_M,
  massKg: 4,
  facts: [
    { id: "crete", title: "Une crête plus grande que lui", unlock: "discover",
      text: "Certains adultes portaient une crête en forme de bois de cerf, à deux branches, plus longue que tout leur corps ! Elle servait sans doute à se faire remarquer." },
    { id: "mains", title: "Des ailes sans griffes", unlock: "assemble",
      text: "C'est le seul ptérosaure connu qui a perdu les petits doigts griffus de ses mains : il ne lui restait que l'immense doigt de l'aile. Il ne pouvait donc ni s'agripper ni grimper, et marchait mal." },
    { id: "planeur", title: "Une vie dans les airs", unlock: "rest",
      text: "Comme l'albatros ou la frégate d'aujourd'hui, il passait presque toute sa vie à planer au-dessus de l'océan, loin des côtes, en se posant le moins possible." },
    { id: "leger", title: "Grandes ailes, petit corps", unlock: "eat",
      text: "Ses ailes mesuraient près de 3 mètres d'envergure, mais il ne pesait que 4 kilos environ, à peu près comme un chat. Il mangeait de petits poissons." },
    { id: "peche", title: "Pêche au vol", unlock: "attack",
      text: "Il attrapait les poissons sans se poser : il frôlait les vagues et les happait d'un coup de son bec pointu et sans dents." },
    { id: "oeufs", title: "Des œufs tout mous", unlock: "nest",
      text: "Comme tous les ptérosaures, il pondait des œufs à coquille souple et parcheminée, un peu comme ceux des tortues ou des lézards." },
    { id: "flapling", title: "Voler tout petit", unlock: "baby",
      text: "Les bébés ptérosaures, surnommés « flaplings », naissaient avec des ailes déjà formées et pouvaient sans doute voler très jeunes." },
  ],
  bones: [
    { id: "crane", name: "Crâne et crête" },
    { id: "cou", name: "Vertèbres du cou" },
    { id: "vertebres", name: "Colonne et bassin" },
    { id: "ailes", name: "Bras sans griffes" },
    { id: "doigt", name: "Doigt de l'aile" },
    { id: "pattes", name: "Pattes arrière" },
  ],
  model: nyctosaurusModel,
  skeleton: nyctosaurusSkeleton,
  center: { x: -2 * NYCTOSAURUS_SCALE, y: -46 * NYCTOSAURUS_SCALE },
  eye: { x: EYE[0] * NYCTOSAURUS_SCALE, y: EYE[1] * NYCTOSAURUS_SCALE },
  feet: [-12, 28].map((x) => x * NYCTOSAURUS_SCALE),
  halfLen: 48 * NYCTOSAURUS_SCALE,
  shadow: 0.9,
  walkSpeed: 25,
  runSpeed: 150,
  stride: 7,
  behavior: { diet: "carnivore", herd: [1, 3], browse: null, prey: [], defense: "flee", sight: 450, scavenger: false },
  habitat: "air",
};
