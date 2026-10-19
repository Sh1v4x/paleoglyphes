import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { VM } from "./velociraptor.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Velociraptor (Velociraptor mongoliensis), petit dromaeosaure du désert de Gobi, modélisé en
 * primitives (px locaux, regard vers la droite, origine au sol sous le bassin).
 * Grand comme une dinde : pattes courtes (~50 cm à la hanche), crâne bas et allongé au museau
 * relevé, corps entièrement emplumé, bras-ailes, et une longue queue raide (la moitié de sa
 * longueur) terminée en éventail. Le modèle brut mesure ~200 px de la queue au museau.
 */
const LENGTH_M = 2;
export const VELOCIRAPTOR_SCALE = (LENGTH_M * PX_PER_M) / 200;

function velociraptorRig({ action, actionT: t, time }: Pose): TheroRig {
  const r = { ...REST_RIG };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      // Course rasante : corps et queue à l'horizontale, tête tendue en avant.
      Object.assign(r, { pitch: 0.06, neck: 0.4, head: -0.2, stride: 1.6, tailUp: 4, crest: -0.4 });
      break;
    case "eat": {
      // Arrache de petits morceaux, la proie tenue sous une patte.
      const tug = Math.max(0, s);
      Object.assign(r, { pitch: 0.35 - tug * 0.08, neck: 1.0 - tug * 0.3, head: 0.5, jaw: 0.2 + tug * 0.5, dy: 4, stance: 6, tailUp: 10 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.35, neck: 1.1 + s * 0.06, head: 0.7, jaw: 0.05, dy: 5, tailUp: 10 });
      break;
    case "rest": {
      // Couché comme un oiseau, pattes repliées sous lui, cou ramené, queue enroulée.
      const br = Math.sin(time * 2.6) * 0.04;
      Object.assign(r, { dy: 30, pitch: -0.04, neck: -0.25 + br, head: 0.3, curl: 0.6, legs: "sit", closed: true });
      break;
    }
    case "attack": {
      // 0-0.25 accroupi, 0.25-0.65 bond faucilles en avant, ailes battantes pour l'équilibre,
      // 0.65-1 plaque la proie au sol et bat des ailes au-dessus d'elle.
      const crouch = win(t, 0, 0.25) * (1 - win(t, 0.3, 0.4));
      const air = win(t, 0.25, 0.4) * (1 - win(t, 0.6, 0.72));
      const pin = win(t, 0.6, 0.75);
      Object.assign(r, {
        dy: crouch * 10 - air * 30 + pin * 8,
        dx: air * 18 + pin * 22,
        pitch: -0.15 * crouch - 0.35 * air + 0.3 * pin,
        neck: 0.15 * crouch + 0.2 * air + 0.5 * pin,
        head: 0.1 + 0.3 * pin,
        jaw: 0.9 * Math.max(air, pin),
        arms: Math.max(air * (0.75 + 0.25 * Math.sin(t * 40)), pin * (0.7 + 0.3 * Math.sin(t * 40))),
        crest: Math.max(crouch, air),
        tailUp: 8 * air + 12 * pin,
        legs: air > 0.5 ? "air" : "stand",
        stance: 8 * pin,
      });
      break;
    }
    case "defend":
      // Ailes ouvertes, queue dressée, gueule ouverte : il se fait plus gros qu'il n'est.
      Object.assign(r, { pitch: -0.15, neck: 0.1, head: 0.2, jaw: 0.75 + 0.25 * s, arms: 1, crest: 1, tailUp: 14, stance: 10, dy: 2 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.2, neck: -0.7, head: -0.5, jaw: 0.55 + 0.45 * Math.abs(s), arms: 0.3, crest: 0.8, tailUp: -2 });
      break;
    case "dead":
      Object.assign(r, { dy: 36, pitch: 0.05, neck: 0.9, head: 0.1, jaw: 0.25, curl: 0.15, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -50 };
const NECK = { x: 22, y: -58 };
const NAPE = { x: 34, y: -72 };
const EYE = { x: 44, y: -77 };

export function velociraptorModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = velociraptorRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.8) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 2.5 * moving * r.stride + breath * 0.6;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Pattes courtes et robustes (cinématique inverse : la patte suit le bassin) ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 9 * r.stride;
    const m = L.far ? VM.Far : VM.Skin;
    const z = L.far ? -40 : 22;
    const hx = HIP.x + (L.far ? 3 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 5 + sw * 20 + (L.far ? -r.stance : r.stance), fy = -3 - lift;
    // Métatarse court et trapu : vecteur de la cheville vers la base des orteils.
    let mx = 8, my = 13 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 12 + (L.far ? 5 : 0); fy = -3; mx = 16; my = 2; }
    else if (r.legs === "air") { fx = hx + 26 + (L.far ? -5 : 3); fy = hy + 34; mx = 12; my = 9; }
    else if (r.legs === "lie") { fx = hx + 42 + (L.far ? -6 : 0); fy = -4 - (L.far ? 0 : 3); mx = 13; my = 2; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 3, ax, ay, 18, 21);
    // Cuisse emplumée, jambe, métatarse écailleux.
    P.push(e(hx, hy, 12, 14, m, z - 4, 10));
    P.push(c(hx, hy + 3, kx, ky, 8, 5, m, z, 8));
    P.push(c(kx, ky, ax, ay, 4.5, 3, m, z + 2, 5));
    P.push(c(ax, ay, fx, fy, 3, 2.2, L.far ? VM.Far : VM.Mark, z + 3, 4));
    // Orteils, griffe en faucille du deuxième orteil, relevée (ou braquée vers l'avant pendant le bond).
    const toeY = r.legs === "air" ? 5 : 1;
    P.push(c(fx - 2, fy, fx + 10, fy + toeY, 2.4, 1.5, m, z + 3, 3));
    const sk = r.legs === "air" ? [fx + 5, fy + 1, fx + 11, fy + 6] : [fx + 3, fy - 9, fx + 8, fy - 8];
    P.push(c(fx + 1, fy - 2, sk[0], sk[1], 1, 1, VM.Claw, z + 8, 2, true));
    P.push(c(sk[0], sk[1], sk[2], sk[3], 1, 1, VM.Claw, z + 8, 2, true));
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];

  // Longue queue raide (tiges osseuses) : presque droite, elle ne fait que pivoter à sa base.
  // Barres sombres, franges de plumes sur la seconde moitié, éventail au bout.
  const sway = Math.sin(time * 1.5) * 2 * (1 - moving) + Math.sin(walk) * 4 * moving;
  const tail: [number, number][] = [[-18, -54]];
  let ang = Math.PI + 0.04 + r.tailUp * 0.012 - r.pitch * 0.85 - sway * 0.01;
  for (let k = 1; k <= 7; k++) {
    // Rigide : courbure faible, sauf quand il s'enroule pour dormir.
    ang -= r.curl * 0.3 + sway * 0.001;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 14, Math.min(py + Math.sin(ang) * 14, -Math.max(2, 10 - k * 1.2) - by - 2)]);
  }
  for (let k = 0; k < 7; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(2, 10 - k * 1.2), rb = Math.max(2, 10 - (k + 1) * 1.2);
    B.push(c(ax, ay, qx, qy, ra, rb, VM.Skin, 2, 9));
    if (k % 2) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.4, 2.5, ra * 0.6, VM.Mark, 12, 3));
    if (k >= 3) {
      const nx = -(qy - ay) / 14, ny = (qx - ax) / 14;
      const w = 1.8 + (k - 3) * 0.5;
      B.push(c(ax - nx * (ra + w), ay - ny * (ra + w), qx - nx * (rb + w), qy - ny * (rb + w), w, w, VM.Wing, 1, 3));
      B.push(c(ax + nx * (ra + w), ay + ny * (ra + w), qx + nx * (rb + w), qy + ny * (rb + w), w, w, VM.Wing, 1, 3));
    }
  }
  const [tx, ty] = tail[7], [px7, py7] = tail[6];
  const tdx = (tx - px7) / 14, tdy = (ty - py7) / 14;
  for (let i = -2; i <= 2; i++) {
    B.push(c(tx - tdx * 4, ty - tdy * 4, tx + tdx * 14 - tdy * i * 4, ty + tdy * 14 + tdx * i * 4, 1, 1, i % 2 ? VM.Wing : VM.Feather, 18, 2, true));
  }

  // Corps compact, ventre pâle, barres sombres sur le dos.
  B.push(e(4, -54, 26, 12, VM.Skin, 0, 14));
  B.push(e(8, -46, 20, 5, VM.Belly, 8, 6, -47));
  for (let k = 0; k < 4; k++) B.push(e(-14 + k * 9, -64 + (k % 2) * 2, 2.5, 4, VM.Mark, 18, 3));
  // Plumes du dos.
  for (let k = 0; k < 5; k++) {
    const x = -18 + k * 9;
    B.push(c(x, -66, x - 7, -70 - (k % 2) * 2, 1, 1, VM.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.2 * moving;
  const H: Prim[] = [];
  const hx = 40, hy = -75 + hb;
  // Crâne bas et long ; museau étroit dont le bout se relève (profil du dessus concave).
  H.push(e(hx, hy, 9, 6.5, VM.Skin, 8, 8));
  H.push(c(hx + 6, hy + 1.5, hx + 26, hy - 1, 4.5, 2.2, VM.Skin, 8, 6));
  H.push(e(hx - 1, hy + 4, 6, 3, VM.Belly, 12, 4));
  H.push(c(hx + 1, hy - 1, hx + 12, hy - 0.5, 1, 1, VM.Mark, 14, 1, true));
  if (r.closed) H.push(c(EYE.x - 2, EYE.y + hb, EYE.x + 2, EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 2.5, 3, VM.Eye, 30, 1));
  for (let tx2 = hx + 8; tx2 <= hx + 22; tx2 += 5) H.push(e(tx2, hy + 5, 1.2, 1.6, M.Tooth, 16, 1));
  // Gueule ouverte : intérieur sombre, mâchoire inférieure abaissée.
  if (r.jaw > 0.1) H.push(e(hx + 12, hy + 6, 13, 4, M.Mouth, 12, 4, hy + 4));
  const J: Prim[] = [c(hx, hy + 6, hx + 24, hy + 4, 2.8, 1.8, VM.Skin, 6, 4)];
  if (r.jaw > 0.1) for (let tx2 = hx + 10; tx2 <= hx + 20; tx2 += 5) J.push(e(tx2, hy + 3.5, 1.1, 1.4, CM.ToothUp, 14, 1));
  else J.push(c(hx + 4, hy + 4, hx + 25, hy + 2.5, 1, 1, M.Mouth, 14, 1, true));
  H.push(...rot(J, hx, hy + 4, r.jaw * 0.55));
  // Plumes de la nuque : couchées, ou dressées.
  for (let i = 0; i < (r.legs === "lie" ? 0 : 3); i++) {
    const up = Math.max(0, r.crest), len = 10 - i * 2;
    const ox = hx - 7 - i * 3, oy = hy - 4 + i * 3;
    const dx = lerp(-0.92, -0.45, up), dy = lerp(-0.4 + i * 0.1, -0.9, up);
    H.push(c(ox, oy, ox + dx * len, oy + dy * len, 1, 1, i % 2 ? VM.Wing : VM.Feather, 20, 2, true));
  }
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 9, 6, VM.Skin, 6, 8),
    c(NECK.x + 5, NECK.y + 3, NAPE.x + 4, NAPE.y + 5 + hb, 4, 3, VM.Belly, 10, 5),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras-ailes : repliés le long du flanc, ou déployés (grandes rémiges barrées sur l'avant-bras).
  for (const far of [true, false]) {
    const m = far ? VM.Far : VM.Skin;
    const z = far ? -30 : 26;
    const a = r.arms;
    const sx = 22 + (far ? -3 : 0), sy = -54;
    const ex = sx + lerp(4, far ? 1 : 7, a), ey = sy + lerp(10, far ? -15 : -14, a);
    const flap = Math.sin(walk + (far ? 0 : 1)) * 1.5 * moving;
    const wx = ex + lerp(10, far ? 11 : 15, a), wy = ey + lerp(-1 + flap, far ? -7 : -4, a);
    const fl = lerp(9, 18, a);
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      const dx = lerp(-1, -0.35 + u * 0.15, a), dy = lerp(-0.2, 1, a);
      B.push(c(qx, qy, qx + dx * fl * (1 - u * 0.3 * a), qy + dy * fl * (1 - u * 0.3 * a), 1, 1, k % 2 ? VM.Mark : VM.Wing, z + 1, 1, true));
    }
    if (a > 0.3) B.push(e((ex + wx) / 2 - 2, (ey + wy) / 2 + 6 * a, 8, 7 * a, VM.Wing, z - 2, 4));
    B.push(c(sx, sy, ex, ey, 3.5, 2.5, m, z, 4));
    B.push(c(ex, ey, wx, wy, 2.5, 2, m, z, 3));
    for (let k = 0; k < 2; k++) B.push(c(wx, wy + k * 2, wx + 3, wy + 3 + k * 2, 1, 1, VM.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, VELOCIRAPTOR_SCALE));
}

/**
 * Squelette : chaque primitive porte l'id de son os (format : voir ankyloSkeleton).
 * Pose debout, regard à droite.
 */
export function velociraptorSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : bas et long, museau relevé, grande fenêtre antorbitaire, dents en lame recourbées.
  tag("crane",
    e(40, -75, 9, 6, B, 12, 6), c(46, -74, 66, -77, 4, 2, B, 12, 5),
    c(42, -69, 66, -73, 1.8, 1.2, B, 12, 2),
    e(44, -77, 2.8, 2.8, M.Socket, 30, 1), e(54, -75, 4, 2, M.Socket, 30, 1),
    ...[50, 55, 60].map((x) => e(x, -71, 1, 1.5, M.Tooth, 16, 1)));
  // Colonne : cou en S, dos horizontal jusqu'au bassin.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    spine.push(t < 0.35 ? [32 - t * 40, -72 + t * 46] : [18 - (t - 0.35) * 55, -56 + (t - 0.35) * 2]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 2.8, 2.4, B, 10, 3));
  // Côtes et gastralia (côtes du ventre), fines.
  for (let k = 4; k <= 8; k++) {
    const [x, y] = spine[k];
    tag("cotes", c(x, y + 2, x + 3, y + 10, 1, 1, B, 8, 2, true), c(x + 3, y + 10, x + 1, -42, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, pubis vers l'arrière comme chez les oiseaux.
  tag("bassin", e(0, -52, 13, 5, B, 12, 5), c(-2, -49, -9, -36, 2.4, 1.6, B, 12, 3), c(4, -49, 10, -43, 2.4, 1.6, B, 12, 3));
  // Bras : omoplate, fourchette (furcula), humérus, ulna à bosses de plumes, main à trois griffes.
  tag("bras",
    c(26, -60, 12, -63, 2, 1.6, B, 12, 2), c(26, -54, 29, -48, 1, 1, B, 14, 1, true),
    c(24, -54, 28, -44, 2, 1.6, B, 14, 2), c(28, -44, 40, -45, 1.6, 1.2, B, 14, 2),
    ...[32, 36].map((x) => e(x, -46, 1, 1, B, 18, 1)),
    ...[0, 2, 4].map((k) => c(40, -45 + k, 43, -42 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, métatarse court, orteils.
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -48, hx + 11, -34, 2.4, 2, B, z, 3), c(hx + 11, -34, hx - 2, -15, 2, 1.6, B, z, 2),
      c(hx - 2, -15, hx + 5, -3, 1.6, 1.2, B, z, 2), c(hx + 4, -2, hx + 15, -1, 1.2, 1, B, z, 1));
  }
  // Griffe en faucille du deuxième orteil, relevée.
  tag("griffe", c(8, -4, 10, -11, 1, 1, B, 20, 2, true), c(10, -11, 15, -10, 1, 1, B, 20, 2, true), e(8, -3, 1.6, 1.6, B, 20, 2));
  // Queue : vertèbres caudales gainées de tiges osseuses qui la rigidifient.
  for (let k = 0; k <= 11; k++) tag("queue", e(-16 - k * 8.5, -55 - k * 0.6, 2.6 - k * 0.08, 2 - k * 0.06, B, 10, 2));
  tag("queue", c(-26, -58, -110, -64, 1, 1, B, 10, 1, true), c(-26, -53, -110, -59, 1, 1, B, 10, 1, true));
  return P.map((p) => scalePrim(p, VELOCIRAPTOR_SCALE));
}

export const VELOCIRAPTOR: Species = {
  id: "velociraptor",
  name: "Velociraptor",
  latin: "Velociraptor mongoliensis",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Djadochta, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 15,
  facts: [
    { id: "taille", title: "Grand comme une dinde", unlock: "discover",
      text: "Dans les films, le Velociraptor est plus grand qu'un homme. Le vrai mesurait environ 2 mètres de long, dont la moitié pour la queue, et ne dépassait pas 50 cm à la hanche : à peu près la taille d'une grosse dinde, pour 15 kg environ." },
    { id: "plumes", title: "Des bosses à plumes", unlock: "assemble",
      text: "En 2007, des scientifiques ont repéré sur l'ulna (un os de l'avant-bras) d'un Velociraptor une rangée de petites bosses. Chez les oiseaux, ces bosses servent d'ancrage aux grandes plumes des ailes : le Velociraptor avait donc de vraies plumes !" },
    { id: "combattants", title: "Les dinosaures combattants", unlock: "attack",
      text: "En 1971, en Mongolie, on a découvert un Velociraptor et un Protoceratops fossilisés en plein combat : la griffe du raptor plantée dans le cou de sa proie, et son bras coincé dans le bec du Protoceratops. Ils ont sans doute été ensevelis d'un coup, peut-être par une dune de sable qui s'est effondrée." },
    { id: "nom", title: "Le « voleur rapide »", unlock: "hunt",
      text: "« Velociraptor » veut dire « voleur rapide ». Léger et agile, il chassait de petits animaux. Avec la grande griffe en faucille de son deuxième orteil, il clouait sa proie au sol, en battant des bras pour garder l'équilibre." },
    { id: "desert", title: "Un pays de dunes", unlock: "call",
      text: "Il vivait dans un paysage sec, plein de dunes de sable et de quelques points d'eau. Il y croisait des Protoceratops, des Citipati qui couvaient leurs œufs, des lézards et de petits mammifères." },
    { id: "charognard", title: "Il ne gâchait rien", unlock: "scavenge",
      text: "On a trouvé des os de Protoceratops portant des marques de dents de Velociraptor, avec même une dent cassée à côté. Il se nourrissait sans doute aussi de carcasses : un repas facile, sans danger." },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "vertebres", name: "Colonne vertébrale" },
    { id: "cotes", name: "Côtes et gastralia" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras et furcula" },
    { id: "pattes", name: "Pattes" },
    { id: "griffe", name: "Griffe en faucille" },
    { id: "queue", name: "Queue à tiges osseuses" },
  ],
  model: velociraptorModel,
  skeleton: velociraptorSkeleton,
  center: { x: 4 * VELOCIRAPTOR_SCALE, y: -54 * VELOCIRAPTOR_SCALE },
  eye: { x: EYE.x * VELOCIRAPTOR_SCALE, y: EYE.y * VELOCIRAPTOR_SCALE },
  feet: [6, 9].map((x) => x * VELOCIRAPTOR_SCALE),
  halfLen: 95 * VELOCIRAPTOR_SCALE,
  shadow: 0.45,
  walkSpeed: 55,
  runSpeed: 200,
  stride: 13,
  behavior: { diet: "carnivore", herd: [1, 3], browse: null, prey: ["protoceratops", "citipati"], defense: "bite", sight: 440, scavenger: true },
  biomes: [BIOME.Desert],
};
