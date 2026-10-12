import { M } from "../render/materials";
import type { Prim } from "../render/raster";
import { CM } from "./carnivores.mat";
import { c, e, lerp } from "./raptor";
import type { Pose } from "./types";

/**
 * Petite faune d'ambiance de la réserve : ni fouille ni squelette, juste de la vie.
 * Modèles en px monde (pas de mise à l'échelle), regard à droite.
 * - Faune au sol : origine au sol sous le corps.
 * - Volants : origine au centre du corps ; le jeu les dessine `altitude` px plus haut, avec une ombre au sol.
 * Actions comprises : idle, walk, run, eat (et rest pour le Didelphodon) ; les autres retombent sur idle.
 * La phase `walk` anime les pattes, ou les battements d'ailes des volants.
 */
export type FaunaId = "dragonfly" | "beetle" | "didelphodon" | "pterosaur";

export interface FaunaDef {
  id: FaunaId;
  name: string;
  latin: string;
  /** Un fait pour la page « à côté des dinosaures » du carnet. */
  text: string;
  model(pose: Pose): Prim[];
  /** Vitesse de déplacement (px/s) et cadence (rad/s) de la phase `walk`. */
  speed: number;
  stride: number;
  flying: boolean;
  /** Volants : hauteur de vol (px) au-dessus de l'ombre. */
  altitude?: number;
  /** Rayon de l'ombre au sol (px). */
  shadow: number;
}

// --- Libellule : 2-3 cellules, ailes qui papillonnent ---
function dragonfly({ walk, time }: Pose): Prim[] {
  const up = Math.sin(time * 70 + walk * 3) > 0;
  const W = CM.FlyWing;
  const wy = up ? -6 : 4, sp = up ? 2 : 4;
  return [
    c(-9, 0, 4, 0, 1, 1, CM.FlyBody, 2, 1, true),
    e(6, 0, 1.8, 1.8, CM.FlyBody, 4, 2),
    c(1, 0, 1 - sp, wy, 1, 1, W, 6, 1, true),
    c(3, 0, 3 + sp, wy, 1, 1, W, 6, 1, true),
  ];
}

// --- Coléoptère : 1-2 cellules au ras du sol ---
function beetle({ walk, moving }: Pose): Prim[] {
  const s = Math.sin(walk * 2) * moving;
  return [
    c(-3, -1, -5, 1 + s, 1, 1, CM.BeetleLeg, 1, 1, true),
    c(2, -1, 4, 1 - s, 1, 1, CM.BeetleLeg, 1, 1, true),
    e(-0.5, -3, 4, 3, CM.Beetle, 2, 3),
    e(4, -3, 1.6, 1.6, CM.BeetleLeg, 3, 1),
  ];
}

// --- Didelphodon : ~1 m, trapu comme une loutre, mâchoires de broyeur ---
function didelphodon({ walk, moving, time, action, actionT }: Pose): Prim[] {
  const run = action === "run";
  const eat = action === "eat";
  const rest = action === "rest";
  const amp = run ? 1.5 : 1;
  // Course : bonds (pattes avant ensemble, arrière ensemble). Marche : diagonales.
  const bob = run ? -Math.abs(Math.sin(walk)) * 3 * moving : -Math.abs(Math.sin(walk)) * 0.8 * moving;
  const sniff = action === "idle" ? Math.max(0, Math.sin(time * 9)) * 1.2 : 0;
  const chew = eat ? Math.abs(Math.sin(actionT * Math.PI * 6)) : 0;
  const by = rest ? 3 : bob;
  const P: Prim[] = [];

  // Pattes.
  if (!rest) {
    for (const L of [{ x: 7, ph: 0, far: true }, { x: -6, ph: Math.PI, far: true },
      { x: 9, ph: run ? 0.4 : Math.PI, far: false }, { x: -4, ph: run ? Math.PI + 0.4 : 0, far: false }]) {
      const s = Math.sin(walk + L.ph) * moving * amp;
      const lift = Math.max(0, Math.cos(walk + L.ph)) * moving * 2 * amp;
      const m = L.far ? CM.DidFar : CM.DidFur;
      P.push(c(L.x, -6 + by, L.x + s * 3.5 + 1, -1 - lift, 2.2, 1.6, m, L.far ? -4 : 6, 2));
    }
  }
  // Queue épaisse, corps, ventre.
  const tw = Math.sin(time * 2) * 1.5;
  P.push(c(-9, -8 + by, -22, rest ? -2 : -4 + tw, 3.5, 1.2, CM.DidFur, 1, 3));
  P.push(e(0, -8 + by, 11.5, 6.5, CM.DidFur, 0, 7));
  P.push(e(1, -4 + by, 9, 2.5, CM.DidBelly, 3, 3, -5 + by));
  P.push(c(-8, -13 + by, 6, -14 + by, 1.5, 1.5, CM.DidFar, 6, 1));
  // Tête : grosse, museau court et puissant ; baissée pour manger.
  const hy = (eat ? -4 : rest ? -6 : -10 - sniff) + by, hx = eat ? 14 : 13;
  P.push(e(hx, hy, 6, 5, CM.DidFur, 2, 6));
  P.push(c(hx + 2, hy + 1, hx + 9, hy + 2 + (eat ? 1 : 0), 3.2, 1.8, CM.DidFur, 3, 4));
  P.push(e(hx + 9.5, hy + 1.6, 1.3, 1.3, CM.DidNose, 9, 1));
  P.push(e(hx - 3, hy - 5, 2, 2.4, CM.DidFar, 4, 2));
  if (rest) P.push(c(hx + 1, hy - 1.5, hx + 3, hy - 1.5, 1, 1, CM.Lid, 9, 1, true));
  else P.push(e(hx + 2, hy - 1.5, 1.1, 1.1, M.Eye, 9, 1));
  if (eat) {
    P.push(c(hx + 2, hy + 3 + chew, hx + 9, hy + 3 + chew * 2, 1.6, 1, CM.DidFur, 4, 2));
    P.push(e(hx + 6, hy + 2.5 + chew, 1, 1.2, M.Tooth, 8, 1));
  }
  return P;
}

// --- Ptérosaure azhdarchidé en vol : grand bec, crête, battements lents ou plané ---
function pterosaur({ walk, moving }: Pose): Prim[] {
  // moving = 0 : plané (ailes presque fixes) ; 1 : battements complets.
  const f = Math.sin(walk) * lerp(0.15, 1, moving);
  const u = (f + 1) / 2;
  const P: Prim[] = [];
  const S = { x: 4, y: -3 };
  const HIND = { x: -12, y: 2 };

  const wing = (far: boolean) => {
    const tipY = far ? S.y + lerp(-26, -62, u) : S.y + lerp(44, -52, u);
    const tipX = S.x - (far ? 22 : 30);
    const wrX = S.x + (tipX - S.x) * 0.42 + 9, wrY = S.y + (tipY - S.y) * 0.42;
    const m = far ? CM.PteroFar : CM.PteroWing;
    const z = far ? -20 : 20;
    // Membrane : éventail de capsules du flanc vers le bord d'attaque.
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const ex = t < 0.5 ? lerp(S.x, wrX, t * 2) : lerp(wrX, tipX, (t - 0.5) * 2);
      const ey = t < 0.5 ? lerp(S.y, wrY, t * 2) : lerp(wrY, tipY, (t - 0.5) * 2);
      P.push(c(HIND.x + 2, HIND.y, ex, ey, 6, 3 + (1 - t) * 3, m, z, 4));
    }
    // Bord d'attaque : bras puis doigt de l'aile, en trait fin.
    P.push(c(S.x, S.y, wrX, wrY, 1, 1, CM.PteroBody, z + 6, 2, true));
    P.push(c(wrX, wrY, tipX, tipY, 1, 1, CM.PteroBody, z + 6, 2, true));
  };
  wing(true);
  // Corps velu (pycnofibres), pattes repliées vers l'arrière.
  P.push(e(-2, 0, 15, 6.5, CM.PteroBody, 0, 8));
  P.push(c(-12, 3, -26, 6, 1, 1, CM.PteroBody, 4, 1, true));
  P.push(c(-12, 1, -25, 2, 1, 1, CM.PteroFar, -4, 1, true));
  // Long cou rigide, tête immense : bec en poignard et crête.
  P.push(c(10, -3, 36, -11, 4, 3, CM.PteroBody, 4, 4));
  P.push(e(40, -12, 6, 4.5, CM.PteroBody, 6, 5));
  P.push(c(44, -12, 82, -6, 3.5, 1, CM.PteroBeak, 8, 3));
  P.push(c(46, -9, 78, -6, 1, 1, M.Mouth, 12, 1, true));
  P.push(c(38, -15, 30, -22, 3.5, 1.5, CM.PteroCrest, 8, 3));
  P.push(e(42, -13, 1.4, 1.4, M.Eye, 14, 1));
  wing(false);
  return P;
}

export const FAUNA: Record<FaunaId, FaunaDef> = {
  dragonfly: {
    id: "dragonfly", name: "Libellule", latin: "Odonata",
    text: "Les libellules volaient déjà bien avant les dinosaures. Leurs lointains cousins, il y a 300 millions d'années, atteignaient 70 cm d'envergure !",
    model: dragonfly, speed: 70, stride: 12, flying: true, altitude: 14, shadow: 2,
  },
  beetle: {
    id: "beetle", name: "Coléoptère", latin: "Coleoptera",
    text: "Des galeries de bousiers ont été retrouvées dans des crottes fossiles de dinosaures : les coléoptères faisaient déjà le ménage du Crétacé.",
    model: beetle, speed: 9, stride: 14, flying: false, shadow: 3,
  },
  didelphodon: {
    id: "didelphodon", name: "Didelphodon", latin: "Didelphodon vorax",
    text: "De la taille d'un gros opossum, c'est l'un des plus grands mammifères de Hell Creek. Pour sa taille, sa morsure était l'une des plus fortes de tous les mammifères : il broyait coquillages, carapaces et os.",
    model: didelphodon, speed: 38, stride: 14, flying: false, shadow: 9,
  },
  pterosaur: {
    id: "pterosaur", name: "Azhdarchidé", latin: "Azhdarchidae (type Quetzalcoatlus)",
    text: "Les azhdarchidés, comme Quetzalcoatlus, pouvaient dépasser 10 m d'envergure : les plus grands animaux volants de tous les temps. Ce n'étaient pas des dinosaures, mais leurs proches cousins.",
    model: pterosaur, speed: 85, stride: 2.2, flying: true, altitude: 150, shadow: 22,
  },
};

export const FAUNA_LIST: FaunaDef[] = Object.values(FAUNA);
