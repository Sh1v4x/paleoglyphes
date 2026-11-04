import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { OMM } from "./ornithomimus.mat";
import { c, e, lerp, REST_RIG, rot, theroLegs, win, type TheroLegSpec, type TheroRig } from "./kit";
import type { Pose, Species } from "./types";

/**
 * Ornithomimus (Ornithomimus velox), le « dinosaure autruche » de Hell Creek, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Silhouette d'autruche : petit
 * corps rond, très longues pattes fines aux métatarses allongés, long cou mince, toute petite tête
 * à bec droit sans dents, longs bras à trois doigts griffus portant des plumes d'aile, queue longue
 * et droite servant de balancier. Ni crête, ni griffe en faucille.
 * Le modèle brut mesure ~205 px de la queue au bec.
 */
const LENGTH_M = 3.8;
export const ORNITHOMIMUS_SCALE = (LENGTH_M * PX_PER_M) / 205;

/** Gréement du raptor, plus : coup de patte vers l'avant (0..1). */
interface MimusRig extends TheroRig {
  kick: number;
}

function ornithomimusRig({ action, actionT: t, time }: Pose): MimusRig {
  const r: MimusRig = { ...REST_RIG, kick: 0 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      // Sprint d'autruche : corps et cou tendus à l'horizontale, foulées immenses, bras plaqués.
      Object.assign(r, { pitch: 0.18, neck: 0.75, head: -0.55, stride: 1.9, tailUp: 2 });
      break;
    case "eat": {
      // Picore au ras du sol : graines, feuilles, insectes, à petits coups de bec rapides.
      const peck = Math.pow(Math.abs(Math.sin(t * Math.PI * 4)), 3);
      Object.assign(r, { pitch: 0.3, neck: 1.4 + peck * 0.18, head: 0.55 + peck * 0.2, jaw: (1 - peck) * 0.4, dy: 6, stance: 6, tailUp: 2 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.4, neck: 1.5 + s * 0.05, head: 0.8, jaw: 0.05, dy: 8, tailUp: 10 });
      break;
    case "rest": {
      // Couché sur ses pattes repliées comme une autruche, cou dressé, yeux mi-clos.
      const br = Math.sin(time * 2.2) * 0.03;
      Object.assign(r, { dy: 54, pitch: -0.04, neck: -0.12 + br, head: 0.15, legs: "sit", tailUp: 2, closed: true });
      break;
    }
    case "attack": {
      // Coup de patte : se redresse en ramenant la patte, puis la détend vers l'avant, griffes des mains
      // lancées en même temps.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.45));
      const hit = win(t, 0.35, 0.5) * (1 - win(t, 0.75, 1));
      Object.assign(r, {
        dy: wind * 4 - hit * 2, dx: hit * 6,
        pitch: -0.2 * wind - 0.1 * hit,
        neck: -0.35 * wind - 0.25 * hit,
        head: 0.15 * hit,
        jaw: 0.6 * Math.max(wind, hit),
        arms: Math.max(wind * 0.6, hit),
        kick: wind * 0.45 + hit,
        tailUp: 10 * Math.max(wind, hit),
      });
      break;
    }
    case "defend":
      // Bras-ailes ouverts, cou rejeté en arrière, prêt à détaler.
      Object.assign(r, { pitch: -0.1, neck: -0.25, head: 0.2, jaw: 0.5 + 0.3 * s, arms: 1, tailUp: 14, stance: 12, dy: 2 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.15, neck: -0.35, head: -0.8, jaw: 0.5 + 0.45 * Math.abs(s), arms: 0.5 + 0.2 * Math.abs(s), tailUp: 6 });
      break;
    case "dead":
      Object.assign(r, { dy: 60, pitch: 0.04, neck: 1.25, head: 0.4, jaw: 0.3, curl: 0.15, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -82 };
const LEGS: TheroLegSpec = {
  hip: HIP, farHip: 4, lift: 12, reach: 6, swing: 30, footY: -3,
  mx: 8, my: 30, metaLift: 0.4,
  sit: { dx: 24, far: 6, y: -3, mx: 30, my: 3 },
  lie: { dx: 70, far: -8, y: -5, nearDy: 4, mx: 26, my: 3 },
  kneeDy: 4, thigh: 28, shin: 34,
};
const NECK = { x: 26, y: -94 };
const NAPE = { x: 52, y: -140 };
const EYE = { x: 59, y: -146 };

export function ornithomimusModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = ornithomimusRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.9) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Très longues pattes de coureur (cinématique inverse), sans griffe en faucille ---
  for (const L of theroLegs(pose, r, bx, by, LEGS, (f, far, hx, hy) => {
      if (far || r.kick <= 0) return;
      // Coup de patte : le pied proche monte et se détend vers l'avant.
      f.fx = lerp(f.fx, hx + 52, r.kick); f.fy = lerp(f.fy, hy + 34, r.kick);
      f.mx = lerp(f.mx, 22, r.kick); f.my = lerp(f.my, 10, r.kick);
    })) {
    const m = L.far ? OMM.Far : OMM.Skin;
    const leg = L.far ? OMM.Far : OMM.Leg;
    const z = L.far ? -40 : 22;
    const { hx, hy, fx, fy, ax, ay, kx, ky } = L;
    // Cuisse emplumée et musclée, jambe et métatarse nus, longs et fins, trois orteils courts.
    P.push(e(hx, hy, 13, 16, m, z - 4, 12));
    P.push(c(hx, hy + 4, kx, ky, 9, 5, m, z, 9));
    P.push(c(kx, ky, ax, ay, 4, 2.6, leg, z + 2, 5));
    P.push(c(ax, ay, fx, fy, 2.6, 2, leg, z + 3, 4));
    P.push(c(fx - 2, fy, fx + 10, fy + 1.5, 2.2, 1.6, leg, z + 3, 3));
    P.push(c(fx + 9, fy + 0.5, fx + 12, fy + 2, 1, 1, OMM.Claw, z + 8, 1, true));
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Queue longue, droite et fine : un balancier tenu à l'horizontale.
  const sway = Math.sin(time * 1.5) * 3 * (1 - moving) + Math.sin(walk) * 5 * moving;
  const tail: [number, number][] = [[-22, -88]];
  let ang = Math.PI + 0.06 + r.tailUp * 0.01 - r.pitch * 0.85;
  for (let k = 1; k <= 6; k++) {
    ang -= r.curl * 0.3 + sway * 0.004 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 17, Math.min(py + Math.sin(ang) * 17, -Math.max(2, 10 - k) - by - 2)]);
  }
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    B.push(c(ax, ay, qx, qy, Math.max(2, 12 - k * 2), Math.max(2, 10 - k * 2), OMM.Skin, 2, 10));
    // Plumes courtes le long de la queue.
    if (k % 2 === 1) B.push(c(ax, ay - 4, ax - 8, ay - 6, 1, 1, OMM.Feather, 16, 2, true));
  }

  // Petit corps rond d'autruche, ventre et poitrail pâles, rayures sombres sur le dos.
  B.push(e(6, -88, 30, 16, OMM.Skin, 0, 18));
  B.push(e(14, -77, 22, 6, OMM.Belly, 8, 7, -78));
  for (let k = 0; k < 4; k++) {
    const x = -14 + k * 10;
    B.push(e(x, -100 + Math.abs(x - 6) * 0.08, 2.5, 5, OMM.Mark, 16, 3));
  }
  // Plumes lâches du dos et de la cuisse.
  for (let k = 0; k < 6; k++) {
    const x = -20 + k * 8;
    const y = -103 + Math.abs(x - 6) * 0.15;
    B.push(c(x, y, x - 8, y - 3 - (k % 2) * 2, 1, 1, OMM.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 56, hy = -144 + hb;
  // Toute petite tête, grands yeux, sans crête.
  H.push(e(hx, hy, 8, 6.5, OMM.Skin, 8, 9));
  H.push(e(hx + 1, hy + 4, 5, 2.5, OMM.Belly, 12, 4));
  if (r.closed) H.push(c(EYE.x - 2.5, EYE.y + hb, EYE.x + 2.5, EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 2.6, 2.6, OMM.Eye, 30, 1));
  // Bec droit, long et pointu, sans aucune dent.
  H.push(c(hx + 5, hy - 1, hx + 22, hy + 2, 3.4, 1.1, OMM.Beak, 14, 4));
  if (r.jaw > 0.1) H.push(e(hx + 12, hy + 3, 7, 2.5, M.Mouth, 12, 3, hy + 2));
  const J: Prim[] = [c(hx + 4, hy + 3, hx + 19, hy + 3.5, 2.4, 1, OMM.Beak, 13, 3)];
  if (r.jaw <= 0.1) J.push(c(hx + 7, hy + 2, hx + 19, hy + 2.5, 1, 1, OMM.Mark, 16, 1, true));
  H.push(...rot(J, hx + 4, hy + 3, r.jaw * 0.5));
  // Long cou mince, légèrement en S, gorge pâle.
  const mid = { x: (NECK.x + NAPE.x) / 2 + 4, y: (NECK.y + NAPE.y) / 2 };
  const N: Prim[] = [
    c(NECK.x, NECK.y, mid.x, mid.y, 10, 6, OMM.Skin, 6, 9),
    c(mid.x, mid.y, NAPE.x, NAPE.y + hb, 6, 4.5, OMM.Skin, 6, 7),
    c(NECK.x + 6, NECK.y + 5, mid.x + 4, mid.y + 2, 4.5, 3, OMM.Belly, 10, 5),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Longs bras à trois doigts griffus : repliés sous le poitrail, plumes d'aile sombres sur l'avant-bras.
  for (const far of [true, false]) {
    const m = far ? OMM.Far : OMM.Skin;
    const z = far ? -30 : 28;
    const a = r.arms;
    const sx = 28 + (far ? -4 : 0), sy = -84;
    const ex = sx + lerp(4, far ? 6 : 14, a), ey = sy + lerp(16, far ? -8 : -4, a);
    const flap = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const wx = ex + lerp(14, far ? 18 : 24, a), wy = ey + lerp(2 + flap, far ? 2 : 6, a);
    const fl = lerp(12, 20, a);
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const dx = lerp(-1, -0.3, a), dy = lerp(0.1, 1, a);
      B.push(c(qx, qy, qx + dx * fl * (1 - u * 0.4), qy + dy * fl * (1 - u * 0.4), 1, 1, k % 2 ? OMM.Feather : OMM.Wing, z + 1, 1, true));
    }
    B.push(c(sx, sy, ex, ey, 4, 2.8, m, z, 4));
    B.push(c(ex, ey, wx, wy, 2.8, 2, m, z, 3));
    // Main longue : trois doigts presque égaux, griffes peu courbées.
    const reach = 7 + a * 3;
    for (let k = 0; k < 3; k++) B.push(c(wx, wy + k * 1.5, wx + reach, wy + 3 + k * 2.5, 1, 1, OMM.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, ORNITHOMIMUS_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne à bec, long cou, dos et côtes, bassin, longs bras, pattes, pieds de coureur, queue.
 */
export function ornithomimusSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : petit et léger, très grande orbite, long bec sans dents.
  tag("crane",
    e(56, -146, 8, 6, B, 12, 6),
    c(60, -147, 78, -142, 2.6, 1, B, 12, 2), c(60, -141, 75, -140, 1.8, 1, B, 12, 2),
    e(57, -148, 3.5, 3.5, M.Socket, 30, 1), e(66, -145, 2.5, 1.5, M.Socket, 30, 1));
  // Cou : long, vertèbres qui montent en S léger jusqu'au crâne.
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    tag("cou", e(28 + t * 24 + Math.sin(t * Math.PI) * 5, -96 - t * 44, 3 - t * 0.8, 2.6 - t * 0.6, B, 10, 3));
  }
  // Dos court et côtes.
  for (let k = 0; k <= 6; k++) tag("vertebres", e(22 - k * 7, -96 + k * 0.4, 3, 2.6, B, 10, 3));
  for (let k = 1; k <= 5; k++) {
    const x = 22 - k * 7;
    tag("vertebres", c(x, -94, x + 4, -76 + k, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, long pubis vers le bas terminé par un « pied » osseux.
  tag("bassin", e(-2, -90, 16, 5.5, B, 12, 6), c(2, -86, 10, -66, 2.4, 1.8, B, 12, 3), e(10, -65, 4, 1.8, B, 12, 2),
    c(-6, -86, -14, -72, 2.2, 1.8, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, longue main à trois doigts griffus presque égaux.
  tag("bras",
    c(32, -98, 16, -98, 2, 1.6, B, 12, 2),
    c(30, -86, 34, -70, 2, 1.6, B, 14, 2), c(34, -70, 48, -66, 1.7, 1.3, B, 14, 2),
    ...[0, 2, 4].map((k) => c(48, -66 + k * 0.5, 57, -63 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia plus long que le fémur (signe d'un coureur).
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -78, hx + 16, -56, 2.8, 2.2, B, z, 3), c(hx + 16, -56, hx - 4, -30, 2.2, 1.7, B, z, 2));
  }
  // Pieds : très long métatarse serré (l'« arctométatarse »), trois orteils courts.
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pieds", c(hx - 4, -30, hx + 4, -4, 1.7, 1.3, B, z, 2), c(hx + 3, -3, hx + 15, -2, 1.3, 1, B, z, 1));
  }
  // Queue longue et droite : vertèbres qui s'affinent.
  for (let k = 0; k <= 11; k++) tag("queue", e(-20 - k * 9, -90 + k * 0.5, 2.8 - k * 0.15, 2.2 - k * 0.1, B, 10, 2));
  return P.map((p) => scalePrim(p, ORNITHOMIMUS_SCALE));
}

export const ORNITHOMIMUS: Species = {
  id: "ornithomimus",
  name: "Ornithomimus",
  latin: "Ornithomimus velox",
  period: "Crétacé supérieur, 66 Ma",
  place: "Formation de Hell Creek, Montana (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 170,
  facts: [
    { id: "nom", title: "L'imitateur d'oiseau", unlock: "discover",
      text: "Ornithomimus veut dire « imitateur d'oiseau ». En 1890, le paléontologue Othniel Marsh l'a nommé à partir de quelques os de pied et de main qui ressemblaient beaucoup à ceux d'un oiseau. Avec son long cou et ses longues pattes, on le surnomme aussi le « dinosaure autruche »." },
    { id: "jambes", title: "Des jambes de coureur", unlock: "assemble",
      text: "Regarde ses pattes : le tibia est plus long que la cuisse, et les os du pied sont très longs et serrés les uns contre les autres. C'est le squelette d'un coureur, comme celui de l'autruche aujourd'hui." },
    { id: "vitesse", title: "Champion de vitesse", unlock: "flee",
      text: "C'était sans doute l'un des dinosaures les plus rapides. Les scientifiques estiment qu'il pouvait courir à 50 ou 60 km/h, presque comme une autruche ! Sans cornes ni griffe géante, sa meilleure défense était de détaler." },
    { id: "bec", title: "Un bec pour tout picorer", unlock: "eat",
      text: "Il n'avait pas une seule dent : juste un petit bec corné. Il mangeait sans doute un peu de tout : feuilles, graines, insectes, peut-être de petits animaux. Son menu exact est encore débattu par les scientifiques." },
    { id: "ailes", title: "Des ailes qui ne volent pas", unlock: "call",
      text: "En 2012, des chercheurs ont étudié des Ornithomimus du Canada avec des traces de plumes. Les jeunes étaient couverts de duvet, et seuls les adultes avaient de grandes plumes aux bras, comme des ailes. Trop lourd pour voler, il s'en servait peut-être pour parader ou couver." },
    { id: "bande", title: "Toujours en bande", unlock: "herd",
      text: "En Chine, on a trouvé un gisement avec plus d'une douzaine de Sinornithomimus, un proche cousin, morts ensemble. Cela montre que ces dinosaures autruches vivaient en groupe, peut-être pour mieux repérer les prédateurs." },
  ],
  bones: [
    { id: "crane", name: "Crâne à bec" },
    { id: "cou", name: "Long cou" },
    { id: "vertebres", name: "Dos et côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Longs bras griffus" },
    { id: "pattes", name: "Cuisses et tibias" },
    { id: "pieds", name: "Pieds de coureur" },
    { id: "queue", name: "Longue queue" },
  ],
  model: ornithomimusModel,
  skeleton: ornithomimusSkeleton,
  center: { x: 6 * ORNITHOMIMUS_SCALE, y: -88 * ORNITHOMIMUS_SCALE },
  eye: { x: EYE.x * ORNITHOMIMUS_SCALE, y: EYE.y * ORNITHOMIMUS_SCALE },
  feet: [8, 12].map((x) => x * ORNITHOMIMUS_SCALE),
  halfLen: 100 * ORNITHOMIMUS_SCALE,
  shadow: 0.45,
  walkSpeed: 60,
  runSpeed: 250,
  stride: 11,
  behavior: { diet: "omnivore", herd: [4, 8], browse: "low", prey: [], defense: "flee", sight: 420, scavenger: false },
  biomes: [BIOME.HellCreek],
};
