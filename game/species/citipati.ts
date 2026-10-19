import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { CIM } from "./citipati.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Citipati (Citipati osmolskae), oviraptoridé du désert de Gobi, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Silhouette d'émeu : long cou,
 * crâne court et haut coiffé d'une grande crête arrondie, bec de perroquet sans dents, longues pattes,
 * bras emplumés comme des ailes, queue courte terminée par un éventail de plumes.
 * Le modèle brut mesure ~205 px de la queue au bec.
 */
const LENGTH_M = 2.9;
export const CITIPATI_SCALE = (LENGTH_M * PX_PER_M) / 205;

/** Gréement du raptor, plus : ailes étalées en couveuse (0..1) et plumage gonflé. */
interface OviRig extends TheroRig {
  brood: number;
  fluff: number;
}

function citipatiRig({ action, actionT: t, time }: Pose): OviRig {
  const r: OviRig = { ...REST_RIG, brood: 0, fluff: 0 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "run":
      Object.assign(r, { pitch: 0.14, neck: 0.55, head: -0.4, stride: 1.5, tailUp: 4, arms: 0.15 });
      break;
    case "eat": {
      // Broute les plantes basses : cou plongé, coups de bec qui arrachent feuilles et graines.
      const nip = Math.pow(Math.abs(Math.sin(t * Math.PI * 3)), 3);
      Object.assign(r, { pitch: 0.4, neck: 1.25 + nip * 0.2, head: 0.5 + nip * 0.15, jaw: 0.1 + (1 - nip) * 0.5, dy: 6, stance: 6, tailUp: 10 });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.45, neck: 1.45 + s * 0.06, head: 0.75, jaw: 0.05, dy: 10, tailUp: 10 });
      break;
    case "rest": {
      // Couve comme les fossiles de « Big Mama » : accroupi au ras du sol, bras emplumés grands ouverts
      // en couronne au-dessus des œufs, cou dressé et tête aux aguets.
      const br = Math.sin(time * 2.2) * 0.03;
      Object.assign(r, { dy: 52, pitch: -0.04, neck: -0.1 + br, head: 0.1, legs: "sit", brood: 1, fluff: 0.5, tailUp: 4 });
      break;
    }
    case "attack": {
      // Coup de bec et coup de patte : se ramasse, ailes ouvertes, puis frappe vers l'avant.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.45));
      const hit = win(t, 0.35, 0.5) * (1 - win(t, 0.75, 1));
      Object.assign(r, {
        dy: wind * 8, dx: hit * 14,
        pitch: -0.1 * wind + 0.25 * hit,
        neck: -0.4 * wind + 0.9 * hit,
        head: 0.2 * hit,
        jaw: 0.8 * Math.max(wind, hit),
        arms: Math.max(wind, hit * (0.7 + 0.3 * Math.sin(t * 40))),
        crest: Math.max(wind, hit),
        tailUp: 12 * Math.max(wind, hit),
        stance: 8 * hit,
      });
      break;
    }
    case "defend":
      // Ailes grandes ouvertes, plumage gonflé, éventail de la queue dressé : il impressionne puis file.
      Object.assign(r, { pitch: -0.12, neck: -0.2, head: 0.15, jaw: 0.6 + 0.3 * s, arms: 1, crest: 1, tailUp: 18, stance: 12, dy: 2, fluff: 1 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.18, neck: -0.45, head: -0.7, jaw: 0.5 + 0.45 * Math.abs(s), arms: 0.35, crest: 0.8, tailUp: 6, fluff: 0.3 });
      break;
    case "dead":
      Object.assign(r, { dy: 66, pitch: 0.06, neck: 1.6, head: 0.2, jaw: 0.3, curl: 0.2, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -84 };
const NECK = { x: 30, y: -98 };
const NAPE = { x: 58, y: -138 };
const EYE = { x: 68, y: -145 };

export function citipatiModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = citipatiRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.9) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Longues pattes de coureur (cinématique inverse), sans griffe en faucille ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 14 * r.stride;
    const m = L.far ? CIM.Far : CIM.Skin;
    const z = L.far ? -40 : 22;
    const hx = HIP.x + (L.far ? 4 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 6 + sw * 32 + (L.far ? -r.stance : r.stance), fy = -3 - lift;
    let mx = 10, my = 28 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 22 + (L.far ? 6 : 0); fy = -3; mx = 30; my = 3; }
    else if (r.legs === "lie") { fx = hx + 74 + (L.far ? -8 : 0); fy = -5 - (L.far ? 0 : 4); mx = 24; my = 3; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 4, ax, ay, 30, 34);
    // Cuisse emplumée (« culotte » d'émeu), jambe fine, métatarse écailleux, trois orteils.
    P.push(e(hx, hy, 16, 20, m, z - 4, 12));
    P.push(c(hx, hy + 4, kx, ky, 11, 6, m, z, 9));
    P.push(c(kx, ky, ax, ay, 5, 3.2, m, z + 2, 5));
    P.push(c(ax, ay, fx, fy, 3.2, 2.4, L.far ? CIM.Far : CIM.Mark, z + 3, 4));
    P.push(c(fx - 2, fy, fx + 13, fy + 1.5, 2.8, 1.8, m, z + 3, 3));
    P.push(c(fx + 12, fy + 0.5, fx + 15, fy + 2, 1, 1, CIM.Claw, z + 8, 1, true));
  }

  // --- Corps, queue, cou, tête et ailes : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];
  const puff = r.fluff * 4;
  // Sol, dans le repère du corps (avant rotation) : les plumes de couvaison s'y arrêtent.
  const ground = -by - 2;

  // Queue courte et emplumée, terminée par un éventail de grandes plumes (parade).
  const sway = Math.sin(time * 1.5) * 3 * (1 - moving) + Math.sin(walk) * 5 * moving;
  const tail: [number, number][] = [[-26, -94]];
  let ang = Math.PI - 0.05 - r.tailUp * 0.012 - r.pitch * 0.85;
  for (let k = 1; k <= 4; k++) {
    ang -= r.curl * 0.3 + sway * 0.006 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 13, py + Math.sin(ang) * 13]);
  }
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    B.push(c(ax, ay, qx, qy, 13 - k * 2.5, 11 - k * 2.5, CIM.Skin, 2, 10));
  }
  const [tx, ty] = tail[4], [px4, py4] = tail[3];
  const tdx = (tx - px4) / 13, tdy = (ty - py4) / 13;
  const fan = 5 + r.fluff * 3 + Math.max(0, r.tailUp) * 0.15;
  for (let i = -3; i <= 3; i++) {
    const len = 22 - Math.abs(i) * 2;
    B.push(c(tx - tdx * 6, ty - tdy * 6, tx + tdx * len - tdy * i * fan, ty + tdy * len + tdx * i * fan, 1, 1, i % 2 ? CIM.Wing : CIM.Feather, 18, 2, true));
  }

  // Corps d'émeu, haut et rond (plus gonflé quand il couve ou se défend), ventre pâle.
  B.push(e(4, -92, 34 + puff, 22 + puff, CIM.Skin, 0, 20));
  B.push(e(12, -78 + puff * 0.5, 26, 8 + puff * 0.5, CIM.Belly, 8, 8, -79));
  // Plumes du dos, lâches comme celles d'un émeu, hérissées quand il gonfle son plumage.
  for (let k = 0; k < 7; k++) {
    const x = -26 + k * 9;
    const y = -110 - puff + Math.abs(x - 4) * 0.18;
    B.push(c(x, y, x - 9 + r.fluff * 3, y - 3 - (k % 2) * 3 - r.fluff * 5, 1, 1, CIM.Feather, 22, 2, true));
  }

  // Cou et tête (la tête tourne autour de la nuque, puis le tout autour de la base du cou).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 64, hy = -143 + hb;
  // Crâne court et haut, gorge pâle, œil rond.
  H.push(e(hx, hy, 13, 11, CIM.Skin, 8, 12));
  H.push(e(hx - 1, hy + 7, 8, 4, CIM.Belly, 12, 6));
  if (r.closed) H.push(c(EYE.x - 3, EYE.y + hb, EYE.x + 3, EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 3.5, 4, CIM.Eye, 30, 1));
  // Grande crête arrondie, dressée au-dessus du bec (encore plus haute quand il parade).
  const up = Math.max(0, r.crest) * 3;
  H.push(e(hx + 9, hy - 15 - up * 0.5, 9, 12 + up * 0.5, CIM.Crest, 10, 8, undefined, hy - 4));
  H.push(e(hx + 4, hy - 8, 7, 5, CIM.Crest, 9, 6));
  // Bec de perroquet, court et crochu, sans aucune dent.
  H.push(c(hx + 10, hy - 2, hx + 22, hy + 2, 6, 3.5, CIM.Beak, 14, 6));
  H.push(c(hx + 22, hy + 2, hx + 24, hy + 8, 3.5, 1.4, CIM.Beak, 15, 4));
  if (r.jaw > 0.1) H.push(e(hx + 13, hy + 6, 7, 3, M.Mouth, 12, 3, hy + 4));
  const J: Prim[] = [c(hx + 6, hy + 6, hx + 18, hy + 6, 3, 1.6, CIM.Beak, 13, 4)];
  if (r.jaw <= 0.1) J.push(c(hx + 8, hy + 4.5, hx + 19, hy + 4.5, 1, 1, CIM.Mark, 16, 1, true));
  H.push(...rot(J, hx + 6, hy + 5, r.jaw * 0.6));
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 12 + puff * 0.5, 6.5, CIM.Skin, 6, 10),
    c(NECK.x + 7, NECK.y + 4, NAPE.x + 5, NAPE.y + 6 + hb, 5.5, 3.5, CIM.Belly, 10, 6),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras-ailes : repliés le long du flanc, déployés (défense), ou étalés en couveuse : l'aile proche
  // vers l'avant, la lointaine vers l'arrière, et leurs longues plumes tombent jusqu'au sol en jupe.
  for (const far of [true, false]) {
    const m = far ? CIM.Far : CIM.Skin;
    const z = far ? -30 : 28;
    const a = r.arms, b = r.brood;
    const sx = 32 + (far ? -4 : 0), sy = -90;
    let ex = sx + lerp(4, far ? 2 : 10, a), ey = sy + lerp(14, far ? -20 : -18, a);
    const flap = Math.sin(walk + (far ? 0 : 1)) * 2 * moving;
    let wx = ex + lerp(14, far ? 14 : 20, a), wy = ey + lerp(-2 + flap, far ? -10 : -6, a);
    if (b > 0) {
      ex = lerp(ex, far ? sx - 22 : sx + 16, b); ey = lerp(ey, sy + 10, b);
      wx = lerp(wx, far ? sx - 60 : sx + 40, b); wy = lerp(wy, sy + 16, b);
    }
    const fl = lerp(lerp(16, 28, a), 0, b) + r.fluff * 2;
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      const qx = lerp(ex, wx, u), qy = lerp(ey, wy, u);
      let dx = lerp(-1, -0.3 + u * 0.15, a), dy = lerp(-0.15, 1, a);
      let len = fl * (1 - u * 0.3 * a);
      if (b > 0.5) { dx = (far ? -0.25 : 0.25) * u; dy = 1; len = Math.max(4, ground - qy); }
      B.push(c(qx, qy, qx + dx * len, qy + dy * len, 1, 1, k % 2 ? CIM.Feather : CIM.Wing, z + 1, 1, true));
    }
    if (a > 0.3) B.push(e((ex + wx) / 2 - 3, (ey + wy) / 2 + 8 * a, 11, 9 * a, CIM.Wing, z - 2, 4));
    if (b > 0.5) {
      // Rideau de plumes entre le bras et le sol (les œufs sont dessous).
      const top = Math.min(ey, wy), h = (ground - top) / 2;
      B.push(e((ex + wx) / 2, top + h, Math.abs(wx - ex) / 2 + 3, h, CIM.Wing, z - 2, 4));
    }
    B.push(c(sx, sy, ex, ey, 4.5, 3.2, m, z, 4));
    B.push(c(ex, ey, wx, wy, 3.2, 2.2, m, z, 3));
    for (let k = 0; k < 3; k++) B.push(c(wx, wy + k * 2, wx + 4, wy + 4 + k * 2, 1, 1, CIM.Claw, z + 4, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, CITIPATI_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne à crête, cou, dos et côtes, bassin, bras et furcula, pattes, queue.
 */
export function citipatiSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : court et haut, crête osseuse creuse, grandes fenêtres, bec sans dents.
  tag("crane",
    e(66, -150, 11, 9, B, 12, 8),
    e(74, -164, 6, 10, B, 12, 6), c(66, -158, 78, -172, 2, 2, B, 12, 2),
    c(74, -152, 88, -146, 3.5, 2, B, 12, 3), c(88, -146, 89, -141, 2, 1, B, 12, 2),
    c(70, -143, 84, -143, 2.5, 1.5, B, 12, 2),
    e(68, -152, 4, 4, M.Socket, 30, 1), e(75, -164, 2.5, 5, M.Socket, 30, 1), e(78, -149, 3, 2, M.Socket, 30, 1));
  // Cou : long, vertèbres qui montent en S jusqu'au crâne.
  for (let k = 0; k <= 7; k++) {
    const t = k / 7;
    tag("cou", e(32 + t * 26 + Math.sin(t * Math.PI) * 4, -100 - t * 44, 3.4 - t * 0.6, 2.8 - t * 0.4, B, 10, 3));
  }
  // Dos court et côtes.
  for (let k = 0; k <= 6; k++) tag("vertebres", e(26 - k * 7, -102 + k * 0.6, 3.2, 2.8, B, 10, 3));
  for (let k = 1; k <= 5; k++) {
    const x = 24 - k * 7;
    tag("vertebres", c(x, -100, x + 4, -80 + k, 1, 1, B, 8, 2, true));
  }
  // Bassin : ilion allongé, pubis vers l'avant et le bas.
  tag("bassin", e(-2, -96, 16, 6, B, 12, 6), c(0, -92, 8, -74, 2.6, 2, B, 12, 3), c(-6, -92, -14, -78, 2.4, 2, B, 12, 3));
  // Bras : omoplate, furcula en V, humérus, avant-bras, longue main à trois doigts griffus.
  tag("bras",
    c(36, -104, 20, -104, 2.2, 1.8, B, 12, 2),
    c(40, -94, 44, -86, 1.5, 1.5, B, 14, 2),
    c(34, -96, 38, -82, 2.3, 1.9, B, 14, 2), c(38, -82, 52, -84, 1.9, 1.5, B, 14, 2),
    ...[0, 2, 4].map((k) => c(52, -84 + k, 60, -80 + k, 1, 1, B, 18, 1, true)));
  // Pattes : fémur, tibia, long métatarse, orteils.
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -84, hx + 18, -60, 3, 2.4, B, z, 3), c(hx + 18, -60, hx - 4, -30, 2.4, 1.9, B, z, 2),
      c(hx - 4, -30, hx + 6, -4, 1.9, 1.4, B, z, 2), c(hx + 5, -3, hx + 19, -2, 1.4, 1, B, z, 1));
  }
  // Queue courte : vertèbres qui s'affinent, bout soudé.
  for (let k = 0; k <= 7; k++) tag("queue", e(-24 - k * 8, -96 + k * 0.6, 3 - k * 0.2, 2.4 - k * 0.12, B, 10, 2));
  tag("queue", c(-84, -92, -94, -90, 2, 1.2, B, 10, 2));
  return P.map((p) => scalePrim(p, CITIPATI_SCALE));
}

export const CITIPATI: Species = {
  id: "citipati",
  name: "Citipati",
  latin: "Citipati osmolskae",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Djadochta, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 75,
  facts: [
    { id: "voleur", title: "Le faux voleur d'œufs", unlock: "discover",
      text: "En 1924, on a trouvé son cousin Oviraptor près d'œufs que l'on croyait être ceux du Protoceratops. On l'a donc appelé « voleur d'œufs ». Mais en 1993, on a découvert un bébé oviraptoridé dans un de ces œufs : c'étaient ses propres œufs ! Ce n'était pas un voleur, mais un parent." },
    { id: "bec", title: "Un bec sans dents", unlock: "assemble",
      text: "Le Citipati n'avait aucune dent : juste un bec corné, court et crochu, comme celui d'un perroquet. Ses mâchoires puissantes pouvaient casser des graines, des fruits durs ou des coquilles." },
    { id: "couveur", title: "Il couvait sur son nid", unlock: "rest",
      text: "En Mongolie, on a trouvé plusieurs Citipati fossilisés assis sur leur nid, les bras emplumés grands ouverts au-dessus des œufs, exactement comme un oiseau qui couve. Le plus célèbre a été surnommé « Big Mama ». C'était peut-être même un papa !" },
    { id: "bleu", title: "Des œufs bleu-vert", unlock: "nest",
      text: "En étudiant la coquille d'œufs d'oviraptoridés, des chercheurs y ont trouvé les mêmes pigments que dans les œufs d'oiseaux. Leurs œufs étaient bleu-vert, comme ceux de l'émeu ! Ils étaient longs et rangés par paires, en cercle." },
    { id: "menu", title: "Un menu varié", unlock: "eat",
      text: "Dans le désert, il mangeait sûrement un peu de tout : feuilles, graines, fruits, et peut-être de petits animaux ou des œufs. On dit qu'il était omnivore." },
    { id: "nom", title: "Un nom de gardien", unlock: "call",
      text: "Dans la tradition bouddhiste tibétaine, Citipati est un couple de squelettes dansants, des gardiens protecteurs. Un beau nom pour un dinosaure retrouvé en train de protéger ses œufs ! Sa haute crête servait sans doute à se faire remarquer." },
  ],
  bones: [
    { id: "crane", name: "Crâne à crête" },
    { id: "cou", name: "Long cou" },
    { id: "vertebres", name: "Dos et côtes" },
    { id: "bassin", name: "Bassin" },
    { id: "bras", name: "Bras et furcula" },
    { id: "pattes", name: "Pattes" },
    { id: "queue", name: "Queue courte" },
  ],
  model: citipatiModel,
  skeleton: citipatiSkeleton,
  center: { x: 8 * CITIPATI_SCALE, y: -96 * CITIPATI_SCALE },
  eye: { x: EYE.x * CITIPATI_SCALE, y: EYE.y * CITIPATI_SCALE },
  feet: [8, 12].map((x) => x * CITIPATI_SCALE),
  halfLen: 100 * CITIPATI_SCALE,
  shadow: 0.5,
  walkSpeed: 55,
  runSpeed: 200,
  stride: 10,
  behavior: { diet: "omnivore", herd: [1, 2], browse: "low", prey: [], defense: "flee", sight: 380, scavenger: false },
  biomes: [BIOME.Desert],
};
