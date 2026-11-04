import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { TM } from "./troodon.mat";
import { lerp } from "../math";
import { c, e, REST_RIG, rot, theroLegs, win, type TheroLegSpec, type TheroRig } from "./kit";
import type { Pose, Species } from "./types";

/**
 * Troodontidé d'Alaska (Formation de Prince Creek), modélisé en primitives (px locaux, regard vers
 * la droite, origine au sol sous le bassin). Connu surtout par ses dents, plus grandes que celles
 * des troodontidés du sud : on le reconstruit comme un Troodon plus grand et plus massif. Épais
 * plumage d'hiver (collerette, culottes, longue queue frangée), grosse tête aux immenses yeux tournés
 * vers l'avant (nuit polaire), masque sombre, museau fin et denté, griffe en faucille relevée.
 * Le modèle brut mesure ~290 px de la queue au museau.
 */
const LENGTH_M = 3;
export const TROODON_SCALE = (LENGTH_M * PX_PER_M) / 290;

/** Gréement du raptor, plus : tête rentrée (sommeil d'oiseau) et plumage gonflé. */
interface PolarRig extends TheroRig {
  tuck: number;
  fluff: number;
}

function troodonRig({ action, actionT: t, time }: Pose): PolarRig {
  // Au repos il garde un peu de duvet gonflé : il fait froid.
  const r: PolarRig = { ...REST_RIG, tuck: 0, fluff: 0.3 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.14, neck: 0.45, head: -0.3, stride: 1.4, tailUp: 8, crest: -0.4, fluff: 0 });
      break;
    case "eat": {
      // Arrache la viande : tête plongée, puis tirée vers l'arrière par saccades, pied posé sur la proie.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.4 - tug * 0.06, neck: 0.95 - tug * 0.3, head: 0.55, jaw: 0.2 + tug * 0.5, dy: 6, stance: 10, tailUp: 14 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.36, neck: 1.0 + s * 0.08, head: 0.7, jaw: 0.05, dy: 8, tailUp: 12 });
      break;
    case "rest": {
      // Roulé en boule dans ses plumes : accroupi, cou replié, tête cachée sous l'aile, longue queue
      // ramenée autour du corps comme une écharpe, duvet gonflé au maximum contre le froid.
      const br = Math.sin(time * 2.2) * 0.03;
      Object.assign(r, { dy: 46, pitch: -0.02, neck: -2.2 + br, head: -0.9, curl: 1.5, legs: "sit", closed: true, tuck: 1, fluff: 1 + br * 4 });
      break;
    }
    case "attack": {
      // Affût puis détente : se tasse, plumage plaqué, puis jaillit cou tendu et happe, avant de
      // clouer la proie au sol d'un pied et de la mordre à coups secs.
      const crouch = win(t, 0, 0.3) * (1 - win(t, 0.32, 0.42));
      const lunge = win(t, 0.32, 0.45) * (1 - win(t, 0.62, 0.75));
      const pin = win(t, 0.62, 0.75);
      const snap = Math.max(0, Math.sin(t * 34));
      Object.assign(r, {
        dy: crouch * 18 - lunge * 6 + pin * 10,
        dx: lunge * 34 + pin * 30,
        pitch: 0.1 * crouch + 0.14 * lunge + 0.32 * pin,
        neck: 0.35 * crouch - 0.05 * lunge + 0.6 * pin + pin * snap * 0.2,
        head: 0.1 + 0.25 * pin,
        jaw: Math.max(0.3 * crouch, lunge, pin * snap),
        arms: 0.5 * lunge + 0.7 * pin,
        crest: crouch > 0.3 ? -0.5 : 0.6,
        tailUp: 6 * crouch + 14 * pin,
        stride: 1 + lunge,
        stance: 10 * lunge + 14 * pin,
        fluff: 0,
      });
      break;
    }
    case "defend":
      // Gonfle tout son plumage blanc, ouvre les ailes et la gueule : une grosse boule hérissée.
      Object.assign(r, { pitch: -0.16, neck: 0.05, head: 0.1, jaw: 0.75 + 0.25 * s, arms: 1, crest: 1, tailUp: 24, stance: 12, dy: 2, fluff: 1.3 });
      break;
    case "call":
      // Ululement dans la nuit : tête levée, gorge gonflée, gueule entrouverte.
      Object.assign(r, { pitch: -0.24, neck: -0.75, head: -0.55, jaw: 0.35 + 0.35 * Math.abs(s), arms: 0.2, crest: 0.7, tailUp: -2, fluff: 0.8 });
      break;
    case "dead":
      Object.assign(r, { dy: 54, pitch: 0.06, neck: 1.0, head: 0.1, jaw: 0.25, curl: 0.2, legs: "lie", closed: true, fluff: 0 });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -74 };
const LEGS: TheroLegSpec = {
  hip: HIP, farHip: 4, lift: 13, reach: 6, swing: 32, footY: -3,
  mx: 12, my: 27, metaLift: 0.3,
  sit: { dx: 18, far: 6, y: -3, mx: 28, my: 3 },
  lie: { dx: 68, far: -8, y: -5, nearDy: 4, mx: 22, my: 3 },
  kneeDy: 4, thigh: 28, shin: 34,
};
const NECK = { x: 32, y: -90 };
const NAPE = { x: 50, y: -114 };
const EYE = { x: 70, y: -122 };

export function troodonModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = troodonRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.9) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const puff = r.fluff * 4;
  const P: Prim[] = [];

  // --- Longues pattes : grosses culottes de plumes, métatarse écailleux, griffe en faucille ---
  for (const L of theroLegs(pose, r, bx, by, LEGS)) {
    const m = L.far ? TM.Far : TM.Skin;
    const z = L.far ? -40 : 22;
    const { hx, hy, fx, fy, ax, ay, kx, ky } = L;
    // Cuisse et « culotte » de duvet qui descend jusqu'au genou.
    P.push(e(hx, hy, 17 + puff * 0.5, 20 + puff * 0.5, m, z - 4, 12));
    P.push(c(hx, hy + 4, kx, ky, 12 + puff * 0.4, 7, L.far ? TM.Far : TM.Down, z, 9));
    P.push(c(kx, ky, ax, ay, 5, 3.2, m, z + 2, 5));
    P.push(c(ax, ay, fx, fy, 3.2, 2.4, L.far ? TM.Far : TM.Speck, z + 3, 4));
    // Orteils, et griffe en faucille du 2e orteil relevée au-dessus du sol.
    P.push(c(fx - 2, fy, fx + 13, fy + 1.5, 2.8, 1.7, m, z + 3, 3));
    P.push(c(fx + 1, fy - 2, fx + 4, fy - 9, 1, 1, TM.Claw, z + 8, 2, true));
    P.push(c(fx + 4, fy - 9, fx + 9, fy - 8, 1, 1, TM.Claw, z + 8, 2, true));
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Très longue queue emplumée (10 segments) : frange de duvet de chaque côté, bandes sombres.
  const sway = Math.sin(time * 1.4) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving;
  const tail: [number, number][] = [[-30, -82]];
  let ang = Math.PI + 0.05 + r.tailUp * 0.01 - r.pitch * 0.85;
  for (let k = 1; k <= 10; k++) {
    ang -= r.curl * 0.26 + sway * 0.003 * k - r.tailUp * 0.0016;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 16, Math.min(py + Math.sin(ang) * 16, -Math.max(2, 13 - k * 1.2) - by - 2)]);
  }
  for (let k = 0; k < 10; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(2.5, 14 - k * 1.2), rb = Math.max(2.5, 14 - (k + 1) * 1.2);
    B.push(c(ax, ay, qx, qy, ra, rb, TM.Skin, 2, 10));
    if (k % 3 === 2) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.4, 3, ra * 0.5, TM.Mask, 12, 3));
    // Frange de plumes de chaque côté, dès la base : la queue sert d'écharpe quand il dort.
    if (k >= 2) {
      const nx = -(qy - ay) / 16, ny = (qx - ax) / 16;
      const w = 2.5 + (k - 2) * 0.5 + puff * 0.4;
      B.push(c(ax - nx * (ra + w), ay - ny * (ra + w), qx - nx * (rb + w), qy - ny * (rb + w), w, w, TM.Down, 1, 3));
      B.push(c(ax + nx * (ra + w), ay + ny * (ra + w), qx + nx * (rb + w), qy + ny * (rb + w), w, w, TM.Down, 1, 3));
    }
  }
  // Pinceau de plumes au bout de la queue.
  const [tx, ty] = tail[10], [px9, py9] = tail[9];
  const tdx = (tx - px9) / 16, tdy = (ty - py9) / 16;
  for (let i = -1; i <= 1; i++) {
    B.push(c(tx - tdx * 4, ty - tdy * 4, tx + tdx * 14 - tdy * i * 4, ty + tdy * 14 + tdx * i * 4, 1, 1, TM.Feather, 18, 2, true));
  }

  // Corps épais (plumage d'hiver), ventre blanc, mouchetures sombres sur le dos.
  B.push(e(2, -84, 42 + puff, 19 + puff, TM.Skin, 0, 20));
  B.push(e(8, -72 + puff * 0.5, 34 + puff * 0.5, 9 + puff * 0.5, TM.Belly, 8, 9, -74));
  for (let k = 0; k < 9; k++) B.push(e(-30 + k * 8, -92 - puff + (k % 3) * 5, 1.8, 1.6, TM.Speck, 22, 2));
  // Plumes du dos, hérissées quand il gonfle son plumage.
  for (let k = 0; k < 8; k++) {
    const x = -36 + k * 10;
    const y = -101 - puff + Math.abs(x + 2) * 0.1;
    B.push(c(x, y, x - 8 + r.fluff * 3, y - 4 - (k % 2) * 3 - r.fluff * 4, 1, 1, TM.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 62, hy = -118 + hb;
  // Grosse tête ronde (grand cerveau), museau fin et pointu, masque sombre, œil immense.
  H.push(e(hx, hy, 18, 15, TM.Skin, 8, 12));
  H.push(e(hx + 22, hy + 5, 16, 5.5, TM.Skin, 8, 8));
  H.push(e(hx - 2, hy + 9, 12, 5.5, TM.Belly, 12, 6));
  H.push(e(EYE.x + 1, EYE.y + hb + 1, 10, 12, TM.Mask, 22, 3));
  H.push(c(EYE.x + 6, EYE.y + hb + 4, hx + 26, hy + 3, 3, 1.5, TM.Mask, 20, 2));
  if (r.closed) H.push(c(EYE.x - 5, EYE.y + hb + 1, EYE.x + 5, EYE.y + hb + 1, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 8, 11, TM.Eye, 30, 1));
  for (let tx2 = hx + 14; tx2 <= hx + 34; tx2 += 5) H.push(e(tx2, hy + 10, 1.4, 1.9, M.Tooth, 16, 1));
  if (r.jaw > 0.1) H.push(e(hx + 18, hy + 11, 16, 5, M.Mouth, 12, 4, hy + 9));
  const J: Prim[] = [c(hx + 2, hy + 11, hx + 36, hy + 10, 4, 2.2, TM.Skin, 6, 4)];
  if (r.jaw > 0.1) for (let tx2 = hx + 16; tx2 <= hx + 32; tx2 += 6) J.push(e(tx2, hy + 8.5, 1.3, 1.6, CM.ToothUp, 14, 1));
  else J.push(c(hx + 6, hy + 9, hx + 37, hy + 8, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, hx + 2, hy + 9, r.jaw * 0.55));
  // Plumes de l'arrière du crâne : couchées, ou dressées en aigrette.
  for (let i = 0; i < (r.legs === "lie" ? 0 : 4); i++) {
    const up = Math.max(0, r.crest), len = 13 - i * 2;
    const ox = hx - 13 - i * 3, oy = hy - 7 + i * 4;
    const dx = lerp(-0.92, -0.45, up), dy = lerp(-0.4 + i * 0.1, -0.9, up);
    H.push(c(ox, oy, ox + dx * len, oy + dy * len, 1, 1, TM.Feather, 20, 2, true));
  }
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 13 + puff * 0.5, 9, TM.Skin, 6, 10),
    // Collerette de duvet à la base du cou.
    e(NECK.x + 2, NECK.y + 2, 14 + puff, 13 + puff, TM.Down, 9, 8),
    c(NECK.x + 8, NECK.y + 4, NAPE.x + 8, NAPE.y + 8 + hb, 6, 4, TM.Belly, 12, 6),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras-ailes : repliés le long du flanc, ou déployés ; au repos l'aile proche couvre la tête.
  for (const far of [true, false]) {
    const m = far ? TM.Far : TM.Skin;
    const z = far ? -30 : r.tuck > 0.5 ? 60 : 26;
    const a = r.arms;
    const sx = 34 + (far ? -4 : 0) - r.tuck * 6, sy = -82 - r.tuck * 6;
    const ex = sx + lerp(5, far ? 2 : 9, a) - r.tuck * 12, ey = sy + lerp(13, far ? -18 : -16, a) - r.tuck * 14;
    const flap = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const wx = ex + lerp(13, far ? 14 : 19, a) - r.tuck * 26, wy = ey + lerp(-2 + flap, far ? -9 : -5, a) + r.tuck * 4;
    const fl = lerp(12, 24, a) + r.fluff * 2;
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const dx = lerp(-1, -0.35 + u * 0.15, a), dy = lerp(-0.2, 1, a) + r.tuck * 0.5;
      B.push(c(qx, qy, qx + dx * fl * (1 - u * 0.3 * a), qy + dy * fl * (1 - u * 0.3 * a), 1, 1, k % 2 ? TM.Feather : TM.Mask, z + 1, 1, true));
    }
    if (a > 0.3 || (!far && r.tuck > 0.5)) B.push(e((ex + wx) / 2 - 3, (ey + wy) / 2 + 7 * Math.max(a, r.tuck), 11, 9 * Math.max(a, r.tuck * 0.9), TM.Down, z - 2, 4));
    B.push(c(sx, sy, ex, ey, 4.5, 3.2, m, z, 4));
    B.push(c(ex, ey, wx, wy, 3.2, 2.2, m, z, 3));
    for (let k = 0; k < 2; k++) B.push(c(wx, wy + k * 2, wx + 4, wy + 4 + k * 2, 1, 1, TM.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, TROODON_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne, dents, colonne, bras, pattes (avec faucille), queue, bassin.
 */
export function troodonSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : boîte crânienne bombée, orbites immenses tournées vers l'avant, museau étroit.
  tag("crane",
    e(60, -120, 16, 13, B, 12, 8), e(80, -114, 16, 5, B, 12, 6),
    c(54, -110, 96, -108, 2.5, 1.5, B, 12, 2),
    e(70, -122, 8, 10, M.Socket, 30, 1), e(86, -114, 4, 2.5, M.Socket, 30, 1));
  // Dents : nombreuses, serrées, aux grosses dentelures (les fossiles les plus courants du site).
  tag("dents", ...[72, 77, 82, 87, 92].map((x) => e(x, -106, 1.3, 2, M.Tooth, 16, 1)));
  // Colonne : cou en S, dos horizontal, côtes fines.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 11; k++) {
    const t = k / 11;
    spine.push(t < 0.4 ? [48 - t * 45, -110 + t * 62] : [30 - (t - 0.4) * 85, -85 + (t - 0.4) * 2]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 3.2, 2.8, B, 10, 3));
  for (let k = 6; k <= 10; k++) {
    const [x, y] = spine[k];
    tag("vertebres", c(x, y + 2, x + 3, y + 14, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, pubis tourné vers l'arrière.
  tag("bassin", e(0, -82, 17, 6, B, 12, 6), c(-2, -78, -11, -60, 2.6, 2, B, 12, 3), c(5, -78, 13, -70, 2.6, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, main à trois doigts griffus.
  tag("bras",
    c(38, -92, 20, -94, 2.3, 1.9, B, 12, 2),
    c(36, -84, 40, -70, 2.3, 1.9, B, 14, 2), c(40, -70, 55, -72, 1.9, 1.5, B, 14, 2),
    ...[0, 2, 4].map((k) => c(55, -72 + k, 59, -68 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, long métatarse, orteils.
  for (const [hx, z] of [[5, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -74, hx + 17, -52, 3, 2.4, B, z, 3), c(hx + 17, -52, hx - 6, -28, 2.4, 1.9, B, z, 2),
      c(hx - 6, -28, hx + 6, -4, 1.9, 1.5, B, z, 2), c(hx + 5, -3, hx + 19, -2, 1.5, 1, B, z, 1));
    // Griffe en faucille du deuxième orteil, relevée.
    tag("faucille", c(hx + 7, -5, hx + 10, -12, 1, 1, B, z + 4, 1, true), c(hx + 10, -12, hx + 15, -11, 1, 1, B, z + 4, 1, true));
  }
  // Queue : très longue, vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 16; k++) tag("queue", e(-28 - k * 10, -83 - k * 0.4, 3.2 - k * 0.1, 2.4 - k * 0.07, B, 10, 2));
  return P.map((p) => scalePrim(p, TROODON_SCALE));
}

export const TROODON: Species = {
  id: "troodon",
  name: "Troodontidé d'Alaska",
  latin: "Troodontidae (Prince Creek)",
  period: "Crétacé supérieur, 70 Ma",
  place: "Formation de Prince Creek, Alaska (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 50,
  facts: [
    { id: "dents", title: "Des dents par centaines", unlock: "discover",
      text: "Au bord de la rivière Colville, dans le nord de l'Alaska, les dents de troodontidés sont les dents de dinosaures carnivores les plus nombreuses ! Pourtant, on n'a presque rien trouvé d'autre de l'animal : on le reconstitue d'après ses cousins." },
    { id: "nom", title: "Un nom qui fait débat", unlock: "assemble",
      text: "Comment s'appelle-t-il vraiment ? On l'a d'abord rangé avec le Troodon. Mais ses dents sont un peu différentes, et certains chercheurs pensent que c'est une espèce nouvelle, encore sans nom. Tant qu'on n'a pas trouvé un squelette, le mystère reste entier." },
    { id: "grand", title: "Plus grand dans le froid ?", unlock: "eat",
      text: "Ses dents sont plus grandes que celles des troodontidés vivant plus au sud. Il était donc peut-être plus grand, environ 3 mètres (c'est une estimation). Une idée : dans le froid, un gros corps garde mieux sa chaleur. C'est pour cela que les ours polaires sont si grands !" },
    { id: "nuit", title: "Des yeux pour la nuit polaire", unlock: "hunt",
      text: "Près du pôle, l'hiver, le soleil ne se lève pas pendant des semaines. Les troodontidés avaient des yeux immenses tournés vers l'avant et un gros cerveau. Les chercheurs pensent que cela l'aidait à chasser dans la pénombre (c'est une hypothèse)." },
    { id: "plumes", title: "Une doudoune de plumes", unlock: "rest",
      text: "Ses proches cousins avaient des plumes : lui aussi, sûrement. Roulé en boule, la tête sous le bras et la queue enroulée autour du corps, il gardait sa chaleur comme un oiseau dans la neige." },
    { id: "bebe", title: "Né près du pôle", unlock: "baby",
      text: "À Prince Creek, on a trouvé de toutes petites dents de bébés troodontidés, à peine sortis de l'œuf. Ils naissaient donc dans l'Arctique : leurs parents y faisaient leurs nids et y restaient sans doute toute l'année, même pendant la longue nuit d'hiver." },
  ],
  bones: [
    { id: "crane", name: "Crâne aux grandes orbites" },
    { id: "dents", name: "Dents dentelées" },
    { id: "vertebres", name: "Colonne et côtes" },
    { id: "bras", name: "Bras" },
    { id: "bassin", name: "Bassin" },
    { id: "pattes", name: "Pattes" },
    { id: "faucille", name: "Griffes en faucille" },
    { id: "queue", name: "Longue queue" },
  ],
  model: troodonModel,
  skeleton: troodonSkeleton,
  center: { x: 8 * TROODON_SCALE, y: -86 * TROODON_SCALE },
  eye: { x: EYE.x * TROODON_SCALE, y: EYE.y * TROODON_SCALE },
  feet: [8, 12].map((x) => x * TROODON_SCALE),
  halfLen: 135 * TROODON_SCALE,
  shadow: 0.5,
  walkSpeed: 48,
  runSpeed: 185,
  stride: 10,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: ["edmonto", "pachyrhino"], defense: "flee", sight: 460, scavenger: true },
  biomes: [BIOME.Tundra],
};
