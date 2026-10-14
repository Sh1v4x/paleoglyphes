import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { CM } from "./carnivores.mat";
import { PM } from "./pectinodon.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Pectinodon (Pectinodon bakkeri), petit troodontidé de Hell Creek, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Connu surtout par ses dents :
 * on le reconstruit comme son proche cousin Troodon. Svelte, emplumé, très longues pattes,
 * énormes yeux tournés vers l'avant (chasseur nocturne), grosse boîte crânienne, petite griffe en
 * faucille relevée, longue queue emplumée. Le modèle brut mesure ~250 px de la queue au museau.
 */
const LENGTH_M = 2.4;
export const PECTINODON_SCALE = (LENGTH_M * PX_PER_M) / 250;

/** Gréement du raptor, plus : tête rentrée sous l'aile (sommeil d'oiseau) et plumage gonflé. */
interface TroodRig extends TheroRig {
  tuck: number;
  fluff: number;
}

function pectinodonRig({ action, actionT: t, time }: Pose): TroodRig {
  const r: TroodRig = { ...REST_RIG, tuck: 0, fluff: 0 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.12, neck: 0.5, head: -0.3, stride: 1.5, tailUp: 6, crest: -0.3 });
      break;
    case "eat": {
      // Picore : coups de bec rapides vers le sol (petites proies, œufs), comme un oiseau.
      const peck = Math.pow(Math.abs(Math.sin(t * Math.PI * 4)), 3);
      Object.assign(r, { pitch: 0.38, neck: 0.85 + peck * 0.35, head: 0.5 + peck * 0.2, jaw: 0.15 + (1 - peck) * 0.45, dy: 6, stance: 6, tailUp: 14 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.36, neck: 1.0 + s * 0.08, head: 0.7, jaw: 0.05, dy: 8, tailUp: 12 });
      break;
    case "rest": {
      // Dort comme un oiseau (et comme le fossile de Mei long) : accroupi sur ses pattes repliées,
      // cou ramené en arrière, tête posée sur le dos et cachée sous l'aile, queue enroulée.
      const br = Math.sin(time * 2.6) * 0.03;
      Object.assign(r, { dy: 44, pitch: -0.04, neck: -2.15 + br, head: -0.9, curl: 1, legs: "sit", closed: true, tuck: 1, fluff: 0.4 });
      break;
    }
    case "attack": {
      // Bondit : accroupi, saut pattes en avant ailes ouvertes, puis plaque la proie et la pique.
      const crouch = win(t, 0, 0.25) * (1 - win(t, 0.3, 0.4));
      const air = win(t, 0.25, 0.4) * (1 - win(t, 0.6, 0.72));
      const pin = win(t, 0.6, 0.75);
      Object.assign(r, {
        dy: crouch * 16 - air * 38 + pin * 12,
        dx: air * 22 + pin * 26,
        pitch: -0.12 * crouch - 0.3 * air + 0.34 * pin,
        neck: 0.15 * crouch + 0.2 * air + 0.55 * pin + pin * Math.max(0, Math.sin(t * 30)) * 0.2,
        head: 0.1 + 0.3 * pin,
        jaw: 0.9 * Math.max(air, pin),
        arms: Math.max(air, pin * (0.7 + 0.3 * Math.sin(t * 40))),
        crest: Math.max(crouch, air),
        tailUp: 10 * air + 14 * pin,
        legs: air > 0.5 ? "air" : "stand",
        stance: 8 * pin,
      });
      break;
    }
    case "defend":
      // Plumage gonflé, ailes grandes ouvertes, queue en éventail dressée : il paraît deux fois plus gros.
      Object.assign(r, { pitch: -0.14, neck: 0.1, head: 0.15, jaw: 0.7 + 0.3 * s, arms: 1, crest: 1, tailUp: 22, stance: 12, dy: 2, fluff: 1 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.22, neck: -0.7, head: -0.6, jaw: 0.55 + 0.45 * Math.abs(s), arms: 0.3, crest: 0.8, tailUp: -2, fluff: 0.3 });
      break;
    case "dead":
      Object.assign(r, { dy: 52, pitch: 0.06, neck: 1.0, head: 0.1, jaw: 0.25, curl: 0.2, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -72 };
const NECK = { x: 28, y: -86 };
const NAPE = { x: 46, y: -110 };
const EYE = { x: 62, y: -118 };

export function pectinodonModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = pectinodonRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.8) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Longues pattes d'oiseau coureur (cinématique inverse) ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 13 * r.stride;
    const m = L.far ? PM.Far : PM.Skin;
    const z = L.far ? -40 : 22;
    const hx = HIP.x + (L.far ? 4 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 6 + sw * 30 + (L.far ? -r.stance : r.stance), fy = -3 - lift;
    // Métatarse très long (signe d'un bon coureur) : vecteur de la cheville vers les orteils.
    let mx = 12, my = 27 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 18 + (L.far ? 6 : 0); fy = -3; mx = 28; my = 3; }
    else if (r.legs === "air") { fx = hx + 36 + (L.far ? -6 : 4); fy = hy + 50; mx = 18; my = 14; }
    else if (r.legs === "lie") { fx = hx + 66 + (L.far ? -8 : 0); fy = -5 - (L.far ? 0 : 4); mx = 22; my = 3; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 4, ax, ay, 26, 34);
    // Cuisse emplumée, jambe fine, métatarse écailleux.
    P.push(e(hx, hy, 15, 18, m, z - 4, 12));
    P.push(c(hx, hy + 4, kx, ky, 10, 5.5, m, z, 9));
    P.push(c(kx, ky, ax, ay, 4.5, 3, m, z + 2, 5));
    P.push(c(ax, ay, fx, fy, 3, 2.2, L.far ? PM.Far : PM.Mark, z + 3, 4));
    // Orteils, petite griffe en faucille relevée (ou braquée vers l'avant pendant le bond).
    const toeY = r.legs === "air" ? 6 : 1.5;
    P.push(c(fx - 2, fy, fx + 12, fy + toeY, 2.6, 1.6, m, z + 3, 3));
    const sk = r.legs === "air" ? [fx + 5, fy + 2, fx + 11, fy + 6] : [fx + 3, fy - 8, fx + 8, fy - 7];
    P.push(c(fx + 1, fy - 2, sk[0], sk[1], 1, 1, PM.Claw, z + 8, 2, true));
    P.push(c(sk[0], sk[1], sk[2], sk[3], 1, 1, PM.Claw, z + 8, 2, true));
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];
  const puff = r.fluff * 4;

  // Longue queue emplumée : frange de plumes de chaque côté, éventail barré au bout.
  const sway = Math.sin(time * 1.7) * 3 * (1 - moving) + Math.sin(walk) * 6 * moving;
  const tail: [number, number][] = [[-28, -80]];
  let ang = Math.PI + 0.06 + r.tailUp * 0.01 - r.pitch * 0.85;
  for (let k = 1; k <= 8; k++) {
    ang -= r.curl * 0.3 + sway * 0.004 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 16, Math.min(py + Math.sin(ang) * 16, -Math.max(2, 12 - k * 1.5) - by - 2)]);
  }
  for (let k = 0; k < 8; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(2, 13 - k * 1.5), rb = Math.max(2, 13 - (k + 1) * 1.5);
    B.push(c(ax, ay, qx, qy, ra, rb, PM.Skin, 2, 10));
    if (k % 2) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.5, 2.5, ra * 0.45, PM.Mark, 12, 3));
    // Frange : vexilles plates de chaque côté de la queue (comme chez Microraptor ou Archaeopteryx).
    if (k >= 3) {
      const nx = -(qy - ay) / 16, ny = (qx - ax) / 16;
      const w = 2 + (k - 3) * 0.6 + puff * 0.4;
      B.push(c(ax - nx * (ra + w), ay - ny * (ra + w), qx - nx * (rb + w), qy - ny * (rb + w), w, w, PM.Wing, 1, 3));
      B.push(c(ax + nx * (ra + w), ay + ny * (ra + w), qx + nx * (rb + w), qy + ny * (rb + w), w, w, PM.Wing, 1, 3));
    }
  }
  const [tx, ty] = tail[8], [px8, py8] = tail[7];
  const tdx = (tx - px8) / 16, tdy = (ty - py8) / 16;
  const fan = 4 + r.fluff * 2;
  for (let i = -2; i <= 2; i++) {
    B.push(c(tx - tdx * 4, ty - tdy * 4, tx + tdx * 16 - tdy * i * fan, ty + tdy * 16 + tdx * i * fan, 1, 1, i % 2 ? PM.Wing : PM.Feather, 18, 2, true));
  }

  // Corps svelte (plus gonflé quand il se défend ou dort), ventre pâle, taches sombres.
  B.push(e(2, -80, 38 + puff, 16 + puff, PM.Skin, 0, 18));
  B.push(e(8, -70 + puff * 0.5, 30, 7 + puff * 0.5, PM.Belly, 8, 8, -71));
  for (let k = 0; k < 5; k++) B.push(e(-24 + k * 11, -88 - puff + (k % 2) * 4, 3, 2.2, PM.Mark, 20, 3));
  // Plumes du dos, hérissées quand il gonfle son plumage.
  for (let k = 0; k < 7; k++) {
    const x = -32 + k * 10;
    const y = -94 - puff + Math.abs(x + 2) * 0.1;
    B.push(c(x, y, x - 8 + r.fluff * 3, y - 5 - (k % 2) * 3 - r.fluff * 5, 1, 1, PM.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 58, hy = -116 + hb;
  // Grosse boîte crânienne (gros cerveau), museau étroit, énorme œil tourné vers l'avant.
  H.push(e(hx, hy, 15, 12, PM.Skin, 8, 12));
  H.push(e(hx + 18, hy + 4, 14, 5.5, PM.Skin, 8, 8));
  H.push(e(hx - 2, hy + 7, 10, 5, PM.Belly, 12, 6));
  H.push(c(hx - 8, hy - 2, hx - 2, hy + 4, 2, 1.5, PM.Mark, 18, 2));
  if (r.closed) H.push(c(EYE.x - 4, EYE.y + hb + 1, EYE.x + 4, EYE.y + hb + 1, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 6.5, 9.5, PM.Eye, 30, 1));
  for (let tx2 = hx + 12; tx2 <= hx + 28; tx2 += 5) H.push(e(tx2, hy + 9, 1.4, 1.8, M.Tooth, 16, 1));
  // Gueule ouverte : intérieur sombre, mâchoire inférieure abaissée.
  if (r.jaw > 0.1) H.push(e(hx + 14, hy + 10, 14, 5, M.Mouth, 12, 4, hy + 8));
  const J: Prim[] = [c(hx + 2, hy + 10, hx + 30, hy + 9, 3.5, 2.2, PM.Skin, 6, 4)];
  if (r.jaw > 0.1) for (let tx2 = hx + 14; tx2 <= hx + 26; tx2 += 6) J.push(e(tx2, hy + 7.5, 1.3, 1.6, CM.ToothUp, 14, 1));
  else J.push(c(hx + 6, hy + 8, hx + 31, hy + 7, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, hx + 2, hy + 8, r.jaw * 0.55));
  // Plumes de la nuque et de l'arrière du crâne : couchées, ou dressées.
  for (let i = 0; i < (r.legs === "lie" ? 0 : 3); i++) {
    const up = Math.max(0, r.crest), len = 12 - i * 2;
    const ox = hx - 10 - i * 4, oy = hy - 6 + i * 4;
    const dx = lerp(-0.92, -0.45, up), dy = lerp(-0.4 + i * 0.1, -0.9, up);
    H.push(c(ox, oy, ox + dx * len, oy + dy * len, 1, 1, i % 2 ? PM.Wing : PM.Feather, 20, 2, true));
  }
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 11 + puff * 0.5, 7, PM.Skin, 6, 10),
    c(NECK.x + 6, NECK.y + 4, NAPE.x + 6, NAPE.y + 6 + hb, 5, 3.5, PM.Belly, 10, 6),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras-ailes : repliés le long du flanc, ou déployés (rémiges ancrées sur l'avant-bras).
  // Au repos (tête rentrée), l'aile proche se soulève un peu et recouvre la tête posée sur le dos.
  for (const far of [true, false]) {
    const m = far ? PM.Far : PM.Skin;
    const z = far ? -30 : r.tuck > 0.5 ? 60 : 26;
    const a = r.arms;
    const sx = 30 + (far ? -4 : 0) - r.tuck * 6, sy = -78 - r.tuck * 6;
    const ex = sx + lerp(5, far ? 2 : 9, a) - r.tuck * 12, ey = sy + lerp(12, far ? -18 : -16, a) - r.tuck * 14;
    const flap = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    const wx = ex + lerp(12, far ? 13 : 18, a) - r.tuck * 26, wy = ey + lerp(-2 + flap, far ? -9 : -5, a) + r.tuck * 4;
    const fl = lerp(10, 22, a) + r.fluff * 2;
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const dx = lerp(-1, -0.35 + u * 0.15, a), dy = lerp(-0.2, 1, a) + r.tuck * 0.5;
      B.push(c(qx, qy, qx + dx * fl * (1 - u * 0.3 * a), qy + dy * fl * (1 - u * 0.3 * a), 1, 1, k % 2 ? PM.Feather : PM.Wing, z + 1, 1, true));
    }
    if (a > 0.3 || (!far && r.tuck > 0.5)) B.push(e((ex + wx) / 2 - 3, (ey + wy) / 2 + 7 * Math.max(a, r.tuck), 10, 8 * Math.max(a, r.tuck * 0.9), PM.Wing, z - 2, 4));
    B.push(c(sx, sy, ex, ey, 4, 3, m, z, 4));
    B.push(c(ex, ey, wx, wy, 3, 2, m, z, 3));
    for (let k = 0; k < 2; k++) B.push(c(wx, wy + k * 2, wx + 4, wy + 4 + k * 2, 1, 1, PM.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, PECTINODON_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne, colonne, bras, pattes, queue, bassin.
 */
export function pectinodonSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : grande boîte crânienne, orbite immense, museau étroit aux dents serrées et dentelées.
  tag("crane",
    e(56, -116, 14, 11, B, 12, 8), e(74, -112, 14, 5, B, 12, 6),
    c(50, -108, 88, -106, 2.5, 1.5, B, 12, 2),
    e(62, -118, 6, 8, M.Socket, 30, 1), e(76, -112, 4, 2.5, M.Socket, 30, 1),
    ...[68, 73, 78, 83].map((x) => e(x, -105, 1.2, 1.8, M.Tooth, 16, 1)));
  // Colonne : long cou en S, dos horizontal jusqu'au bassin, côtes fines.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 11; k++) {
    const t = k / 11;
    spine.push(t < 0.4 ? [44 - t * 45, -108 + t * 62] : [26 - (t - 0.4) * 80, -83 + (t - 0.4) * 2]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 3, 2.6, B, 10, 3));
  for (let k = 6; k <= 10; k++) {
    const [x, y] = spine[k];
    tag("vertebres", c(x, y + 2, x + 3, y + 12, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, pubis tourné vers l'arrière.
  tag("bassin", e(0, -80, 16, 6, B, 12, 6), c(-2, -76, -10, -60, 2.5, 2, B, 12, 3), c(5, -76, 12, -68, 2.5, 2, B, 12, 3));
  // Bras : omoplate, humérus, avant-bras, main à trois doigts griffus.
  tag("bras",
    c(34, -88, 18, -90, 2.2, 1.8, B, 12, 2),
    c(32, -80, 36, -68, 2.2, 1.8, B, 14, 2), c(36, -68, 50, -70, 1.8, 1.4, B, 14, 2),
    ...[0, 2, 4].map((k) => c(50, -70 + k, 54, -66 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, très long métatarse, orteils et petite faucille.
  for (const [hx, z] of [[5, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -72, hx + 16, -52, 2.8, 2.3, B, z, 3), c(hx + 16, -52, hx - 6, -28, 2.3, 1.8, B, z, 2),
      c(hx - 6, -28, hx + 6, -4, 1.8, 1.4, B, z, 2), c(hx + 5, -3, hx + 18, -2, 1.4, 1, B, z, 1),
      c(hx + 8, -5, hx + 11, -11, 1, 1, B, z + 4, 1, true));
  }
  // Queue : longue, vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 13; k++) tag("queue", e(-26 - k * 10, -81 - k * 0.5, 3 - k * 0.1, 2.3 - k * 0.07, B, 10, 2));
  return P.map((p) => scalePrim(p, PECTINODON_SCALE));
}

export const PECTINODON: Species = {
  id: "pectinodon",
  name: "Pectinodon",
  latin: "Pectinodon bakkeri",
  period: "Crétacé supérieur, 68-66 Ma",
  place: "Formations de Hell Creek et de Lance, Montana et Wyoming (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 40,
  facts: [
    { id: "peigne", title: "La « dent en peigne »", unlock: "discover",
      text: "« Pectinodon » veut dire « dent en peigne » : ses dents portent de grosses dentelures, comme les dents d'une scie ou d'un peigne. On ne le connaît presque que par ses dents ! Pour le reconstituer, on s'inspire de son proche cousin, le Troodon." },
    { id: "cerveau", title: "Un grand cerveau", unlock: "assemble",
      text: "Les troodontidés ont l'un des plus gros cerveaux par rapport à la taille du corps de tous les dinosaures, proche de celui de certains oiseaux actuels. Ce n'était pas un génie, mais sûrement un chasseur vif et habile." },
    { id: "yeux", title: "Des yeux pour la nuit", unlock: "eat",
      text: "Ses yeux étaient énormes et tournés vers l'avant, comme ceux d'une chouette. Ils captaient beaucoup de lumière : il chassait sans doute à la tombée du jour et la nuit, quand les grands dinosaures dormaient." },
    { id: "sommeil", title: "Il dormait comme un oiseau", unlock: "rest",
      text: "En Chine, on a trouvé Mei long, un petit troodontidé fossilisé en plein sommeil : pattes repliées, cou ramené en arrière et tête glissée sous le bras, exactement comme un oiseau qui dort. Son nom veut dire « dragon qui dort profondément »." },
    { id: "chasse", title: "Petit chasseur, gros appétit", unlock: "hunt",
      text: "Il chassait de petites proies : lézards, petits mammifères, bébés dinosaures... Il mangeait peut-être aussi des œufs, des insectes et des fruits. Sa petite griffe en faucille l'aidait à tenir ses proies." },
    { id: "nid", title: "Des œufs pondus par paires", unlock: "nest",
      text: "Les troodontidés pondaient leurs œufs deux par deux, presque debout dans le sol. Puis un parent s'asseyait dessus pour les couver, comme les oiseaux : on a retrouvé des Troodon sur leurs nids !" },
    { id: "poussin", title: "Des petits pressés de grandir", unlock: "baby",
      text: "Ses petits naissaient déjà bien formés et grandissaient très vite. Couverts de duvet, ils devaient courir et chasser des insectes peu après l'éclosion." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "vertebres", name: "Colonne et côtes" },
    { id: "bras", name: "Bras" },
    { id: "pattes", name: "Pattes" },
    { id: "queue", name: "Queue" },
    { id: "bassin", name: "Bassin" },
  ],
  model: pectinodonModel,
  skeleton: pectinodonSkeleton,
  center: { x: 8 * PECTINODON_SCALE, y: -84 * PECTINODON_SCALE },
  eye: { x: EYE.x * PECTINODON_SCALE, y: EYE.y * PECTINODON_SCALE },
  feet: [8, 12].map((x) => x * PECTINODON_SCALE),
  halfLen: 120 * PECTINODON_SCALE,
  shadow: 0.5,
  walkSpeed: 50,
  runSpeed: 190,
  stride: 11,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: ["pachy"], defense: "flee", sight: 380, scavenger: true },
};
