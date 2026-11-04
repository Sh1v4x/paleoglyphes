import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { BIOME } from "../world/biomes";
import { CM } from "./carnivores.mat";
import { SM } from "./shuvuuia.mat";
import { REST_RIG, c, e, knee, lerp, rot, win, type TheroRig } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Shuvuuia (Shuvuuia deserti), minuscule alvarezsaure du désert de Gobi, modélisé en primitives
 * (px locaux, regard vers la droite, origine au sol sous le bassin). Grand comme un poulet :
 * tout petit corps perché sur de très longues pattes fines, long museau mince, bras ridiculement
 * courts terminés par un seul gros doigt griffu, plumage de sable, grand œil de chasseur nocturne.
 * Le modèle brut mesure ~225 px de la queue au museau.
 *
 * À taille réelle il ne fait que quelques cellules : pattes et museau sont doublés d'un trait fin
 * (plus bas que les volumes) qui reste visible quand les volumes deviennent trop minces.
 */
const LENGTH_M = 0.6;
export const SHUVUUIA_SCALE = (LENGTH_M * PX_PER_M) / 225;

/** Gréement du théropode, plus : coup de griffe du pouce (0..1) et plumage gonflé. */
interface ShuvRig extends TheroRig {
  dig: number;
  fluff: number;
}

function shuvuuiaRig({ action, actionT: t, time }: Pose): ShuvRig {
  const r: ShuvRig = { ...REST_RIG, dig: 0, fluff: 0 };
  const s = Math.sin(t * Math.PI * 2);
  switch (action) {
    case "idle":
      // Aux aguets : petits mouvements de tête saccadés, comme un oiseau qui écoute.
      r.head = Math.round(Math.sin(time * 1.3) * 2) * 0.08;
      break;
    case "run": {
      // Course en flèche, corps à l'horizontale, tête tendue ; petits écarts brusques.
      const dart = Math.sign(Math.sin(time * 5)) * 0.06;
      Object.assign(r, { pitch: 0.12 + dart, neck: 0, head: -0.12, stride: 1.8, tailUp: 4, crest: -0.4 });
      break;
    }
    case "eat": {
      // Sonde le sable du bout du museau, par petits coups rapides (insectes, larves).
      const peck = Math.pow(Math.abs(Math.sin(t * Math.PI * 4)), 3);
      Object.assign(r, { pitch: 0.45, neck: 0.5 + peck * 0.15, head: -0.05 + peck * 0.1, jaw: 0.1 + (1 - peck) * 0.3, dy: 10, stance: 6, tailUp: 10, dig: 0.3 * (1 - peck) });
      break;
    }
    case "drink":
      Object.assign(r, { pitch: 0.45, neck: 0.6 + s * 0.04, head: 0, jaw: 0.05, dy: 10, tailUp: 10 });
      break;
    case "rest": {
      // Accroupi en boule de plumes, cou ramené, tête posée sur le dos, queue enroulée.
      const br = Math.sin(time * 2.6) * 0.03;
      Object.assign(r, { dy: 88, pitch: -0.05, neck: -2.9 + br, head: -0.2, curl: 1, legs: "sit", closed: true, fluff: 0.5 });
      break;
    }
    case "attack": {
      // 0-0.6 : penché sur la termitière, il la fend à grands coups de griffe du pouce ;
      // 0.6-1 : plonge le museau dans la brèche et happe les insectes.
      const lean = win(t, 0, 0.12);
      const stab = (1 - win(t, 0.55, 0.65)) * Math.pow(Math.abs(Math.sin(t * Math.PI * 7)), 2);
      const snap = win(t, 0.6, 0.72);
      Object.assign(r, {
        dy: lean * 45,
        pitch: 0.75 * lean,
        neck: lerp(-0.5 * lean, -0.06, snap) + snap * Math.max(0, Math.sin(t * 30)) * 0.12,
        head: -0.2 * lean,
        jaw: snap * (0.5 + 0.5 * Math.abs(Math.sin(t * 24))),
        dig: lean * (1 - snap) * (0.4 + 0.6 * stab),
        stance: 10 * lean,
        tailUp: 12 * lean,
      });
      break;
    }
    case "defend":
      // Plumage gonflé, queue dressée, bec ouvert, griffes du pouce en avant : il siffle.
      Object.assign(r, { pitch: -0.18, neck: -0.1, head: 0.2, jaw: 0.6 + 0.3 * s, arms: 1, crest: 1, tailUp: 20, stance: 12, fluff: 1 });
      break;
    case "call":
      Object.assign(r, { pitch: -0.15, neck: -0.5, head: -0.25, jaw: 0.5 + 0.45 * Math.abs(s), crest: 0.8, tailUp: -2, fluff: 0.3 });
      break;
    case "dead":
      Object.assign(r, { dy: 104, pitch: 0.05, neck: 0.1, head: 0, jaw: 0.25, curl: 0.2, legs: "lie", closed: true });
      break;
    default:
      break;
  }
  return r;
}

/** Bassin (pivot du corps), base du cou, nuque et œil, px bruts. */
const HIP = { x: 0, y: -118 };
const NECK = { x: 22, y: -128 };
const NAPE = { x: 50, y: -136 };
const EYE = { x: 72, y: -135 };

export function shuvuuiaModel(pose: Pose): Prim[] {
  const { walk, moving, time } = pose;
  const r = shuvuuiaRig(pose);
  const breath = Math.sin((time * Math.PI * 2) / 0.6) * (1 - moving);
  const bob = -Math.abs(Math.cos(walk)) * 3 * moving * r.stride + breath * 0.8;
  const bx = r.dx, by = r.dy + bob;
  const P: Prim[] = [];

  // --- Très longues pattes fines (cinématique inverse), doublées d'un trait fin ---
  for (const L of [{ phase: 0, far: true }, { phase: Math.PI, far: false }]) {
    const ph = walk + L.phase;
    const sw = Math.sin(ph) * moving * r.stride;
    const lift = Math.max(0, Math.cos(ph)) * moving * 14 * r.stride;
    const m = L.far ? SM.Far : SM.Skin;
    const z = L.far ? -40 : 22;
    const hx = HIP.x + (L.far ? 4 : 0) + bx, hy = HIP.y + by;
    let fx = hx + 4 + sw * 26 + (L.far ? -r.stance : r.stance), fy = -3 - lift;
    // Métatarse très long (coureur) : vecteur de la cheville vers les orteils.
    let mx = 10, my = 40 - lift * 0.3;
    if (r.legs === "sit") { fx = hx + 20 + (L.far ? 6 : 0); fy = -3; mx = 32; my = 3; }
    else if (r.legs === "lie") { fx = hx + 70 + (L.far ? -10 : 0); fy = -5 - (L.far ? 0 : 5); mx = 26; my = 3; }
    const ax = fx - mx, ay = fy - my;
    const [kx, ky] = knee(hx, hy + 4, ax, ay, 36, 50);
    // Cuisse emplumée, jambe et métatarse fins, orteils griffus.
    P.push(e(hx, hy, 12, 15, m, z - 4, 10));
    P.push(c(hx, hy + 4, kx, ky, 8, 4, m, z, 8));
    P.push(c(kx, ky, ax, ay, 3.5, 2.5, L.far ? SM.Far : SM.Leg, z + 2, 4));
    P.push(c(ax, ay, fx, fy, 2.5, 2, L.far ? SM.Far : SM.Leg, z + 3, 3));
    P.push(c(fx - 3, fy, fx + 11, fy + 1.5, 2.2, 1.4, L.far ? SM.Far : SM.Leg, z + 3, 3));
    // Trait fin sous les volumes : la patte reste lisible à taille réelle.
    const lz = L.far ? -70 : -20;
    if (r.legs === "stand") {
      P.push(c(kx, ky, ax, ay, 1, 1, L.far ? SM.Far : SM.Leg, lz, 1, true));
      // (arrêté au-dessus du pied : sinon le trait déborde sous le sol)
      P.push(c(ax, ay, lerp(ax, fx, 0.6), lerp(ay, fy, 0.6), 1, 1, L.far ? SM.Far : SM.Leg, lz, 1, true));
    }
  }

  // --- Corps, queue, cou, tête et bras : construits au repos puis tournés autour du bassin ---
  const B: Prim[] = [];
  const puff = r.fluff * 5;

  // Queue assez longue et fine, emplumée, légèrement barrée.
  const sway = Math.sin(time * 1.9) * 3 * (1 - moving) + Math.sin(walk) * 5 * moving;
  const tail: [number, number][] = [[-20, -126]];
  let ang = Math.PI + 0.08 + r.tailUp * 0.01 - r.pitch * 0.85;
  for (let k = 1; k <= 6; k++) {
    ang -= r.curl * 0.42 + sway * 0.005 * k - r.tailUp * 0.002;
    const [px, py] = tail[k - 1];
    tail.push([px + Math.cos(ang) * 13, Math.min(py + Math.sin(ang) * 13, -Math.max(2, 9 - k) - by - 2)]);
  }
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = tail[k], [qx, qy] = tail[k + 1];
    const ra = Math.max(2, 10 - k * 1.4) + puff * 0.3, rb = Math.max(2, 10 - (k + 1) * 1.4) + puff * 0.3;
    B.push(c(ax, ay, qx, qy, ra, rb, SM.Skin, 2, 8));
    if (k % 2) B.push(e((ax + qx) / 2, (ay + qy) / 2 - ra * 0.4, 2.2, ra * 0.5, SM.Bar, 10, 2));
  }
  // Plumes au bout de la queue (traits fins), écartées quand il gonfle son plumage.
  const [tx, ty] = tail[6], [px6, py6] = tail[5];
  const tdx = (tx - px6) / 13, tdy = (ty - py6) / 13;
  for (let i = -1; i <= 1; i++) {
    const f = r.fluff * 6;
    B.push(c(tx - tdx * 3, ty - tdy * 3, tx + tdx * 14 - tdy * i * f, ty + tdy * 14 + tdx * i * f, 1, 1, SM.Feather, -12, 2, true));
  }

  // Tout petit corps rond (plus gonflé quand il se défend ou dort), ventre blanc, barres pâles.
  B.push(e(4, -123, 25 + puff, 18 + puff, SM.Skin, 0, 16));
  B.push(e(8, -110 + puff * 0.5, 18, 5 + puff * 0.5, SM.Belly, 8, 6, -111));
  for (let k = 0; k < 3; k++) B.push(e(-10 + k * 11, -133 - puff + (k % 2) * 3, 2.2, 3.5, SM.Bar, 18, 2));
  // Plumes du dos hérissées (défense) : traits fins sous les volumes, pour ne pas les masquer en petit.
  for (let k = 0; k < (r.fluff > 0.6 ? 4 : 0); k++) {
    const x = -14 + k * 9, y = -137 - puff;
    B.push(c(x, y, x - 4, y - 8 - (k % 2) * 2, 1, 1, SM.Feather, -12, 2, true));
  }

  // Cou fin, petite tête ronde au grand œil, long museau mince (la tête tourne autour de la nuque).
  const hb = Math.sin(walk * 2) * 1.5 * moving;
  const H: Prim[] = [];
  const hx = 66, hy = -133 + hb;
  H.push(e(hx, hy, 11, 9, SM.Skin, 8, 10));
  // Face et gorge blanches.
  H.push(e(hx + 4, hy + 5, 9, 4.5, SM.Belly, 12, 6));
  if (r.closed) H.push(c(EYE.x - 4, EYE.y + hb, EYE.x + 4, EYE.y + hb, 1, 1, CM.Lid, 30, 1, true));
  else H.push(e(EYE.x, EYE.y + hb, 7, 7.5, SM.Eye, 30, 1));
  // Museau : volume effilé doublé d'un trait fin (lisible à taille réelle).
  H.push(c(hx + 6, hy + 1, hx + 64, hy + 6, 5, 1.6, SM.Snout, 10, 5));
  H.push(c(hx + 14, hy + 3, hx + 62, hy + 6, 1, 1, SM.Snout, -10, 1, true));
  for (let tx2 = hx + 22; tx2 <= hx + 54; tx2 += 8) H.push(e(tx2, hy + 6, 0.9, 1.2, M.Tooth, 14, 1));
  // Mâchoire inférieure, fine comme une pince.
  if (r.jaw > 0.1) H.push(e(hx + 26, hy + 8, 22, 3.5, M.Mouth, 6, 3, hy + 6));
  const J: Prim[] = [c(hx + 4, hy + 7, hx + 58, hy + 9, 2.8, 1.1, SM.Snout, 8, 3)];
  H.push(...rot(J, hx + 4, hy + 6, r.jaw * 0.4));
  // Plumes de la nuque dressées (cri, défense).
  for (let i = 0; i < (r.crest > 0.3 ? 2 : 0); i++) {
    const up = Math.max(0, r.crest), len = 9 - i * 2;
    const ox = hx - 8 - i * 3, oy = hy - 4 + i * 4;
    const dx = lerp(-0.92, -0.45, up), dy = lerp(-0.4 + i * 0.1, -0.9, up);
    H.push(c(ox, oy, ox + dx * len, oy + dy * len, 1, 1, SM.Feather, -12, 2, true));
  }
  const N: Prim[] = [
    c(NECK.x, NECK.y, NAPE.x, NAPE.y + hb, 8 + puff * 0.5, 5.5, SM.Skin, 6, 8),
    c(NECK.x + 5, NECK.y + 4, NAPE.x + 5, NAPE.y + 6 + hb, 4, 3, SM.Belly, 10, 5),
    ...rot(H, NAPE.x, NAPE.y, r.head),
  ];
  B.push(...rot(N, NECK.x, NECK.y, r.neck));

  // Bras minuscules et trapus, un seul gros doigt griffu (le pouce). Pour creuser, le bras se
  // tend vers le bas et la griffe frappe le sol.
  for (const far of [true, false]) {
    const m = far ? SM.Far : SM.Skin;
    const z = far ? -30 : 26;
    const reach = Math.max(r.dig, r.arms * 0.5);
    const sx = 22 + (far ? -3 : 0), sy = -120;
    const ex = sx + lerp(4, 10, reach), ey = sy + lerp(8, 12, reach);
    const wx = ex + lerp(7, 9, reach) - r.arms * 2, wy = ey + lerp(-1, 8, reach) - r.arms * 6;
    B.push(c(sx, sy, ex, ey, 4, 3.2, m, z, 4));
    B.push(c(ex, ey, wx, wy, 3.2, 2.6, m, z, 3));
    // La grosse griffe du pouce : un croc recourbé, bien plus grand que la main.
    const cl = 10 + reach * 2;
    const cdx = lerp(0.55, 0.9, r.dig), cdy = lerp(0.85, 0.5, r.dig);
    B.push(c(wx, wy, wx + cdx * cl, wy + cdy * cl, 2.2, 0.8, far ? SM.Far : SM.Claw, z + 2, 2));
    B.push(c(wx, wy, wx + cdx * cl, wy + cdy * cl, 1, 1, SM.Claw, -60, 1, true));
  }

  P.push(...rot(B, HIP.x, HIP.y, r.pitch, bx, by));
  return P.map((p) => scalePrim(p, SHUVUUIA_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton). Pose debout, regard à droite.
 * Os : crâne, colonne, sternum, bras et griffe du pouce, bassin, pattes, queue.
 * Les os longs sont doublés d'un trait fin (plus bas) : ils restent visibles en petit.
 */
export function shuvuuiaSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));
  const line = (ax: number, ay: number, bx: number, by: number) => c(ax, ay, bx, by, 1, 1, B, -40, 1, true);

  // Crâne léger d'oiseau : boîte crânienne ronde, orbite immense, museau long et mince, dents minuscules.
  tag("crane",
    e(66, -134, 11, 9, B, 12, 7), c(72, -133, 128, -123, 4.5, 1.6, B, 12, 4),
    c(70, -127, 124, -119, 2.2, 1, B, 12, 2), line(80, -130, 126, -122),
    e(71, -136, 6.5, 6.5, M.Socket, 30, 1), e(86, -130, 4, 2, M.Socket, 30, 1),
    ...[94, 102, 110, 118].map((x) => e(x, -123, 0.9, 1.2, M.Tooth, 16, 1)));
  // Colonne : cou fin, dos court jusqu'au bassin, côtes fines.
  const spine: [number, number][] = [];
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    spine.push(t < 0.5 ? [52 - t * 60, -136 + t * 16] : [22 - (t - 0.5) * 48, -128 + (t - 0.5) * 8]);
  }
  for (const [x, y] of spine) tag("vertebres", e(x, y, 3, 2.6, B, 10, 3));
  tag("vertebres", line(52, -136, 22, -128), line(22, -128, -2, -124));
  for (let k = 5; k <= 8; k++) {
    const [x, y] = spine[k];
    tag("vertebres", c(x, y + 2, x + 3, y + 13, 1, 1, B, 8, 2, true));
  }
  // Sternum en bréchet, comme celui des oiseaux : il ancrait les puissants muscles des bras.
  tag("sternum", e(22, -110, 8, 4.5, B, 14, 4), c(16, -108, 28, -102, 1, 1, B, 16, 1, true));
  // Bassin : ilion allongé, pubis tourné vers l'arrière.
  tag("bassin", e(0, -121, 14, 6, B, 12, 5), c(-2, -116, -10, -100, 2.4, 1.8, B, 12, 3), c(4, -116, 10, -108, 2.4, 1.8, B, 12, 2));
  // Bras : humérus et avant-bras trapus, une main réduite au gros doigt, et sa grande griffe.
  tag("bras",
    c(24, -118, 28, -110, 2.8, 2.4, B, 16, 2), c(28, -110, 35, -110, 2.6, 2.2, B, 16, 2),
    c(35, -110, 41, -100, 2, 0.8, B, 18, 2), line(35, -110, 41, -100));
  // Pattes : fémur, long tibia, très long métatarse, orteils.
  for (const [hx, z] of [[4, 4], [0, 16]] as const) {
    tag("pattes", c(hx, -116, hx + 20, -86, 3, 2.4, B, z, 3), c(hx + 20, -86, hx - 6, -42, 2.4, 1.8, B, z, 2),
      c(hx - 6, -42, hx + 4, -3, 1.8, 1.3, B, z, 2), c(hx + 2, -3, hx + 16, -2, 1.3, 0.9, B, z, 1),
      line(hx + 20, -86, hx - 6, -42), line(hx - 6, -42, hx + 1, -14));
  }
  // Queue : vertèbres caudales qui s'affinent.
  for (let k = 0; k <= 9; k++) tag("queue", e(-20 - k * 9, -123 - k * 0.6, 3 - k * 0.14, 2.4 - k * 0.1, B, 10, 2));
  tag("queue", line(-20, -123, -98, -128));
  return P.map((p) => scalePrim(p, SHUVUUIA_SCALE));
}

export const SHUVUUIA: Species = {
  id: "shuvuuia",
  name: "Shuvuuia",
  latin: "Shuvuuia deserti",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Djadochta, désert de Gobi (Mongolie)",
  lengthM: LENGTH_M,
  massKg: 3.5,
  facts: [
    { id: "oiseau", title: "« Oiseau du désert »", unlock: "discover",
      text: "« Shuvuu » veut dire « oiseau » en mongol, et « deserti » « du désert ». Quand on l'a découvert, dans les années 1990, certains savants l'ont pris pour un oiseau qui ne volait pas ! C'est en fait un petit dinosaure théropode, proche cousin des oiseaux." },
    { id: "pouce", title: "Un seul gros doigt", unlock: "assemble",
      text: "Ses bras sont tout petits mais très solides, et chaque main porte surtout un énorme doigt : le pouce, armé d'une grosse griffe. Les autres doigts sont minuscules. Comme chez les oiseaux, un grand sternum en bréchet ancrait ses muscles." },
    { id: "termites", title: "Casseur de termitières ?", unlock: "eat",
      text: "À quoi servait cette griffe ? Les scientifiques pensent qu'il s'en servait peut-être pour gratter et ouvrir les nids de termites ou de fourmis, comme le fait aujourd'hui un pangolin. Son long museau fin aux dents minuscules attrapait ensuite les insectes." },
    { id: "nuit", title: "Des oreilles de chouette", unlock: "hunt",
      text: "En 2021, des chercheurs ont étudié ses yeux et son oreille interne. Ses yeux captaient beaucoup de lumière, et son oreille ressemblait à celle de la chouette effraie, qui entend une souris marcher dans le noir. Il chassait sans doute la nuit !" },
    { id: "plumes", title: "Une boule de plumes", unlock: "rest",
      text: "Sur un fossile de Shuvuuia, on a trouvé de fines fibres autour du cou : des restes de plumes. Des analyses y ont même détecté des traces de kératine, la matière de nos ongles et des plumes des oiseaux." },
    { id: "pattes", title: "Des échasses pour courir", unlock: "flee",
      text: "Pas plus lourd qu'un poulet, il avait de très longues pattes fines, faites pour courir vite. Face à un Velociraptor, mieux valait détaler entre les dunes !" },
  ],
  bones: [
    { id: "crane", name: "Crâne" },
    { id: "vertebres", name: "Colonne et côtes" },
    { id: "sternum", name: "Sternum en bréchet" },
    { id: "bras", name: "Bras et grande griffe du pouce" },
    { id: "bassin", name: "Bassin" },
    { id: "pattes", name: "Longues pattes" },
    { id: "queue", name: "Queue" },
  ],
  model: shuvuuiaModel,
  skeleton: shuvuuiaSkeleton,
  center: { x: 4 * SHUVUUIA_SCALE, y: -104 * SHUVUUIA_SCALE },
  eye: { x: EYE.x * SHUVUUIA_SCALE, y: EYE.y * SHUVUUIA_SCALE },
  feet: [4, 8].map((x) => x * SHUVUUIA_SCALE),
  halfLen: 105 * SHUVUUIA_SCALE,
  shadow: 0.45,
  walkSpeed: 30,
  runSpeed: 150,
  stride: 16,
  behavior: { diet: "carnivore", herd: [1, 2], browse: null, prey: [], defense: "flee", sight: 300, scavenger: false },
  biomes: [BIOME.Desert],
};
