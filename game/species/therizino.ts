import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { THM } from "./therizino.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Therizinosaure (Therizinosaurus cheloniformis), théropode herbivore du Nemegt, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Silhouette dressée : gros ventre
 * entre les pattes, long cou, toute petite tête à bec, queue courte, larges pieds à quatre doigts,
 * et d'immenses griffes en faux qui pendent des bras.
 * Le modèle brut mesure ~240 px le long du corps (queue, dos, cou, tête) : la posture dressée le rend
 * plus haut et moins long à l'écran qu'un théropode horizontal.
 */
const LENGTH_M = 9.5;
export const THERIZINO_SCALE = (LENGTH_M * PX_PER_M) / 240;

/** Bras : angle de l'épaule et pli du coude (rad ; 0 = pendant, + = vers l'avant, PI = levé). */
type Arm = readonly [number, number];

/** Gréement du théropode, plus : les deux bras, une branche tirée (0..1, -1 = aucune), plumage gonflé. */
interface ThRig extends TheroRig {
  near: Arm;
  far: Arm;
  twig: number;
  fluff: number;
}

function therizinoRig({ action, actionT: t, time, walk, moving }: Pose): ThRig {
  // Au pas, les bras se balancent lourdement, griffes pendantes.
  const swing = Math.sin(walk) * 0.18 * moving;
  const r: ThRig = { ...REST_RIG, near: [0.3 - swing, 0.5], far: [0.22 + swing, 0.45], twig: -1, fluff: 0 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      // Course pataude : corps penché, cou tendu, bras ballants.
      Object.assign(r, { pitch: 0.14, neck: 0.35, head: -0.25, stride: 1.25, tailUp: 4, near: [0.6 - swing * 2, 0.9], far: [0.5 + swing * 2, 0.9] });
      break;
    case "eat": {
      // Se dresse, cou tendu vers la cime, griffes accrochées à une branche qu'il tire vers son bec.
      const pull = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 2);
      const nib = Math.abs(Math.sin(t * Math.PI * 6));
      Object.assign(r, {
        dy: -4, pitch: -0.22, neck: -0.25 + pull * 0.15, head: -0.35 + nib * 0.15, jaw: 0.1 + nib * 0.4, stance: 8, tailUp: -6,
        near: [2.5 - pull * 0.45, 0.25], far: [2.3 - pull * 0.4, 0.35], twig: pull,
      });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.6, neck: 1.42 + s * 0.04, head: 0.5, jaw: 0.05, dy: 16, stance: 10, near: [0.5, 0.6], far: [0.4, 0.6] });
      break;
    case "rest": {
      // Assis sur son gros ventre, pattes repliées, griffes rangées devant lui, cou dressé et tête qui somnole.
      const br = Math.sin(time * 1.8) * 0.03;
      Object.assign(r, { dy: 38, pitch: 0.06, neck: 0.15 + br, head: 0.35, legs: "sit", closed: true, near: [0.9, 1.3], far: [0.8, 1.3], fluff: 0.3 });
      break;
    }
    case "attack": {
      // Coup de faux : bras levés haut en arrière, puis grand balayage des griffes vers l'avant et le bas.
      const wind = win(t, 0, 0.35) * (1 - win(t, 0.4, 0.55));
      const hit = win(t, 0.4, 0.55) * (1 - win(t, 0.8, 1));
      const a = lerp(lerp(0.3, 2.8, wind), 1.1, hit);
      Object.assign(r, {
        dx: hit * 12, dy: wind * -3 + hit * 4,
        pitch: -0.15 * wind + 0.18 * hit,
        neck: -0.25 * wind + 0.1 * hit,
        jaw: 0.5 * Math.max(wind, hit),
        stance: 12 * Math.max(wind, hit),
        near: [a, lerp(lerp(0.5, 0.3, wind), -0.1, hit)],
        far: [a - 0.25, lerp(lerp(0.45, 0.4, wind), 0.1, hit)],
        fluff: 0.5 * Math.max(wind, hit),
      });
      break;
    }
    case "defend":
      // Bras écartés et levés, griffes géantes bien en vue, plumage gonflé : de quoi faire hésiter un Tarbosaure.
      Object.assign(r, {
        pitch: -0.2, neck: -0.25, head: 0.1, jaw: 0.4 + 0.3 * s, stance: 12, dy: -2, fluff: 1,
        near: [2.1 + 0.08 * s, -0.3], far: [2.6 - 0.08 * s, -0.1],
      });
      break;
    case "call":
      Object.assign(r, { pitch: -0.15, neck: -0.4, head: -0.6, jaw: 0.5 + 0.45 * Math.abs(s), fluff: 0.3 });
      break;
    case "dead":
      // Effondré sur le flanc, cou étendu au sol, griffes inertes.
      Object.assign(r, { dy: 30, pitch: 0.55, neck: 1.25, head: 0.2, jaw: 0.3, legs: "lie", closed: true, near: [2.0, 0.2], far: [1.8, 0.3] });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), épaule, base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -80 };
const SHOULDER = { x: 34, y: -110 };
const NECK = { x: 38, y: -122 };
const NAPE = { x: 70, y: -160 };
const EYE = { x: 79, y: -165 };

/** Direction d'un angle de bras (0 = vers le bas, PI/2 = vers l'avant). */
const dir = (a: number): [number, number] => [Math.sin(a), Math.cos(a)];

/** Trois griffes en faux depuis le poignet (wx, wy), dans l'axe de la main ; elles se recourbent vers l'arrière. */
function claws(P: Prim[], wx: number, wy: number, a: number, m: number, z: number, scale = 1) {
  for (const [da, len] of [[-0.14, 26], [0, 31], [0.14, 23]] as const) {
    const [ux, uy] = dir(a + da), [vx, vy] = dir(a + da - 0.45);
    const l = len * scale;
    const mx = wx + ux * l * 0.55, my = wy + uy * l * 0.55;
    P.push(c(wx, wy, mx, my, 3.6, 3, m, z, 3));
    P.push(c(mx, my, mx + vx * l * 0.45, my + vy * l * 0.45, 3, 1.2, m, z + 1, 2));
  }
}

export function therizinoModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = therizinoRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 1.4) * (1 - moving);
  // Pas lourd : le corps s'affaisse franchement à chaque appui.
  const bob = Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Pattes trapues (cinématique inverse), larges pieds à quatre doigts ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 8 * r.stride;
    const m = L.far ? THM.Far : THM.Skin;
    const z = L.far ? -40 : 24;
    const hx = HIP.x + (L.far ? 4 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 4 + sw * 12 + (L.far ? -10 - r.stance : 10 + r.stance) * 0.6, fy = -3 - lift;
    let mx = 4, my = 12 - lift * 0.2;
    if (r.legs === "sit") { fx = hx + 24 + (L.far ? 6 : 0); fy = -3; mx = 16; my = 3; }
    else if (r.legs === "lie") { fx = hx + 58 + (L.far ? -8 : 0); fy = -5 - (L.far ? 0 : 4); mx = 14; my = 3; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 4, ax, ay, 37, 36);
    // Grosse cuisse emplumée, jambe épaisse, métatarse court, pied large.
    P.push(e(hx, hy, 18, 22, m, z - 4, 14));
    P.push(c(hx, hy + 4, kx, ky, 13, 9, m, z, 10));
    P.push(c(kx, ky, ax, ay, 8, 6, m, z + 2, 7));
    P.push(c(ax, ay, fx, fy, 6, 4.5, L.far ? THM.Far : THM.Foot, z + 3, 5));
    // Quatre doigts courts et écartés, chacun terminé par une griffe émoussée.
    for (let k = 0; k < 4; k++) {
      const tx = fx - 8 + k * 6, tl = k === 0 ? 5 : 9;
      P.push(c(tx, fy, tx + tl, fy + 1.5, 2.6, 1.8, L.far ? THM.Far : THM.Foot, z + 4 + k, 3));
      if (k > 0) P.push(c(tx + tl, fy + 1, tx + tl + 2, fy + 2.5, 1, 1, THM.Claw, z + 9 + k, 1, true));
    }
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];
  const puff = r.fluff * 4;

  // Queue courte et épaisse, tenue basse.
  const sway = Math.sin(time * 1.1) * 2 * (1 - moving) + Math.sin(walk) * 4 * moving;
  const tail: [number, number][] = [[-20, -88]];
  let ang = Math.PI - 0.18 - r.tailUp * 0.012 - r.pitch * 0.6;
  for (let k = 1; k <= 4; k++) {
    ang -= sway * 0.006 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 14, py + Math.sin(ang) * 14]);
  }
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    B.push(c(ax, ay, qx, qy, 15 - k * 3, 12 - k * 3, THM.Skin, 2, 10));
  }
  const [tx, ty] = tail[4];
  for (let i = -1; i <= 1; i++) B.push(c(tx + 4, ty, tx - 10, ty + i * 4 + 2, 1, 1, THM.Feather, 16, 2, true));

  // Gros ventre rond qui pend entre les pattes, poitrine dressée, ventre pâle.
  B.push(e(12, -76, 36 + puff, 33 + puff, THM.Skin, 0, 22));
  B.push(e(30, -110, 20 + puff, 22 + puff, THM.Skin, 2, 20));
  B.push(e(22, -52 + puff * 0.6, 26, 10 + puff * 0.4, THM.Pale, 10, 8, -53));
  // Plumage hirsute du dos et du ventre, hérissé quand il gonfle ses plumes.
  for (let k = 0; k < 8; k++) {
    const a = -2.5 + k * 0.28;
    const x = 12 + Math.cos(a) * (36 + puff), y = -80 + Math.sin(a) * (34 + puff);
    B.push(c(x, y, x - 8 + r.fluff * 2, y - 2 - (k % 2) * 3 - r.fluff * 4, 1, 1, THM.Feather, 24, 2, true));
  }
  for (let k = 0; k < 5; k++) {
    const x = 0 + k * 8;
    B.push(c(x, -46 - k * 0.6, x - 3, -41 + (k % 2) * 2, 1, 1, THM.Feather, 24, 2, true));
  }

  // Long cou et toute petite tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.2 * moving;
  const H: Prim[] = [];
  const hx = 78, hy = -163 + hb;
  // Petit crâne bas, face pâle, œil.
  H.push(e(hx, hy, 9, 6.5, THM.Pale, 10, 10));
  if (r.closed) H.push(c(EYE.x - 2, EYE.y + hb, EYE.x + 2, EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 2.5, 3, THM.Eye, 30, 1));
  // Bec corné à l'avant ; derrière, des dents en forme de feuille pour hacher les végétaux.
  H.push(c(hx + 6, hy - 1, hx + 16, hy + 2, 4, 2, THM.Beak, 14, 5));
  if (r.jaw > 0.1) H.push(e(hx + 8, hy + 4, 6, 2.5, M.Mouth, 12, 3, hy + 3));
  const J: Prim[] = [c(hx + 1, hy + 4, hx + 13, hy + 4.5, 2.5, 1.5, THM.Pale, 13, 4), c(hx + 10, hy + 4.5, hx + 15, hy + 4, 1.6, 1, THM.Beak, 14, 3)];
  if (r.jaw <= 0.1) J.push(c(hx + 2, hy + 3, hx + 12, hy + 3, 1, 1, THM.Mark, 16, 1, true));
  H.push(...rot(J, hx + 2, hy + 3, r.jaw * 0.5));
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 12 + puff * 0.5, 6, THM.Pale, 6, 10),
    c(NECK.x - 4, NECK.y - 4, NAPE.x - 3, NAPE.y - 2 + hb, 7, 4, THM.Skin, 8, 8),
    ...[0, 1, 2, 3].map((k) => {
      const x = NECK.x - 6 + k * 8, y = NECK.y - 6 - k * 9.5;
      return c(x, y, x - 6, y - 2 - r.fluff * 3, 1, 1, THM.Feather, 22, 2, true);
    }),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras : épaule, coude, poignet, plumes hirsutes qui pendent, puis les griffes géantes.
  let twigAt: [number, number] | null = null;
  for (const far of [true, false]) {
    const m = far ? THM.Far : THM.Skin;
    const z = far ? -30 : 30;
    const [sa, ea] = far ? r.far : r.near;
    const sx = SHOULDER.x + (far ? -4 : 0), sy = SHOULDER.y + (far ? -2 : 0);
    const [ux, uy] = dir(sa), [vx, vy] = dir(sa + ea);
    const ex = sx + ux * 24, ey = sy + uy * 24;
    const wx = ex + vx * 22, wy = ey + vy * 22;
    B.push(c(sx, sy, ex, ey, 8, 6, m, z, 6));
    B.push(c(ex, ey, wx, wy, 6, 4.5, m, z + 1, 5));
    // Plumes de l'avant-bras : elles pendent toujours vers le sol, quelle que soit la pose.
    for (let k = 0; k <= 4; k++) {
      const u = k / 4, qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const len = 8 + r.fluff * 4 - u * 3;
      B.push(c(qx, qy + 3, qx - 2 - u * 2, qy + 3 + len, 1, 1, far ? THM.Far : THM.Shag, z + 2, 1, true));
    }
    claws(B, wx, wy, sa + ea, THM.Claw, z + 4, far ? 0.9 : 1);
    if (!far && r.twig >= 0) twigAt = [wx + vx * 16, wy + vy * 16];
  }

  // Branche feuillue accrochée par les griffes et tirée vers le bec.
  if (twigAt) {
    const [qx, qy] = twigAt;
    B.push(c(qx - 26, qy - 18, qx + 30, qy + 10, 1.6, 1, M.Wood, 40, 2));
    for (const [lx, ly] of [[-18, -18], [-6, -12], [8, -6], [20, 2], [28, 12], [14, 6]] as const) {
      B.push(e(qx + lx, qy + ly, 5, 3, M.Leaf, 42, 3));
    }
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, THERIZINO_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne et bec, long cou, dos et côtes, bassin, bras, griffes géantes, pattes, queue.
 */
export function therizinoSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : petit et bas, bec édenté à l'avant, rangée de dents en feuille derrière.
  tag("crane",
    e(78, -164, 9, 5.5, B, 12, 6),
    c(84, -164, 95, -161, 3, 1.5, B, 12, 3),
    c(72, -159, 92, -158, 2, 1.2, B, 12, 2),
    e(77, -166, 2.5, 2.5, M.Socket, 30, 1), e(86, -164, 2, 1.5, M.Socket, 30, 1),
    ...[0, 1, 2].map((k) => c(74 + k * 3, -159, 74 + k * 3, -157, 1, 1, B, 14, 1, true)));
  // Cou : long, vertèbres qui montent jusqu'au crâne.
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tag("cou", e(38 + t * 32 + Math.sin(t * Math.PI) * 3, -122 - t * 38, 3.6 - t * 0.8, 3 - t * 0.5, B, 10, 3));
  }
  // Dos dressé et côtes larges autour du gros ventre.
  for (let k = 0; k <= 6; k++) tag("vertebres", e(30 - k * 6, -118 + k * 5, 3.4, 3, B, 10, 3));
  for (let k = 1; k <= 6; k++) {
    const x = 30 - k * 6, y = -118 + k * 5;
    tag("vertebres", c(x, y, x + 14, y + 26 - k * 2, 1, 1, B, 8, 2, true));
  }
  tag("vertebres", c(12, -66, 34, -76, 1, 1, B, 8, 2, true));
  // Bassin : très large, pubis renversé vers l'arrière comme chez les oiseaux, pour loger un gros intestin.
  tag("bassin", e(-2, -86, 18, 7, B, 12, 6), c(-2, -82, -14, -64, 3, 2.2, B, 12, 3), c(6, -82, 2, -68, 2.6, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, main.
  tag("bras",
    c(38, -118, 24, -112, 2.4, 2, B, 12, 2),
    c(34, -110, 41, -87, 2.6, 2.2, B, 14, 2), c(41, -87, 57, -71, 2.2, 1.8, B, 14, 2),
    c(57, -71, 60, -66, 2, 1.6, B, 14, 2));
  // Griffes géantes : trois os unguéaux longs, aplatis, à peine courbés.
  const G: Prim[] = [];
  claws(G, 60, -66, 0.8, B, 18);
  tag("griffes", ...G);
  // Pattes : fémur, tibia, métatarse court, quatre doigts.
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -76, hx + 16, -46, 3.4, 2.8, B, z, 3), c(hx + 16, -46, hx, -16, 2.8, 2.2, B, z, 2),
      c(hx, -16, hx + 4, -4, 2.4, 2, B, z, 2),
      ...[0, 1, 2, 3].map((k) => c(hx - 4 + k * 6, -3, hx + 3 + k * 6, -2, 1.4, 1, B, z, 1)));
  }
  // Queue courte : vertèbres qui s'affinent.
  for (let k = 0; k <= 6; k++) tag("queue", e(-22 - k * 9, -86 + k * 1.6, 3.2 - k * 0.3, 2.6 - k * 0.2, B, 10, 2));
  return P.map((p) => scalePrim(p, THERIZINO_SCALE));
}

export const THERIZINO: Species = {
  id: "therizino",
  name: "Therizinosaure",
  latin: "Therizinosaurus cheloniformis",
  period: "Crétacé supérieur, 70 Ma",
  place: "Formation de Nemegt, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 5000,
  facts: [
    { id: "tortue", title: "Une tortue géante ?", unlock: "discover",
      text: "En 1948, en Mongolie, on a trouvé d'énormes griffes plates. Les savants ont d'abord cru qu'elles appartenaient à une tortue géante ! C'est pour cela que son nom d'espèce, « cheloniformis », veut dire « en forme de tortue »." },
    { id: "faucheur", title: "Le lézard faucheur", unlock: "assemble",
      text: "Therizinosaurus veut dire « lézard faucheur », à cause de ses griffes en forme de faux. L'os de la plus grande mesure à lui seul environ 50 cm ; avec sa gaine de corne, elle était encore plus longue. Ce sont les plus longues griffes de tous les animaux connus !" },
    { id: "vegetarien", title: "Des griffes pour cueillir", unlock: "eat",
      text: "Malgré ses griffes effrayantes, le Therizinosaure mangeait des plantes. Il avait un petit bec et des dents en forme de feuille. Avec ses griffes, il attrapait les branches et les tirait vers sa bouche, et son long cou l'aidait à atteindre les feuilles en hauteur." },
    { id: "tarbo", title: "Gare au Tarbosaure", unlock: "defend",
      text: "Dans le Nemegt vivait aussi le Tarbosaurus, un cousin asiatique du T. rex. Face à lui, le Therizinosaure pouvait se dresser et écarter ses bras armés : ses griffes géantes faisaient sans doute une bonne défense." },
    { id: "cousin", title: "Un cousin du T. rex végétarien", unlock: "attack",
      text: "Le Therizinosaure était un théropode, de la même grande famille que le T. rex et les vélociraptors. Mais ses ancêtres sont devenus herbivores : son gros ventre abritait un long intestin pour digérer les plantes, et il avait sûrement des plumes, comme ses cousins plus petits." },
    { id: "nemegt", title: "Des rivières dans le Gobi", unlock: "call",
      text: "Il y a 70 millions d'années, le Nemegt n'était pas un désert : c'était un pays de rivières et de forêts, plus humide que les dunes de Djadochta, plus anciennes de quelques millions d'années. Le Therizinosaure y vivait près de l'eau, à côté de troupeaux de hadrosaures." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "cou", name: "Long cou" },
    { id: "vertebres", name: "Dos et côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras" },
    { id: "griffes", name: "Griffes géantes" },
    { id: "pattes", name: "Pattes à quatre doigts" },
    { id: "queue", name: "Queue courte" },
  ],
  model: therizinoModel,
  skeleton: therizinoSkeleton,
  center: { x: 12 * THERIZINO_SCALE, y: -92 * THERIZINO_SCALE },
  eye: { x: EYE.x * THERIZINO_SCALE, y: EYE.y * THERIZINO_SCALE },
  feet: [4, 8].map((x) => x * THERIZINO_SCALE),
  halfLen: 90 * THERIZINO_SCALE,
  shadow: 0.55,
  walkSpeed: 32,
  runSpeed: 85,
  stride: 4,
  behavior: { diet: "herbivore", herd: [1, 2], browse: "high", prey: [], defense: "bite", sight: 320, scavenger: false },
  biomes: [BIOME.Desert],
};
