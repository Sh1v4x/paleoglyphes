import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { CM } from "./carnivores.mat";
import { AM } from "./allosaurus.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Allosaurus (Allosaurus fragilis), grand théropode du Jurassique supérieur, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Plus svelte que le tyrannosaure :
 * crâne étroit et long, petites cornes au-dessus des yeux, dents en lame, bras assez longs à trois
 * doigts griffus. Il frappait la proie de sa mâchoire supérieure, comme une hachette.
 * Le modèle brut mesure ~350 px de la queue au museau.
 */
const LENGTH_M = 9;
export const ALLOSAURUS_SCALE = (LENGTH_M * PX_PER_M) / 350;

function allosaurusRig({ action, actionT: t, time }: Pose): TheroRig {
  const r = { ...REST_RIG };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.08, neck: 0.22, head: -0.1, stride: 1.3, tailUp: 5 });
      break;
    case "eat": {
      // Déchire la viande : tête plantée, puis arrachée vers l'arrière en tournant, pieds campés.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.5 - tug * 0.1, neck: 0.42 - tug * 0.3, head: 0.25 + Math.sin(t * Math.PI * 6) * 0.06, jaw: 0.15 + tug * 0.45, dy: 26, stance: 14, arms: 0.4 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.44, neck: 0.36 + s * 0.04, head: 0.12, jaw: 0.06, dy: 20, stance: 10 });
      break;
    case "rest": {
      const br = Math.sin(time * 1.7) * 0.03;
      Object.assign(r, { dy: 62, pitch: 0.04, neck: 0.38 + br, head: 0.1, curl: 0.25, legs: "sit", closed: true });
      break;
    }
    case "attack": {
      // Coup de hachette : 0-0.35 tête levée, gueule grande ouverte ; 0.35-0.55 la mâchoire
      // supérieure s'abat vers le bas sur la proie ; 0.55-1 tire en arrière pour trancher.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.48));
      const chop = win(t, 0.35, 0.52) * (1 - win(t, 0.75, 1) * 0.6);
      const pull = win(t, 0.55, 0.8);
      Object.assign(r, {
        dx: chop * 22 - pull * 10, dy: chop * 10,
        pitch: -0.12 * wind + 0.26 * chop,
        neck: -0.4 * wind + 0.55 * chop - 0.15 * pull,
        head: -0.15 * wind + 0.35 * chop,
        jaw: Math.max(wind, chop * (1 - pull * 0.7)),
        arms: Math.max(wind, chop) * 0.8,
        tailUp: 12 * chop, stance: 20 * chop,
      });
      break;
    }
    case "defend":
      // Face à face : cornes en avant, gueule ouverte, bras griffus levés.
      Object.assign(r, { pitch: 0.06, neck: 0.1, head: 0.04, jaw: 0.6 + 0.3 * s, arms: 1, tailUp: 14, stance: 18, dy: 6 });
      break;
    case "call":
      // Rugissement, tête levée, gueule très grande ouverte.
      Object.assign(r, { pitch: -0.16, neck: -0.55 - 0.05 * s, head: -0.4, jaw: 0.8 + 0.2 * Math.abs(s), arms: 0.3, tailUp: 6 });
      break;
    case "dead":
      Object.assign(r, { dy: 70, pitch: 0.03, neck: 0.48, head: 0.2, jaw: 0.3, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

const HIP = { x: 0, y: -104 };
const NECK = { x: 58, y: -116 };
const NAPE = { x: 90, y: -144 };
export const ALLO_EYE = { x: 112, y: -152 };

export function allosaurusModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = allosaurusRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 2) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 4 * moving * r.stride + breath * 1.3;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Pattes longues et puissantes (cinématique inverse) ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 15 * r.stride;
    const m = L.far ? AM.Far : AM.Skin;
    const z = L.far ? -60 : 40;
    const hx = HIP.x + (L.far ? 7 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 10 + sw * 40 + (L.far ? -r.stance : r.stance), fy = -5 - lift;
    let mx = 15, my = 28 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 32 + (L.far ? 10 : 0); fy = -5; mx = 34; my = 5; }
    else if (r.legs === "lie") { fx = hx + 86 + (L.far ? -12 : 0); fy = -7 - (L.far ? 0 : 6); mx = 28; my = 4; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 6, ax, ay, 44, 44);
    // Cuisse, jambe, métatarse, trois orteils à griffes.
    P.push(e(hx + 2, hy + 2, 23, 34, m, z - 6, 18));
    P.push(c(hx, hy + 8, kx, ky, 19, 11, m, z, 15));
    P.push(c(kx, ky, ax, ay, 10, 7, m, z + 4, 8));
    P.push(c(ax, ay, fx, fy, 7, 5.5, m, z + 6, 6));
    P.push(e(fx + 5, fy + 1, 12, 5, m, z + 6, 5));
    for (const [tx, ty] of [[20, 2], [14, 4]] as const) {
      P.push(c(fx + tx - 4, fy + ty - 1, fx + tx + 4, fy + ty + 1, 1, 1, AM.Claw, z + 14, 2, true));
    }
    if (!L.far) for (let k = 0; k < 3; k++) P.push(e(lerp(hx, kx, 0.3 + k * 0.2) - 5, lerp(hy + 8, ky, 0.3 + k * 0.2), 3.5, 2.5, AM.Scale, z + 16, 4));
  }

  // --- Corps, queue, cou, tête, bras : au repos, puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Longue queue en balancier (compense le tangage, reste au-dessus du sol), rayée en travers.
  const sway = Math.sin(time * 1.2) * 3 * (1 - moving) + Math.sin(walk) * 7 * moving;
  const tail: [number, number][] = [[-38, -110]];
  let ang = Math.PI + 0.08 + r.tailUp * 0.008 - r.pitch * 0.85;
  for (let k = 1; k <= 9; k++) {
    ang -= r.curl * 0.28 + sway * 0.003 * k - r.tailUp * 0.0015;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 20, Math.min(py + Math.sin(ang) * 20, -Math.max(3, 27 - k * 3) - by - 2)]);
  }
  for (let k = 0; k < 9; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(3, 27 - k * 3), rb = Math.max(3, 27 - (k + 1) * 3);
    B.push(c(ax, ay, qx, qy, ra, rb, AM.Skin, 2, ra * 0.8));
    if (k < 8) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.4, Math.max(2.5, ra * 0.22), ra * 0.6, AM.Back, 2 + ra * 0.6, 4));
    if (k < 4 && k % 2 === 0) B.push(e((ax + qx) / 2 + 6, (ay + qy) / 2 + ra * 0.35, 3, 2.2, AM.Scale, 2 + ra * 0.8, 3));
  }

  // Corps : plus étroit que celui du tyrannosaure ; ventre pâle, bandes sombres en travers du dos.
  B.push(e(14, -110, 62, 34, AM.Skin, 0, 34));
  B.push(e(26, -94, 50, 13, AM.Belly, 10, 16, -96));
  B.push(c(-40, -138, 60, -138, 5, 4, AM.Back, 30, 4));
  for (let k = 0; k < 6; k++) {
    const x = -34 + k * 16;
    B.push(e(x, -130 + Math.abs(x - 14) * 0.04, 4.5, 14, AM.Back, 24, 6));
  }
  // Écailles en bosses éparses.
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 5 - j; i++) {
      const x = -26 + i * 22 + (j % 2) * 11 + j * 6, y = -114 + j * 13;
      const ex2 = (x - 14) / 62, ey2 = (y + 110) / 34;
      const surf = 34 * Math.sqrt(Math.max(0, 1 - ex2 * ex2 - ey2 * ey2));
      B.push(e(x, y, 3.5, 2.5, AM.Scale, surf + 1, 3));
    }
  }

  // Bras assez longs, trois doigts aux grandes griffes recourbées (le pouce surtout).
  for (const far of [true, false]) {
    const m = far ? AM.Far : AM.Skin;
    const z = far ? -30 : 46;
    const a = r.arms;
    const sx = 58 + (far ? -6 : 0), sy = -100;
    const swing = Math.sin(walk + (far ? 0 : 1)) * 2.5 * moving;
    const ex = sx + lerp(6, 16, a), ey = sy + lerp(20, 12, a);
    const wx = ex + lerp(16, 20, a), wy = ey + lerp(-2, -10, a) + swing;
    B.push(c(sx, sy, ex, ey, 7, 5, m, z, 6));
    B.push(c(ex, ey, wx, wy, 5, 3.5, m, z, 4));
    for (let k = 0; k < 3; k++) {
      const cx2 = wx + 3, cy2 = wy - 2 + k * 2.5;
      B.push(c(wx, wy - 1 + k * 2, cx2 + 4, cy2 + 1, 1, 1, m, z + 4, 1, true));
      B.push(c(cx2 + 4, cy2 + 1, cx2 + 6, cy2 + 6, 1, 1, AM.Claw, z + 6, 1, true));
    }
  }

  // Cou en S et tête.
  const hb = Math.sin(walk * 2) * 2 * moving;
  const H: Prim[] = [];
  const hx = 110, hy = -144 + hb;
  // Crâne long et étroit : boîte crânienne, museau, arête du nez.
  H.push(e(hx - 4, hy, 22, 15, AM.Skin, 8, 14));
  H.push(e(hx + 22, hy + 3, 28, 10, AM.Skin, 8, 11));
  H.push(e(hx - 10, hy + 9, 12, 8, AM.Belly, 12, 8));
  H.push(c(hx + 12, hy - 8, hx + 46, hy - 3, 2.5, 2, AM.Back, 20, 3));
  // Cornes lacrymales devant et au-dessus de l'œil, et petite bosse derrière (postorbitaire).
  H.push(c(hx + 2, hy - 12, hx + 8, hy - 18, 4, 2, AM.Horn, 24, 4));
  H.push(c(hx + 8, hy - 18, hx + 12, hy - 12, 2, 1, AM.Horn, 24, 3));
  H.push(e(hx - 6, hy - 12, 4, 3, AM.Horn, 22, 3));
  if (r.closed) H.push(c(ALLO_EYE.x - 3, ALLO_EYE.y + hb, ALLO_EYE.x + 3, ALLO_EYE.y + hb, 1, 1, CM.Lid, 40, 1, true));
  else H.push(e(ALLO_EYE.x, ALLO_EYE.y + hb, 3.5, 3, M.Eye, 40, 1));
  H.push(e(hx + 46, hy - 1, 2.2, 1.6, M.Socket, 26, 1));
  // Gueule (s'ouvre très grand) : intérieur sombre, rangée de dents en lame.
  if (r.jaw > 0.1) H.push(e(hx + 10, hy + 13, 32, 11, AM.Mouth, 20, 4, hy + 10));
  for (let x = hx; x <= hx + 46; x += 5) H.push(e(x, hy + 12, 1.8, 2.8, AM.Tooth, 30, 2));
  const J: Prim[] = [c(hx - 16, hy + 10, hx + 46, hy + 14, 7.5, 4, AM.Skin, 10, 7)];
  J.push(c(hx - 12, hy + 16, hx + 40, hy + 17, 3, 2, AM.Belly, 18, 3));
  if (r.jaw > 0.1) {
    J.push(e(hx + 8, hy + 8, 18, 3, CM.RexTongue, 24, 3));
    for (let x = hx + 4; x <= hx + 42; x += 6) J.push(e(x, hy + 6, 1.8, 2.2, CM.ToothUp, 26, 2));
  } else J.push(c(hx - 8, hy + 9, hx + 48, hy + 11, 1, 1, M.Mouth, 18, 1, true));
  H.push(...rot(J, hx - 12, hy + 8, r.jaw * 0.75));
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 22, 14, AM.Skin, 6, 18),
    c(NECK.x + 8, NECK.y + 8, NAPE.x + 8, NAPE.y + 10 + hb, 10, 6, AM.Belly, 12, 8),
    e(NECK.x + 14, NECK.y - 18, 3.5, 8, AM.Back, 26, 4),
    e(NECK.x + 2, NECK.y - 22, 3.5, 8, AM.Back, 26, 4),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, ALLOSAURUS_SCALE));
}

/** Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite. */
export function allosaurusSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : long et léger, percé de grandes fenêtres ; cornes au-dessus de l'orbite.
  tag("crane",
    e(106, -140, 22, 14, B, 14, 10), e(132, -136, 26, 9, B, 14, 8),
    c(96, -152, 158, -138, 2.5, 2, B, 16, 3), c(110, -150, 116, -158, 3, 1.5, B, 18, 3),
    e(110, -146, 4, 5, M.Socket, 30, 1), e(130, -138, 9, 4, M.Socket, 30, 1), e(94, -140, 4, 5, M.Socket, 30, 1),
    ...[108, 113, 118, 123, 128, 133, 138, 143, 148, 153].map((x) => e(x, -126, 1.6, 2.8, M.Tooth, 20, 2)));
  // Mâchoire inférieure : longue et fine.
  tag("machoire", c(92, -124, 156, -120, 6, 3.5, B, 12, 5), e(102, -122, 5, 2.5, M.Socket, 30, 1),
    ...[116, 122, 128, 134, 140, 146].map((x) => e(x, -128, 1.6, 2, CM.ToothUp, 20, 2)));
  // Colonne : cou en S puis dos jusqu'au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    spine.push(t < 0.3 ? [90 - t * 100, -140 + t * 70] : [60 - (t - 0.3) * 100, -119 + (t - 0.3) * 12]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 4.5, 3.5, B, 10, 4), c(x, y - 3, x - 2, y - 11, 1, 1, B, 12, 1, true));
  // Côtes et gastralia.
  for (let k = 5; k <= 13; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 3, x + 5, y + 24, 1, 1, B, 8, 2, true), c(x + 5, y + 24, x + 2, -80, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion, pubis à « botte », ischion.
  tag("bassin", e(-2, -114, 30, 10, B, 12, 8), c(6, -106, 20, -70, 3.5, 2.5, B, 12, 4), e(22, -68, 9, 3.5, B, 12, 4), c(-8, -106, -24, -80, 3.5, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, trois doigts aux grandes griffes.
  tag("bras", c(62, -112, 42, -122, 3, 2, B, 14, 3), c(58, -100, 66, -82, 3, 2.5, B, 16, 3), c(66, -82, 82, -86, 2.5, 2, B, 16, 2),
    ...[0, 3, 6].map((k) => c(82, -88 + k, 89, -84 + k, 1, 1, B, 18, 1, true)),
    ...[0, 3, 6].map((k) => c(89, -84 + k, 90, -78 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, métatarse, orteils.
  for (const [hx, z] of [[7, 4], [0, 18]] as const) {
    tag("pattes", c(hx, -104, hx + 22, -66, 5.5, 4.5, B, z, 5), c(hx + 22, -66, hx - 4, -32, 4.5, 3.5, B, z, 4),
      c(hx - 4, -32, hx + 12, -5, 3.5, 2.8, B, z, 3), c(hx + 10, -4, hx + 32, -3, 2.2, 1.4, B, z, 2));
  }
  // Queue : vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 15; k++) {
    const t = k / 15;
    tag("queue", e(-40 - t * 176, -112 + t * 6, 4.5 - t * 2.5, 3.5 - t * 1.8, B, 10, 3), c(-40 - t * 176, -115 + t * 6, -42 - t * 176, -122 + t * 9, 1, 1, B, 12, 1, true));
  }
  return P.map((p) => scalePrim(p, ALLOSAURUS_SCALE));
}

export const ALLOSAURUS: Species = {
  id: "allosaurus",
  name: "Allosaurus",
  latin: "Allosaurus fragilis",
  period: "Jurassique supérieur, 155-145 Ma",
  place: "Formation de Morrison, Colorado, Utah et Wyoming (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 2000,
  facts: [
    { id: "temps", title: "Un voyageur du Jurassique", unlock: "discover",
      text: "L'Allosaurus n'a jamais croisé le T. rex : il vivait il y a environ 150 millions d'années, au Jurassique. Environ 85 millions d'années les séparent... alors que 66 millions d'années seulement nous séparent du T. rex. Allosaurus est plus éloigné du T. rex dans le temps que nous ne le sommes du T. rex !" },
    { id: "bigal", title: "Big Al, le blessé", unlock: "assemble",
      text: "« Big Al », un jeune Allosaurus trouvé au Wyoming en 1991, porte une vingtaine de blessures : côtes cassées, griffes abîmées, orteil infecté... Ces infections l'ont sans doute empêché de chasser, et il est peut-être mort de faim." },
    { id: "hachette", title: "Une tête en hachette", unlock: "attack",
      text: "Sa morsure était bien moins forte que celle du T. rex. Mais il ouvrait la gueule très grand et abattait sa mâchoire supérieure sur la proie comme une hachette : ses dents en lame, dentelées comme des couteaux à steak, tranchaient la chair." },
    { id: "mains", title: "Trois doigts griffus", unlock: "eat",
      text: "Contrairement au T. rex et à ses deux petits doigts, l'Allosaurus avait des bras assez longs avec trois doigts aux grandes griffes recourbées. Celle du pouce était la plus grosse : de quoi agripper une proie." },
    { id: "cornes", title: "Des cornes pour parader", unlock: "call",
      text: "Au-dessus de ses yeux, il portait deux petites cornes osseuses. Trop fragiles pour se battre, elles servaient sans doute à se montrer : reconnaître ses congénères, impressionner un rival ou séduire un partenaire." },
    { id: "stego", title: "Une piqûre de stégosaure", unlock: "hunt",
      text: "Il chassait les grands herbivores du Jurassique, comme le Stégosaure. Mais c'était risqué : on a trouvé une vertèbre de queue d'Allosaurus percée d'un trou de la forme exacte d'une pointe de queue de Stégosaure !" },
    { id: "portugal", title: "Des embryons au Portugal", unlock: "nest",
      text: "L'Allosaurus vivait aussi en Europe. Au Portugal, on a découvert un nid de plus de 100 œufs d'un proche cousin, sans doute le Lourinhanosaurus, avec des embryons encore à l'intérieur : de minuscules os de bébés théropodes." },
    { id: "jeunes", title: "Des jeunes coureurs", unlock: "baby",
      text: "Les jeunes Allosaurus avaient des pattes plus longues par rapport à leur corps que les adultes : ils couraient plus vite et chassaient sans doute des proies plus petites, sans entrer en concurrence avec les grands." },
  ],
  bones: [
    { id: "crane", name: "Crâne à cornes" },
    { id: "machoire", name: "Mâchoire inférieure" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "bras", name: "Bras à trois doigts" },
    { id: "bassin", name: "Bassin" },
    { id: "pattes", name: "Pattes" },
    { id: "queue", name: "Queue" },
  ],
  model: allosaurusModel,
  skeleton: allosaurusSkeleton,
  center: { x: 15 * ALLOSAURUS_SCALE, y: -110 * ALLOSAURUS_SCALE },
  eye: { x: ALLO_EYE.x * ALLOSAURUS_SCALE, y: ALLO_EYE.y * ALLOSAURUS_SCALE },
  feet: [10, 17].map((x) => x * ALLOSAURUS_SCALE),
  halfLen: 170 * ALLOSAURUS_SCALE,
  shadow: 0.6,
  walkSpeed: 46,
  runSpeed: 130,
  stride: 6,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: ["edmonto", "trike", "pachy", "ankylo"], defense: "bite", sight: 480, scavenger: true },
};
