import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { c, e, rot, rp, win, type Pt } from "./kit";
import { MR } from "./marine.mat";
import { PTERO_REST, pteroModel, pteroSkeleton, type PteroKit, type PteroRig } from "./pteranodon";
import type { Pose, Species } from "./types";

/**
 * Quetzalcoatlus, construit avec le kit ptérosaure du Pteranodon (voir pteranodon.ts : mêmes
 * conventions de pose). Px bruts, regard à droite, origine au sol ; échelle sur l'envergure :
 * 2 x 165 px bruts = 10,5 m.
 * Particularités : quadrupède perché comme une girafe-cigogne, couvert de pycnofibres ; il chasse à
 * pied, donc « attack » est un coup de bec au sol et non un piqué de pêche.
 */
const SPAN_M = 10.5;
export const QUETZAL_SCALE = (SPAN_M * PX_PER_M) / 330;

/** Tête : boîte crânienne à crête, bec en poignard de ~2,7 m (sans dents). Pivot (x0, y0), bec vers +x. */
function head(x0: number, y0: number, jaw: number, closed: boolean): Prim[] {
  const H: Prim[] = [
    e(x0 + 3, y0 - 1, 11, 8, MR.QSkin, 6, 8),
    c(x0 + 1, y0 - 5, x0 - 17, y0 - 17, 5, 1.5, MR.QCrest, 8, 4),
    c(x0 + 6, y0 - 3, x0 + 82, y0 + 1, 7, 0.8, MR.QBeak, 8, 6),
    e(x0 + 24, y0 - 3, 10, 2, MR.QFar, 13, 1),
  ];
  if (closed) H.push(c(x0 + 2, y0 - 3, x0 + 7, y0 - 3, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(x0 + 4, y0 - 3, 2.4, 2.4, M.Eye, 20, 1));
  // Gueule ouverte : intérieur sombre, bec inférieur abaissé.
  if (jaw > 0.08) H.push(e(x0 + 34, y0 + 4, 30, 3 + jaw * 9, MR.MMouth, 3, 2, y0 + 1));
  const J: Prim[] = [c(x0 + 6, y0 + 4, x0 + 78, y0 + 3, 4.5, 0.8, MR.QBeak, 7, 4)];
  if (jaw <= 0.08) J.push(c(x0 + 10, y0 + 2, x0 + 72, y0 + 2, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, x0 + 6, y0 + 3, jaw * 0.42));
  return H;
}

function quetzalRig({ action, actionT: t, time }: Pose): PteroRig {
  const r = { ...PTERO_REST };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.06, neck: 0.4, head: -0.12, stride: 1.5 });
      break;
    case "eat": {
      // Cigogne géante : coups de bec répétés au ras du sol, bec entrouvert juste avant chaque coup.
      const st = Math.abs(Math.sin(t * Math.PI * 3));
      Object.assign(r, { pitch: 0.14, dy: 6, neck: 1.0 + st * 0.18, head: 0.42 + st * 0.12, jaw: (1 - st) * 0.35 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.16, dy: 8, neck: 1.12 + s * 0.02, head: 0.5, jaw: 0.05 });
      break;
    case "rest": {
      const br = Math.sin(time * 1.4) * 0.03;
      Object.assign(r, { legs: "sit", dy: 42, pitch: -0.04, neck: 0.55 + br, head: 0.12, closed: true });
      break;
    }
    case "call": {
      const k = Math.sin(Math.min(1, t * 1.3) * Math.PI);
      Object.assign(r, { pitch: -0.05, neck: -0.2 * k - 0.05, head: -0.85 * k, jaw: (0.55 + 0.25 * Math.abs(s)) * k });
      break;
    }
    case "defend":
      // Se dresse sur les pattes arrière, ailes à demi ouvertes, bec béant.
      Object.assign(r, { legs: "rear", pitch: -0.16, dy: -4, neck: 0.18 + s * 0.04, head: 0.1, jaw: 0.6 + 0.2 * s });
      break;
    case "attack": {
      // Recule le cou (0-0.35), harponne vers l'avant et le bas (0.35-0.6), puis se redresse.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.5));
      const lunge = win(t, 0.35, 0.55) * (1 - win(t, 0.7, 1));
      Object.assign(r, {
        dx: lunge * 14, pitch: 0.14 * lunge - 0.04 * wind,
        neck: -0.4 * wind + 0.95 * lunge, head: -0.1 * wind + 0.35 * lunge,
        jaw: Math.max(wind, lunge) * 0.7 * (1 - win(t, 0.5, 0.58)),
      });
      break;
    }
    default:
      break;
  }
  return r;
}

const Q_KIT: PteroKit = {
  mats: { skin: MR.QSkin, far: MR.QFar, belly: MR.QBelly, wing: MR.QWing, wingFar: MR.QWingFar, vein: MR.QVein, fuzz: MR.QFuzz },
  head,
  tip: [82, 1],
  hip: [-24, -72],
  sho: [20, -98],
  neck0: [26, -100],
  neck1: [50, -168],
  headA: 0.35,
  torso: [15, 19],
  neckR: [10, 6],
  arm: [24, 42, 40],
  leg: [32, 34],
  fold: [-22, -34],
  claws: true,
  crouch: 0,
  flyY: -170,
  edge: [[16, 8], [2, 30], [18, 62], [10, 94], [-40, 165]],
  chord: 0.62,
  flyBody: [[-34, 2], [18, -6]],
  flyNeck: [96, -20],
  diveAttack: false,
  rig: quetzalRig,
};

const EYE: Pt = rp(Q_KIT.neck1[0] + 4, Q_KIT.neck1[1] - 3, Q_KIT.neck1[0], Q_KIT.neck1[1], Q_KIT.headA);

export function quetzalModel(pose: Pose): Prim[] {
  return pteroModel(pose, Q_KIT).map((p) => scalePrim(p, QUETZAL_SCALE));
}

export function quetzalSkeleton(pose: Pose): Prim[] {
  void pose;
  const [x0, y0] = Q_KIT.neck1, B = M.Bone;
  // Crâne : boîte crânienne, crête, bec immense creusé d'une grande fenêtre (os très légers).
  const skull = [
    e(x0 + 3, y0 - 1, 9, 6.5, B, 12, 8),
    c(x0 + 1, y0 - 5, x0 - 16, y0 - 16, 3.5, 1, B, 14, 3),
    c(x0 + 6, y0 - 3, x0 + 82, y0 + 1, 6, 0.8, B, 12, 5),
    c(x0 + 6, y0 + 4, x0 + 78, y0 + 3, 3.5, 0.8, B, 12, 4),
    e(x0 + 4, y0 - 3, 3, 3, M.Socket, 30, 1),
    e(x0 + 22, y0 - 2, 11, 2.5, M.Socket, 30, 1),
  ];
  return pteroSkeleton(Q_KIT, skull, { sternum: "sternum", bassin: "bassin" }, 1.2).map((p) => scalePrim(p, QUETZAL_SCALE));
}

export const QUETZAL: Species = {
  id: "quetzal",
  name: "Quetzalcoatlus",
  latin: "Quetzalcoatlus northropi",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formation de Javelina, Texas (États-Unis)",
  lengthM: SPAN_M,
  massKg: 230,
  facts: [
    { id: "geant", title: "Le plus grand animal volant", unlock: "discover",
      text: "Avec 10 à 11 mètres d'envergure, Quetzalcoatlus est le plus grand animal qui ait jamais volé : ses ailes ouvertes sont aussi larges qu'un bus est long !" },
    { id: "cousin", title: "Pas un dinosaure !", unlock: "assemble",
      text: "C'est un ptérosaure, un reptile volant. Les ptérosaures sont de proches cousins des dinosaures, mais pas des dinosaures. Son aile est tendue par un seul doigt, le quatrième, immense." },
    { id: "plume", title: "Léger comme une plume (presque)", unlock: "rest",
      text: "Ses os étaient creux, avec des parois aussi fines qu'une carte bancaire, renforcées à l'intérieur comme des poutres. Résultat : environ 200 à 250 kg pour un animal de la taille d'une girafe." },
    { id: "cigogne", title: "Une cigogne géante", unlock: "eat",
      text: "Il chassait sans doute à pied, comme une cigogne : il arpentait les plaines et attrapait petits animaux, bébés dinosaures et lézards d'un coup de son bec de près de 3 mètres." },
    { id: "girafe", title: "Haut comme une girafe", unlock: "call",
      text: "Debout sur ses quatre membres, le cou dressé, il mesurait environ 5 mètres de haut : il aurait pu regarder une girafe droit dans les yeux." },
    { id: "envol", title: "Un décollage en saut", unlock: "attack",
      text: "Pour s'envoler, il s'accroupissait puis se propulsait avec ses bras puissants, comme un sauteur à la perche, avant d'ouvrir ses ailes en plein élan." },
    { id: "nom", title: "Le serpent à plumes", unlock: "defend",
      text: "Son nom vient de Quetzalcoatl, le dieu serpent à plumes des Aztèques. Ses fossiles ont été découverts au Texas en 1971." },
    { id: "oeufs-souples", title: "Des œufs enterrés dans le sable", unlock: "nest",
      text: "Les œufs de ptérosaures avaient une coquille souple et parcheminée, comme ceux de certains lézards. Chez Hamipterus, on en a trouvé des centaines : ils étaient sûrement enterrés dans le sable humide." },
    { id: "flapling", title: "Voler dès la naissance ?", unlock: "baby",
      text: "Les bébés ptérosaures, qu'on surnomme « flaplings », avaient déjà des ailes bien formées dans l'œuf. Ils pouvaient sans doute voler très tôt après l'éclosion, sans attendre leurs parents." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "cou", name: "Vertèbres du cou" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "sternum", name: "Sternum (bréchet)" },
    { id: "bassin", name: "Bassin" },
    { id: "ailes", name: "Bras et métacarpes" },
    { id: "doigt", name: "Doigt de l'aile" },
    { id: "pattes", name: "Pattes arrière" },
  ],
  model: quetzalModel,
  skeleton: quetzalSkeleton,
  center: { x: -4 * QUETZAL_SCALE, y: -84 * QUETZAL_SCALE },
  eye: { x: EYE[0] * QUETZAL_SCALE, y: EYE[1] * QUETZAL_SCALE },
  feet: [-18, 32].map((x) => x * QUETZAL_SCALE),
  halfLen: 60 * QUETZAL_SCALE,
  shadow: 0.9,
  walkSpeed: 35,
  runSpeed: 180,
  stride: 6,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: [], defense: "flee", sight: 500, scavenger: false },
  habitat: "air",
};
