import { M } from "../render/materials";
import { scalePrim, type Prim } from "../render/raster";
import { PX_PER_M } from "../config";
import { AR } from "./archelon.mat";
import { MR } from "./marine.mat";
import { NM } from "./nest.mat";
import { c, e, lerp, rot, win } from "./raptor";
import type { Pose, Species } from "./types";

/**
 * Archelon, tortue marine géante, modélisée en primitives (px locaux, regard vers la droite).
 * Le modèle brut mesure ~200 px du bout de la queue au bec ; on le ramène à sa taille réelle.
 *
 * DEUX REPÈRES selon l'action (convention sur laquelle s'appuie le comportement) :
 * - En mer (idle, walk, run, eat, drink, rest, call, attack, defend, dead) : origine = point de la
 *   ligne de flottaison (y = 0) sous le centre de la carapace, comme le mosasaure. Le corps est immergé,
 *   seul le haut de la carapace affleure ; walk/run = nage (battements des nageoires avant, rythmés
 *   par `walk`), idle = sur place, rest = dérive en surface, eat = croque une ammonite,
 *   call = tête hors de l'eau pour respirer, attack = coup de bec, defend = sursaut, dead = ventre en l'air.
 * - Sur la plage : origine AU SOL, corps entièrement au-dessus de y = 0, comme un animal terrestre.
 *   « land »    = ramper sur le sable (les deux nageoires avant poussent ensemble, au rythme de `walk`,
 *                 comme les tortues marines d'aujourd'hui ; les arrière poussent en alternance) ;
 *   « takeoff » = creuser le nid et pondre avec les nageoires arrière (`actionT` 0..1 en boucle :
 *                 le sable vole, le trou se creuse, les œufs apparaissent dans la seconde moitié).
 */
const LENGTH_M = 4;
export const ARCHELON_SCALE = (LENGTH_M * PX_PER_M) / 200;

/** Centre de la carapace sous la ligne de flottaison (nage) et au-dessus du sable (plage). */
const CY_SEA = 12;
const CY_LAND = -27;
const EYE = { x: 90, y: CY_SEA - 3 };

/** Réglages de pose, déduits de l'action. */
interface ArchRig {
  land: boolean;
  /** Nageoires avant / arrière : angle (rad, + = pointe vers le haut), côté lointain en plus. */
  fin: number;
  finFar: number;
  rear: number;
  rearFar: number;
  dx: number;
  dy: number;
  /** Bascule du corps (rad, - = avant relevé). */
  tilt: number;
  /** Tête : rotation autour de la base du cou, allongement du cou, ouverture du bec. */
  head: number;
  neck: number;
  jaw: number;
  closed: boolean;
  /** Ponte : 0..1 (sable projeté, trou, œufs). */
  dig: number;
}

function archelonRig({ action, actionT: t, time, walk, moving }: Pose): ArchRig {
  const swim = action === "walk" || action === "run";
  const fast = action === "run";
  const amp = swim ? lerp(0.15, fast ? 0.75 : 0.55, moving) : 0.12;
  const ph = swim ? walk : time * 1.1;
  const s = Math.sin(t * Math.PI * 2);
  const r: ArchRig = {
    land: false,
    // Vol sous-marin : les deux nageoires avant battent ensemble, comme des ailes.
    fin: Math.sin(ph) * amp - 0.4, finFar: Math.sin(ph) * amp - 0.35,
    rear: Math.sin(ph + 1.2) * amp * 0.4, rearFar: Math.sin(ph + 1.2) * amp * 0.4,
    dx: 0, dy: -Math.cos(ph) * amp * 3, tilt: 0, head: Math.sin(time * 0.8) * 0.03, neck: 0, jaw: 0, closed: false, dig: 0,
  };
  switch (action) {
    case "eat": {
      // Tête plongée vers l'ammonite, coups de bec répétés.
      const chomp = Math.abs(Math.sin(t * Math.PI * 4));
      Object.assign(r, { head: 0.3, neck: 6 + chomp * 4, jaw: chomp * 0.6 });
      break;
    }
    case "rest":
      // Dérive en surface : la carapace sort davantage, nageoires étalées, yeux clos.
      Object.assign(r, { fin: 0.15 + Math.sin(time * 0.5) * 0.04, finFar: 0.15, rear: 0.1, rearFar: 0.1, dy: -4, closed: true, head: 0.05 });
      break;
    case "call": {
      // Remonte respirer : avant relevé, tête hors de l'eau, bec entrouvert.
      const k = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      Object.assign(r, { tilt: -0.14 * k, dy: -5 * k, head: -0.55 * k, neck: 6 * k, jaw: 0.35 * k * (0.6 + 0.4 * Math.abs(s)), fin: 0.3 * k + r.fin * (1 - k) });
      r.finFar = r.fin;
      break;
    }
    case "attack": {
      // Recule le cou (0-0.35), lance la tête bec ouvert (0.35-0.55) et le referme d'un coup sec.
      const wind = win(t, 0, 0.3) * (1 - win(t, 0.35, 0.45));
      const lunge = win(t, 0.35, 0.5) * (1 - win(t, 0.7, 1));
      Object.assign(r, {
        neck: lunge * 14 - wind * 8, head: -0.12 * wind + 0.08 * lunge, jaw: Math.max(wind, lunge) * (1 - win(t, 0.5, 0.56) * 0.95),
        dx: lunge * 8, fin: -0.5 * lunge + 0.3 * wind, finFar: -0.5 * lunge + 0.3 * wind,
      });
      break;
    }
    case "defend": {
      // Sursaut : tête rentrée autant que possible, nageoires relevées en bouclier, carapace qui pivote.
      const jit = Math.sin(time * 30) * 0.03;
      Object.assign(r, { neck: -10, head: -0.1, fin: 0.85 + jit, finFar: 0.75, rear: 0.4, rearFar: 0.4, tilt: 0.08 + jit, closed: true });
      break;
    }
    case "dead":
      Object.assign(r, { fin: 0.4, finFar: 0.5, rear: 0.3, rearFar: 0.35, dy: 0, head: 0.25, neck: 2, jaw: 0.2, closed: true });
      break;
    case "land": {
      // Reptation : les nageoires avant prennent appui ensemble et hissent le corps ; les arrière poussent.
      const push = Math.sin(walk);
      Object.assign(r, {
        land: true, fin: -0.24 + push * 0.12 * Math.max(0.3, moving), finFar: -0.12 + push * 0.12 * Math.max(0.3, moving),
        rear: Math.sin(walk + 1.6) * 0.2, rearFar: Math.sin(walk - 1.6) * 0.2,
        dy: -Math.max(0, -push) * 3 * Math.max(0.3, moving), dx: push * 2, head: 0.06 + push * 0.04, neck: -2,
      });
      break;
    }
    case "takeoff": {
      // Ponte : avant posé, arrière qui creuse en alternance, yeux mi-clos.
      const sc = t * Math.PI * 2 * 3;
      Object.assign(r, {
        land: true, fin: -0.3, finFar: -0.2, rear: 0.25 + Math.sin(sc) * 0.55, rearFar: 0.25 - Math.sin(sc) * 0.55,
        tilt: -0.05, dy: 1.5, head: 0.12, neck: -2, closed: t > 0.55, dig: t,
      });
      break;
    }
    default:
      break;
  }
  return r;
}

/** Retourne verticalement autour de y = cy (ventre en l'air), puis décale. */
function flipY(ps: Prim[], cy: number, dy: number): Prim[] {
  const f = (y: number) => 2 * cy - y + dy;
  return ps.map((p) => {
    if (p.k === "c") return { ...p, ay: f(p.ay), by: f(p.by) };
    if (p.k === "cut") return { ...p, y: f(p.y) };
    return { ...p, y: f(p.y), yMin: p.yMax === undefined ? undefined : f(p.yMax), yMax: p.yMin === undefined ? undefined : f(p.yMin) };
  });
}

/** Hauteur du dôme de la carapace à l'abscisse x (0 au bord, 1 au sommet). */
const dome = (x: number) => Math.sqrt(Math.max(0, 1 - (x / 72) ** 2));

/** Une nageoire : bras puis pale effilée, pointée vers l'arrière, tournée de `a` autour de l'épaule. */
function flipper(ax: number, ay: number, len: number, w: number, a: number, m: number, z: number, near: boolean): Prim[] {
  const ex = ax - 18 * len, ey = ay + 7 * len, tx = ax - 78 * len, ty = ay + 18 * len;
  const ps: Prim[] = [
    c(ax, ay, ex, ey, 8 * w, 9 * w, m, z, 7 * w),
    c(ex, ey, tx, ty, 9 * w, 2.5 * w, m, z + 1, 6 * w),
  ];
  if (near) {
    // Quelques taches claires sur la pale.
    ps.push(e(ex - 14 * len, ey + 3 * len, 2.4, 1.8, AR.Spot, z + 8, 1), e(ex - 32 * len, ey + 7 * len, 2, 1.5, AR.Spot, z + 8, 1));
  }
  return rot(ps, ax, ay, a);
}

export function archelonModel(pose: Pose): Prim[] {
  const r = archelonRig(pose);
  const cy = r.land ? CY_LAND : CY_SEA;
  const P: Prim[] = [];

  // --- Ponte : trou creusé derrière la carapace, monticule et gerbes de sable, œufs ---
  const G: Prim[] = [];
  if (r.dig > 0) {
    const d = Math.min(1, r.dig * 1.6);
    G.push(e(-100, -1, 14 + 8 * d, 3 + 3 * d, NM.Hollow, -60, 2));
    G.push(e(-134, -2, 8 + 10 * d, 3 + 5 * d, NM.Sand, -58, 6));
    for (let i = 0; i < 6; i++) {
      const u = (r.dig * 3 + i / 6) % 1;
      G.push(e(-90 - u * 44 - (i % 3) * 4, -2 - Math.sin(u * Math.PI) * (16 + (i % 2) * 10), 2.6, 2, NM.Sand, 40, 2));
    }
    if (r.dig > 0.55) {
      const n = Math.min(4, Math.floor((r.dig - 0.55) * 10) + 1);
      for (let k = 0; k < n; k++) G.push(e(-108 + k * 6, -2 - (k % 2) * 2, 3.2, 2.8, NM.ShellCream, -56, 2));
    }
  }

  // --- Nageoires du côté lointain (dans l'ombre, derrière le corps) ---
  // Sur le sable, les nageoires avant s'écartent vers les côtés : vues de profil, elles paraissent courtes.
  const fl = r.land ? 0.45 : 1, fw = r.land ? 1.2 : 1;
  P.push(...flipper(50, cy + 6, fl, fw, r.finFar, AR.Far, -30, false));
  P.push(...flipper(-44, cy + 8, 0.42, 0.75, r.rearFar, AR.Far, -30, false));

  // --- Queue courte, sous l'arrière de la carapace ---
  P.push(c(-78, cy + 10, -94, cy + 14, 4.5, 1.2, AR.Skin, -4, 4));

  // --- Plastron (ventre plat et pâle), puis la carapace en dôme effilée vers l'arrière ---
  P.push(e(2, cy + 11, 64, 11, AR.Belly, -2, 10));
  P.push(e(0, cy, 72, 22, AR.Shell, 0, 22));
  P.push(c(-46, cy + 1, -88, cy + 10, 16, 3, AR.Shell, -1, 14));
  // Crêtes longitudinales : carène médiane bosselée et crête latérale (la peau tendue sur les côtes).
  for (let x = 54; x >= -54; x -= 12) {
    P.push(e(x, cy - 22 * dome(x) + 2, 3.2, 2.4, AR.Ridge, 22 * dome(x) + 2, 2));
    if (x % 24 === 6) P.push(e(x, cy - 11 * dome(x) + 1, 2.6, 1.8, AR.Ridge, 21, 1));
  }
  // Taches claires sur le cuir.
  for (const [sx, sy] of [[30, -4], [-12, -2], [10, 4], [-34, 5], [44, 6]] as const) P.push(e(sx, cy + sy, 2.6, 1.8, AR.Spot, 20, 1));

  // --- Tête : cou épais, petite tête, bec corné en crochet ---
  const H: Prim[] = [];
  const hx = 88 + r.neck, hy = cy;
  H.push(c(58, cy + 3, hx - 8, hy + 1, 12, 9, AR.Skin, 2, 9));
  H.push(c(60, cy + 8, hx - 8, hy + 6, 6, 4, AR.Belly, 6, 4));
  H.push(e(hx, hy, 13, 10, AR.Skin, 4, 10));
  H.push(e(hx - 4, hy + 2, 2, 1.5, AR.Spot, 14, 1), e(hx - 9, hy - 4, 1.8, 1.4, AR.Spot, 14, 1));
  // Bec supérieur : long, recourbé vers le bas en crochet.
  H.push(c(hx + 6, hy - 5, hx + 17, hy + 1, 6, 3.5, AR.Beak, 6, 6));
  H.push(c(hx + 17, hy + 1, hx + 15, hy + 7, 3, 1.4, AR.Beak, 7, 4));
  if (r.closed) H.push(c(EYE.x - 2 + r.neck, hy - 3, EYE.x + 2 + r.neck, hy - 3, 1, 1, MR.Lid, 20, 1, true));
  else H.push(e(EYE.x + r.neck, hy - 3, 2.4, 2.4, M.Eye, 20, 1));
  if (r.jaw > 0.08) H.push(e(hx + 9, hy + 5, 8, 2 + r.jaw * 6, M.Mouth, 3, 2));
  // Bec inférieur (mâchoire), articulé sous l'œil.
  const J: Prim[] = [c(hx - 6, hy + 6, hx + 13, hy + 6, 5, 2.5, AR.Beak, 5, 4), c(hx - 8, hy + 8, hx + 6, hy + 8, 3, 2, AR.Belly, 8, 2)];
  if (r.jaw <= 0.08) J.push(c(hx + 2, hy + 4, hx + 12, hy + 4, 1, 1, MR.MLip, 16, 1, true));
  H.push(...rot(J, hx - 6, hy + 5, r.jaw * 0.6));
  P.push(...rot(H, 60, cy + 3, r.head));

  // --- Proie (ammonite) devant le bec, entamée au fil du repas ---
  if (pose.action === "eat") {
    const k = 1 - 0.6 * pose.actionT;
    const ax = 118 + r.neck, ay = cy + 22;
    P.push(e(ax, ay, 10 * k, 12 * k, NM.ShellTan, 10, 10 * k), e(ax + 2, ay, 4 * k, 5 * k, M.Socket, 22, 1));
  }
  // --- Souffle quand la tête crève la surface ---
  if (pose.action === "call" && pose.actionT > 0.2 && pose.actionT < 0.8) {
    const u = (pose.actionT - 0.2) / 0.6;
    P.push(e(hx + 20, cy - 26 - u * 10, 3 + u * 3, 2 + u * 2, AR.Spot, 40, 2));
  }

  // --- Nageoires proches : avant (immense pale) et arrière ---
  P.push(...flipper(50, cy + 10, fl, fw, r.fin, AR.Fin, 34, true));
  P.push(...flipper(-46, cy + 12, 0.42, 0.75, r.rear, AR.Fin, 34, false));

  // Bascule et décalage du corps (sans les traces au sol).
  let B = rot(P, 0, cy, r.tilt, r.dx, r.dy);
  if (pose.action === "dead") B = flipY(B, CY_SEA, 2);
  return [...G, ...B].map((p) => scalePrim(p, ARCHELON_SCALE));
}

/**
 * Squelette (format : voir ankyloSkeleton), en nage, regard à droite.
 * Carapace à claire-voie : larges côtes séparées par des vides, presque pas de plaques soudées.
 */
export function archelonSkeleton(pose: Pose): Prim[] {
  void pose;
  const P: Prim[] = [];
  const B = M.Bone;
  const cy = CY_SEA;
  const tag = (bone: string, ...ps: Prim[]) => ps.forEach((p) => P.push({ ...p, bone } as Prim));

  // Crâne : petit, long bec crochu, grande orbite.
  tag("crane",
    e(88, cy, 12, 8, B, 12, 7), c(94, cy - 4, 105, cy + 1, 5, 3, B, 12, 5), c(105, cy + 1, 103, cy + 7, 2.5, 1.2, B, 13, 3),
    c(80, cy + 6, 100, cy + 7, 3, 2, B, 12, 3), e(89, cy - 3, 3.5, 3, M.Socket, 30, 1), e(80, cy - 1, 3, 2.5, M.Socket, 30, 1));
  // Colonne : cou, dos (soudé sous la carapace) et petite queue.
  for (let x = 74; x >= 58; x -= 6) tag("vertebres", e(x, cy + 2, 3.2, 3, B, 10, 3));
  for (let x = 48; x >= -60; x -= 12) tag("vertebres", e(x, cy - 22 * dome(x) + 4, 4, 2.5, B, 14, 2));
  for (let x = -70; x >= -92; x -= 6) tag("vertebres", e(x, cy + 8 + (-70 - x) * 0.2, 2.6 - (-70 - x) * 0.05, 2, B, 10, 2));
  // Carapace : côtes larges en éventail sous la peau, bordées par une frange d'os (claire-voie).
  for (let x = 48; x >= -60; x -= 12) {
    const top = cy - 22 * dome(x) + 4;
    tag("carapace", c(x, top, x - 10, cy + 10, 2.4, 1.6, B, 12, 2));
  }
  tag("carapace", c(64, cy + 6, 48, cy - 12, 1, 1, B, 12, 1, true), c(-62, cy - 8, -86, cy + 9, 1, 1, B, 12, 1, true));
  // Plastron : quatre paires d'os en étoile, avec de grands trous entre eux.
  for (const x of [36, 14, -10, -32]) tag("plastron", c(x - 9, cy + 18, x + 9, cy + 16, 2, 2, B, 8, 2), e(x, cy + 17, 3, 2.5, B, 9, 2));
  // Nageoires : humérus trapu, puis longues phalanges de la pale.
  tag("nageoires-av", c(50, cy + 10, 34, cy + 16, 4, 3, B, 16, 3), c(34, cy + 16, 26, cy + 18, 3, 2.5, B, 16, 2));
  for (let f = 0; f < 4; f++) for (let j = 0; j < 4; j++) tag("nageoires-av", e(20 - j * 12 - f * 3, cy + 18 + j * 3 + f * 2.5, 3, 1.4, B, 16, 1));
  tag("nageoires-ar", c(-46, cy + 12, -56, cy + 16, 3, 2.4, B, 16, 2));
  for (let f = 0; f < 3; f++) for (let j = 0; j < 2; j++) tag("nageoires-ar", e(-62 - j * 7 - f * 2, cy + 16 + j * 2 + f * 2, 2.2, 1.2, B, 16, 1));
  return P.map((p) => scalePrim(p, ARCHELON_SCALE));
}

export const ARCHELON: Species = {
  id: "archelon",
  name: "Archelon",
  latin: "Archelon ischyros",
  period: "Crétacé supérieur, 75 Ma",
  place: "Formation de Pierre Shale, Dakota du Sud (États-Unis)",
  lengthM: LENGTH_M,
  massKg: 2200,
  facts: [
    { id: "geante", title: "La plus grande tortue", unlock: "discover",
      text: "Archelon est la plus grande tortue marine jamais découverte : environ 4 mètres de long, plus de 2 tonnes, et des nageoires avant si longues que, déployées, elles mesuraient environ 4 mètres d'un bout à l'autre." },
    { id: "carapace", title: "Une carapace à claire-voie", unlock: "assemble",
      text: "Sa carapace n'était pas un bouclier d'os plein : de larges côtes séparées par des trous, recouvertes d'une peau épaisse comme du cuir. Sa cousine la tortue luth a encore ce genre de carapace." },
    { id: "bec", title: "Un bec en crochet", unlock: "eat",
      text: "Archelon n'avait pas de dents mais un bec corné crochu, assez solide pour broyer les coquilles des ammonites. Il gobait sans doute aussi des méduses, comme la tortue luth." },
    { id: "air", title: "Remonter pour respirer", unlock: "call",
      text: "Comme toutes les tortues, Archelon avait des poumons : il devait sortir la tête de l'eau pour respirer. Il pouvait peut-être rester longtemps sous l'eau entre deux respirations." },
    { id: "nageoire", title: "La nageoire perdue", unlock: "rest",
      text: "Le squelette le plus célèbre, exposé à Vienne, a perdu une nageoire arrière : elle a peut-être été arrachée par un mosasaure ! La tortue a pu survivre et nager encore longtemps." },
    { id: "plage", title: "Pondre sur la plage", unlock: "nest",
      text: "Les femelles devaient ramper hors de la mer pour creuser un trou dans le sable avec leurs nageoires arrière, y pondre leurs œufs, puis les recouvrir avant de retourner à l'eau." },
    { id: "bebes", title: "La course vers la mer", unlock: "baby",
      text: "À l'éclosion, les bébés tortues sortent du sable et foncent vers les vagues. Beaucoup se font manger en route : seuls les plus rapides atteignent le large." },
  ],
  bones: [
    { id: "crane", name: "Crâne et bec" },
    { id: "carapace", name: "Carapace (côtes)" },
    { id: "plastron", name: "Plastron" },
    { id: "nageoires-av", name: "Nageoires avant" },
    { id: "nageoires-ar", name: "Nageoires arrière" },
    { id: "vertebres", name: "Colonne" },
  ],
  model: archelonModel,
  skeleton: archelonSkeleton,
  center: { x: 0, y: CY_SEA * ARCHELON_SCALE },
  eye: { x: EYE.x * ARCHELON_SCALE, y: EYE.y * ARCHELON_SCALE },
  feet: [50, -46].map((x) => x * ARCHELON_SCALE),
  halfLen: 100 * ARCHELON_SCALE,
  shadow: 0.8,
  walkSpeed: 30,
  runSpeed: 70,
  stride: 3,
  behavior: { diet: "omnivore", herd: [1, 1], browse: null, prey: [], defense: "flee", sight: 320, scavenger: false },
  habitat: "sea",
};
