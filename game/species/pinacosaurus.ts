import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { c, e, rot, squash, strike } from "./kit";
import { PN } from "./pinacosaurus.mat";
import type { Pose, Species } from "./types";

/**
 * Pinacosaure modélisé en primitives (px locaux, regard vers la droite, origine au sol sous le ventre).
 * Ankylosauridé plus bas et plus léger que l'ankylosaure : carapace plate en bandes d'ostéodermes,
 * pointes latérales longues aux épaules, pattes fines, longue queue raide et petite massue,
 * museau étroit percé de narines multiples.
 * Le modèle brut mesure ~300 px du bout de la massue au bec ; on le ramène à sa taille réelle.
 */
const LENGTH_M = 5;
export const PINACOSAURUS_SCALE = (LENGTH_M * PX_PER_M) / 300;

interface PinacoLook {
  bob: number;
  drop: number;
  legs: "walk" | "tuck" | "none";
  amp: number;
  spread: number;
  headA: number;
  headDy: number;
  mouth: number;
  tailUp: number;
  tailFold: number;
  sway: number;
  eye: boolean;
}

export function pinacosaurusModel(pose: Pose): Prim[] {
  const { walk, moving, time, action, actionT: at } = pose;
  const run = action === "run";
  const amp = run ? 1.5 : 1;
  const rest = action === "rest";
  const breath = Math.sin((time * Math.PI * 2) / (rest ? 3 : 1.1)) * (1 - moving) * (rest ? 1.6 : 1);
  const L: PinacoLook = {
    bob: -Math.abs(Math.sin(walk)) * 3 * moving * amp + breath, drop: 0,
    legs: "walk", amp, spread: 0, headA: run ? 0.1 : 0, headDy: 0, mouth: 0, tailUp: 0, tailFold: 0,
    sway: Math.sin(time * 1.5) * 3 * (1 - moving) + Math.sin(walk) * 10 * moving * amp, eye: true,
  };
  const chew = Math.sin(at * Math.PI * 8);
  if (action === "eat") { L.headA = 0.5 + chew * 0.05; L.headDy = 6; L.mouth = Math.max(0, chew) * 0.6; }
  else if (action === "drink") { L.headA = 0.62; L.headDy = 10; L.drop = 5; L.spread = 8; }
  else if (action === "rest") { L.drop = 22; L.legs = "tuck"; L.headA = 0.12; L.headDy = 8; L.sway *= 0.3; L.tailUp = -0.08; }
  else if (action === "call") { const k = Math.sin(Math.min(1, at * 1.4) * Math.PI); L.headA = -0.32 * k; L.headDy = -3 * k; L.mouth = k; }
  else if (action === "defend") {
    // Accroupi pour protéger le ventre, massue levée et prête.
    L.drop = 10; L.headA = 0.22; L.headDy = 6; L.spread = 6;
    L.tailUp = 0.85 + Math.sin(time * 4) * 0.1; L.sway = 0;
  } else if (action === "attack") {
    // Coup de massue : la queue se lève, puis balaie vers le spectateur.
    const { s, hit } = strike(at);
    L.drop = 5 + hit * 3; L.headA = 0.14; L.headDy = 4; L.spread = 5;
    L.tailUp = s > 0 ? s * 1.3 : s * 0.4; L.tailFold = hit; L.sway = 0;
  } else if (action === "dead") {
    L.legs = "none"; L.eye = false; L.headA = 0.12; L.tailUp = -0.06; L.sway = 0; L.bob = 0;
  }
  const P = pinacoParts(L, walk, moving);
  if (action === "dead") {
    // Couché sur le flanc : corps aplati, pattes fines et raides tendues.
    const D = squash(P, 0.62, 2);
    for (const [hip, dir, far] of [[-42, -1, true], [38, 1, true], [-34, -1, false], [46, 1, false]] as const) {
      const fx = hip + dir * (far ? 26 : 20), fy = far ? -18 : 8, m = far ? PN.Far : PN.Skin, z = far ? -40 : 30;
      D.push(c(hip, -14, fx, fy, 9, 6, m, z, 8));
      D.push(e(fx + dir * 4, fy, 6, 5, m, z, 5));
      D.push(e(fx + dir * 10, fy, 2.5, 2, PN.Spike, z + 5, 2));
    }
    D.push(c(94, -36, 102, -36, 1, 1, PN.Back, 60, 1, true));
    return D.map((p) => scalePrim(p, PINACOSAURUS_SCALE));
  }
  return P.map((p) => scalePrim(p, PINACOSAURUS_SCALE));
}

function pinacoParts(L: PinacoLook, walk: number, moving: number): Prim[] {
  const bob = L.bob + L.drop;
  const P: Prim[] = [];

  // --- Pattes fines (diagonales opposées en phase) ---
  const legs = [
    { hip: -42, phase: 0, far: true, front: false },
    { hip: 38, phase: Math.PI, far: true, front: true },
    { hip: -34, phase: Math.PI, far: false, front: false },
    { hip: 46, phase: 0, far: false, front: true },
  ];
  for (const G of legs) {
    const m = G.far ? PN.Far : PN.Skin;
    const z = G.far ? -50 : 22;
    if (L.legs === "tuck") {
      const fx = G.hip + (G.front ? 10 : -2);
      P.push(e(fx, -5, 14, 5, m, z, 5));
      P.push(e(fx + 12, -3, 2.5, 2, PN.Spike, z + 5, 2));
      continue;
    }
    if (L.legs === "none") continue;
    const s = Math.sin(walk + G.phase) * moving * L.amp;
    const lift = Math.max(0, Math.cos(walk + G.phase)) * moving * 7 * L.amp;
    const fx = G.hip + s * 13 + (G.front ? (G.far ? -L.spread * 0.6 : L.spread) : 0);
    P.push(c(G.hip, -42 + bob, fx, -7 - lift, 13, 9, m, z, 10));
    P.push(e(fx + 3, -5 - lift, 12, 6, m, z, 6));
    for (const t of [-4, 3]) P.push(e(fx + 10 + t * 0.4, -3 - lift, 2.5, 2, PN.Spike, z + 5, 2));
  }

  // --- Carapace basse et plate ---
  const DX = 0, DY = -54 + bob, RX = 78, RY = 36;
  P.push(e(DX, DY, RX, RY, PN.Back, 0, 30, undefined, -32 + bob));
  P.push(e(0, -32 + bob, 72, 10, PN.Belly, 6, 8, -32 + bob));
  // Flanc clair sous le rebord de l'armure.
  P.push(e(4, -36 + bob, 74, 9, PN.Skin, 4, 9, undefined, -32 + bob));

  // Bandes transversales : sillons sombres entre les anneaux de plaques.
  for (let j = 0; j < 6; j++) {
    const x = -60 + j * 24, top = DY - RY * Math.sqrt(Math.max(0, 1 - (x / RX) ** 2));
    P.push(c(x, top + 5, x + 3, -35 + bob, 2, 2, PN.Band, 18, 2));
  }
  // Ostéodermes : deux rangées de plaques carénées sur le dos.
  [{ s: 0.86, n: 9, r: 7 }, { s: 0.5, n: 6, r: 8 }].forEach((row, ri) => {
    for (let j = 0; j < row.n; j++) {
      const a = Math.PI * (0.08 + 0.84 * (j + ri * 0.5) / row.n);
      const px = DX - Math.cos(a) * RX * row.s, py = DY - Math.sin(a) * RY * row.s;
      P.push(e(px, py, row.r, row.r * 0.6, PN.Plate, 30 * Math.sqrt(1 - row.s * row.s) + 2, 6));
    }
  });
  // Pointes dorsales courtes le long du profil.
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.1 + 0.8 * j / 8);
    const bx = DX - Math.cos(a) * RX * 0.96, by = DY - Math.sin(a) * RY * 0.96;
    const nx = -Math.cos(a) / RX, ny = -Math.sin(a) / RY, nl = Math.hypot(nx, ny);
    const len = 7 + (j % 2) * 4;
    P.push(c(bx, by, bx + (nx / nl) * len, by + (ny / nl) * len, 4, 1, PN.Spike, 8, 4));
  }
  // Pointes latérales : longues à l'épaule, plus courtes vers les hanches.
  for (let k = 0; k < 6; k++) {
    const x = 58 - k * 24, len = 22 - k * 2.5;
    P.push(c(x, -36 + bob, x - len * 0.75, -30 + bob + len * 0.2, 5, 1, PN.Spike, 30, 4));
  }

  // --- Longue queue raide, petite massue ---
  const seg = (104 / 7) * (1 - L.tailFold * 0.35);
  const tail: [number, number][] = [[-72, -50 + bob]];
  for (let k = 1; k <= 7; k++) {
    const t = k / 7;
    const b = -0.1 + L.tailUp * (t + 0.15);
    const [px, py] = tail[k - 1];
    tail.push([px - Math.cos(b) * seg, py - Math.sin(b) * seg - L.bob / 7 + L.sway * (t * t - ((k - 1) / 7) ** 2)]);
  }
  const tz = L.tailFold * 30;
  for (let k = 0; k < 7; k++) {
    const [ax, ay] = tail[k], [bx, by] = tail[k + 1];
    const ra = 17 - k * 1.5, rb = 17 - (k + 1) * 1.5;
    P.push(c(ax, ay, bx, by, ra, rb, PN.Skin, 4 + tz * k / 7, 10));
    if (k < 4) P.push(c(bx, by, bx - 5, by + rb + 4, 3, 1, PN.Spike, 14 + tz * k / 7, 3));
  }
  const [tx, ty] = tail[7];
  const cs = 1 + L.tailFold * 0.3, cb = L.tailUp > 0.4 ? -4 : 0;
  P.push(e(tx - 8 * cs, ty + cb, 12 * cs, 9 * cs, PN.Club, 8 + tz, 10));
  P.push(e(tx - 10 * cs, ty + cb - 6 * cs, 7 * cs, 5 * cs, PN.Club, 12 + tz, 6));
  P.push(e(tx - 10 * cs, ty + cb + 6 * cs, 7 * cs, 5 * cs, PN.Club, 12 + tz, 6));

  // --- Cou, tête à museau étroit (pivot à la base du cou) ---
  const H: Prim[] = [];
  H.push(e(94, -50, 20, 16, PN.Skin, 8, 16));
  H.push(e(90, -63, 13, 5, PN.Plate, 22, 4));
  // Museau long et étroit, plus fin que celui de l'ankylosaure.
  H.push(c(100, -52, 132, -44, 12, 7, PN.Skin, 10, 9));
  // Narines multiples : plusieurs trous sombres autour du nez.
  H.push(e(124, -49, 4, 4, PN.Nare, 30, 1));
  H.push(e(114, -52, 3, 3, PN.Nare, 30, 1));
  const jaw = L.mouth * 0.3;
  if (L.mouth > 0.05) H.push(e(122, -38 + L.mouth * 2, 10, 2 + L.mouth * 3, M.Mouth, 22, 1));
  H.push(...rot([c(98, -40, 128, -37, 6, 3.5, PN.Skin, 16, 5)], 96, -42, jaw));
  H.push(c(130, -46, 139, -41, 4.5, 1.5, PN.Beak, 18, 3));
  // Cornes de la joue et de l'arrière du crâne.
  H.push(c(82, -60, 70, -70, 4, 1, PN.Spike, 22, 3));
  H.push(c(86, -40, 76, -30, 3.5, 1, PN.Spike, 22, 3));
  if (L.eye) H.push(e(98, -56, 4, 4, M.Eye, 40, 1));
  // Demi-anneaux du cou : deux bandes de plaques.
  P.push(e(72, -50 + bob, 18, 16, PN.Skin, 6, 16));
  P.push(e(72, -63 + bob, 11, 5, PN.Plate, 18, 4));
  P.push(...rot(H, 70, -50, L.headA, 0, bob + L.headDy));
  return P;
}

/** Squelette : chaque primitive porte l'id de son os (matière M.Bone, M.Socket pour les orbites). */
export function pinacosaurusSkeleton(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  void pose;

  // Colonne basse et peu arquée, avec ses côtes.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    spine.push([70 - t * 142, -50 - Math.sin(t * Math.PI) * 16]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 5, 4, B, 10, 4));
  for (let k = 3; k <= 9; k++) {
    const [x, y] = spine[k];
    tag("vertebres", c(x, y + 3, x + 3, y + 16, 1, 1, B, 8, 2, true), c(x + 3, y + 16, x + 1, -34, 1, 1, B, 8, 2, true));
  }
  // Demi-anneaux du cou : arcs d'os soudés posés sur la nuque.
  tag("anneaux", c(60, -64, 74, -64, 4, 4, B, 14, 4), c(74, -64, 84, -58, 4, 3, B, 14, 4));
  // Ostéodermes : plaques isolées dans la peau du dos.
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.1 + 0.8 * j / 8);
    tag("osteodermes", e(-Math.cos(a) * 72, -54 - Math.sin(a) * 32, 6, 4, B, 14, 4));
  }
  tag("bassin", e(-38, -56, 17, 10, B, 12, 8), c(-52, -54, -24, -48, 3, 3, B, 12, 3));
  for (const [hx, z] of [[-42, 4], [-34, 16]] as const) {
    tag("patte-ar", c(hx, -50, hx + 3, -22, 5, 4, B, z, 4), c(hx + 3, -22, hx + 1, -5, 4, 3, B, z, 3), e(hx + 7, -3, 8, 3, B, z, 2));
  }
  tag("patte-av", c(36, -66, 44, -44, 3, 3, B, 12, 3));
  for (const [hx, z] of [[38, 4], [46, 16]] as const) {
    tag("patte-av", c(hx, -44, hx + 3, -20, 4.5, 3.5, B, z, 4), c(hx + 3, -20, hx + 4, -5, 3.5, 3, B, z, 3), e(hx + 9, -3, 7, 3, B, z, 2));
  }
  // Queue : vertèbres raidies par des tendons ossifiés.
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    tag("queue", e(-76 - t * 98, -50 + t * 14, 5 - t * 2, 4 - t * 1.5, B, 10, 3));
  }
  tag("queue", c(-120, -44, -176, -37, 1, 1, B, 9, 2, true));
  tag("massue", e(-184, -36, 12, 9, B, 12, 10), e(-186, -44, 7, 5, B, 14, 6), e(-186, -28, 7, 5, B, 14, 6));
  // Crâne : museau étroit percé de plusieurs narines, cornes, orbite.
  tag("crane",
    e(94, -52, 18, 13, B, 12, 12), c(100, -52, 132, -45, 9, 5, B, 12, 7), c(98, -40, 128, -38, 4, 2.5, B, 12, 3),
    c(82, -60, 70, -70, 4, 1, B, 16, 3), c(86, -40, 76, -30, 3.5, 1, B, 16, 3),
    e(98, -56, 4, 4, M.Socket, 30, 1), e(124, -49, 4, 4, M.Socket, 30, 1), e(114, -52, 3, 3, M.Socket, 30, 1));
  return P.map((p) => scalePrim(p, PINACOSAURUS_SCALE));
}

export const PINACOSAURUS: Species = {
  id: "pinacosaurus",
  name: "Pinacosaure",
  latin: "Pinacosaurus grangeri",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Djadochta, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 1900,
  facts: [
    { id: "cousin", title: "Le petit cousin de l'ankylosaure", unlock: "discover",
      text: "Le pinacosaure est un cousin de l'ankylosaure, plus ancien d'environ 8 millions d'années et bien plus léger : 5 mètres de long et à peine 2 tonnes, trois fois moins lourd." },
    { id: "squelettes", title: "Du bébé à l'adulte", unlock: "assemble",
      text: "C'est l'un des ankylosaures les mieux connus : on a trouvé en Mongolie et en Chine des dizaines de squelettes, des tout jeunes jusqu'aux adultes. On peut voir comment son armure se formait en grandissant." },
    { id: "creche", title: "Une bande de jeunes", unlock: "baby",
      text: "Sur un site du désert de Gobi, des dizaines de jeunes pinacosaures ont été retrouvés ensemble, sans adulte. Ils vivaient peut-être en bandes de jeunes, et seraient morts ensemble, peut-être pendant une tempête de sable ou en se noyant. Ce sont des hypothèses." },
    { id: "narines", title: "Un nez plein de trous", unlock: "eat",
      text: "Autour de ses narines, son crâne est percé de plusieurs trous en plus. À quoi servaient-ils ? Pour mieux sentir, ou pour rafraîchir l'air respiré ? Les savants n'en sont pas sûrs." },
    { id: "massue", title: "Une massue qui grandit", unlock: "defend",
      text: "Les jeunes n'avaient presque pas de massue au bout de la queue : elle grossissait avec l'âge. Seuls les adultes pouvaient donner de vrais coups de massue." },
    { id: "troupeau", title: "En groupe dans le désert", unlock: "herd",
      text: "Trouver autant de squelettes ensemble laisse penser que les pinacosaures, au moins les jeunes, vivaient en groupe. À plusieurs, on repère plus vite un prédateur." },
  ],
  bones: [
    { id: "crane", name: "Crâne aux narines multiples" },
    { id: "anneaux", name: "Demi-anneaux du cou" },
    { id: "vertebres", name: "Colonne et côtes" },
    { id: "osteodermes", name: "Ostéodermes" },
    { id: "bassin", name: "Bassin" },
    { id: "patte-av", name: "Pattes avant" },
    { id: "patte-ar", name: "Pattes arrière" },
    { id: "queue", name: "Queue raidie" },
    { id: "massue", name: "Massue" },
  ],
  model: pinacosaurusModel,
  skeleton: pinacosaurusSkeleton,
  center: { x: 0, y: -50 * PINACOSAURUS_SCALE },
  eye: { x: 98 * PINACOSAURUS_SCALE, y: -56 * PINACOSAURUS_SCALE },
  feet: [-42, -34, 38, 46].map((x) => x * PINACOSAURUS_SCALE),
  halfLen: 130 * PINACOSAURUS_SCALE,
  shadow: 0.9,
  walkSpeed: 30,
  runSpeed: 54,
  stride: 7,
  behavior: { diet: "herbivore", herd: [3, 6], browse: "low", prey: [], defense: "club", sight: 280, scavenger: false },
  biomes: [BIOME.Desert],
};
