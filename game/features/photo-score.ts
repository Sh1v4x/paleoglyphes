import type { Stage } from "../species/life";
import type { Action, FactUnlock, Habitat, SpeciesId } from "../species/types";

/**
 * Photo-safari : notation d'une photo et titre généré, à partir de ce qui est dans le cadre.
 * Module pur (aucun accès au DOM ni à la réserve) : testable sans navigateur.
 */

/** Ce que fait le sujet, résumé pour la note et le titre. */
export type Act =
  | "idle" | "walk" | "eat" | "drink" | "rest" | "call" | "hunt" | "attack" | "defend" | "flee"
  | "fly" | "dive" | "swim" | "nest" | "hatch" | "court" | "young" | "scavenge" | "dead";

/** Un sujet dans le cadre : un animal ou un nid. */
export interface Subject {
  kind: "animal" | "nest";
  sp: SpeciesId;
  name: string;
  stage: Stage;
  act: Act;
  carnivore: boolean;
  /** Cellules de la silhouette dans le cadre, et au total. */
  inside: number;
  total: number;
  /** Centre de la partie visible, relatif au cadre (0..1). */
  cx: number;
  cy: number;
  /** De l'eau autour des pieds (animal terrestre). */
  water: boolean;
  /** Habitat de l'espèce. */
  habitat: Habitat;
}

export interface ShotContext {
  /** Nombre de cellules du cadre. */
  area: number;
  night: boolean;
  /** Lumière dorée (aube ou crépuscule) et heure, pour choisir les mots. */
  golden: boolean;
  hour: number;
  /** Individus vivants par espèce dans la réserve (rareté). */
  population: Partial<Record<SpeciesId, number>>;
}

export interface Score {
  stars: number;
  title: string;
  /** Bonus et remarques (« En pleine chasse », « Sujet coupé »...). */
  notes: string[];
  species: SpeciesId[];
  /** Sujet principal (index dans la liste), -1 sans sujet. */
  main: number;
}

/** Champs d'un animal utiles pour résumer son action (voir scenes/park.ts Animal). */
export interface ActSource {
  action: Action;
  task: string;
  mood: string;
  alt: number;
  moving: number;
  growth: number;
}

/** Résume l'action d'un animal (même logique que l'activité affichée dans la réserve). */
export function actOf(a: ActSource, habitat: Habitat = "land"): Act {
  if (a.task === "dead") return "dead";
  if (a.mood === "nest") return "nest";
  if (a.mood === "hatch") return "hatch";
  if (a.mood === "court") return "court";
  if (a.task === "feed" && a.mood === "scavenge") return "scavenge";
  if (habitat === "air" && (a.alt > 0 || a.action === "fly" || a.action === "takeoff" || a.action === "land")) {
    return a.task === "attack" ? "dive" : "fly";
  }
  switch (a.task) {
    case "hunt": case "chase": return habitat === "sea" ? "dive" : "hunt";
    case "attack": return "attack";
    case "defend": return "defend";
    case "flee": return "flee";
    case "feed": return "eat";
    case "drink": return a.action === "drink" ? "drink" : "walk";
    case "rest": return "rest";
    case "call": return "call";
    case "graze": return a.action === "eat" ? "eat" : "walk";
  }
  if (a.mood === "young" || a.growth < 1) return a.action === "eat" ? "eat" : a.action === "rest" ? "rest" : "young";
  if (a.action === "eat") return "eat";
  if (habitat === "sea") return "swim";
  return a.moving > 0.5 ? "walk" : "idle";
}

/** Déclencheurs de faits du carnet pour un animal bien photographié (comme un clic d'observation). */
export function triggersOf(a: ActSource & { nestId?: number }, stage: Stage): FactUnlock[] {
  const out: FactUnlock[] = ["discover"];
  const byAction: Partial<Record<Action, FactUnlock>> = { eat: "eat", drink: "drink", rest: "rest", attack: "attack", defend: "defend", call: "call" };
  const t = byAction[a.action];
  if (t && a.task !== "dead") out.push(t);
  if (["herd", "hunt", "flee", "scavenge"].includes(a.mood)) out.push(a.mood as FactUnlock);
  if (a.task !== "dead" && (a.nestId || a.mood === "nest")) out.push("nest");
  if (a.task !== "dead" && (stage === "baby" || stage === "juvenile")) out.push("baby");
  return [...new Set(out)];
}

/** Intérêt de l'action : 1 = spectaculaire, 0.5 = joli moment, 0 = rien de spécial. */
export function interest(act: Act): number {
  switch (act) {
    case "hunt": case "attack": case "defend": case "flee": case "fly": case "dive":
    case "hatch": case "court": case "scavenge": case "nest":
      return 1;
    case "eat": case "drink": case "call": case "rest": case "swim": case "young":
      return 0.5;
    default:
      return 0;
  }
}

const plural = (n: string) => (/[sx]$/i.test(n) ? n : `${n}s`);
const NUM = ["", "Un", "Deux", "Trois", "Quatre", "Cinq", "Six"];
/** « de Tricératops », « d'Edmontosaure ». */
const deN = (n: string) => (/^[aeiouyhAEIOUYHÉ]/.test(n) ? `d'${n}` : `de ${n}`);
const isYoung = (st: Stage) => st === "baby" || st === "juvenile";

/** Groupe nominal : « Un Tricératops », « Trois Edmontosaures », « Un troupeau de ... ». */
function nounPhrase(name: string, n: number): string {
  if (n <= 1) return `Un ${name}`;
  if (n <= 3) return `${NUM[n]} ${plural(name)}`;
  return `Un troupeau de ${plural(name)}`;
}

/** Complément d'action, accordé au nombre. */
function actPhrase(act: Act, n: number): string {
  const p = n > 1;
  switch (act) {
    case "eat": return "en plein repas";
    case "drink": return p ? "qui s'abreuvent" : "qui s'abreuve";
    case "rest": return p ? "endormis" : "endormi";
    case "call": return p ? "qui s'appellent" : "qui lance un appel";
    case "hunt": return "en chasse";
    case "attack": return "à l'attaque";
    case "defend": return "sur la défensive";
    case "flee": return "en fuite";
    case "fly": return "en plein vol";
    case "dive": return p ? "plongeant sur leur proie" : "plongeant sur sa proie";
    case "swim": return "sous les vagues";
    case "nest": return p ? "sur leur nid" : "sur son nid";
    case "court": return "en pleine parade";
    case "scavenge": return "pillant un nid";
    case "young": return "";
    default: return "";
  }
}

/** Lieu et moment : « au bord de l'eau », « sous la lune », « au soleil couchant ». */
function placePhrase(main: Subject, ctx: ShotContext): string {
  const bits: string[] = [];
  if (main.water && main.habitat === "land") bits.push("au bord de l'eau");
  if (ctx.night) bits.push("sous la lune");
  else if (ctx.golden) bits.push(ctx.hour > 12 ? "au soleil couchant" : "à l'aube");
  return bits.join(", ");
}

/** Titre de la photo en français. */
export function titleOf(subjects: Subject[], main: number, ctx: ShotContext): string {
  if (main < 0) {
    if (ctx.night) return "La réserve sous la lune";
    if (ctx.golden) return ctx.hour > 12 ? "La réserve au soleil couchant" : "La réserve à l'aube";
    return "Paysage de la réserve";
  }
  const m = subjects[main];
  let head: string;
  if (m.kind === "nest") {
    head = m.act === "hatch" ? `Un nid ${deN(m.name)} en pleine éclosion` : `Un nid ${deN(m.name)}`;
  } else if (m.act === "dead") {
    head = `La carcasse d'un ${m.name}`;
  } else {
    const same = subjects.filter((x) => x.kind === "animal" && x.sp === m.sp && x.act !== "dead");
    const adults = same.filter((x) => !isYoung(x.stage)).length;
    const young = same.length - adults;
    if (adults === 0) head = young > 1 ? `Des bébés ${plural(m.name)}` : `Un bébé ${m.name}`;
    else if (young === 0) head = nounPhrase(m.name, adults);
    else {
      const det = adults > 1 ? (young > 1 ? "leurs" : "leur") : young > 1 ? "ses" : "son";
      head = `${nounPhrase(m.name, adults)} et ${det} petit${young > 1 ? "s" : ""}`;
    }
    const n = adults || young;
    const act = actPhrase(m.act, n);
    if (act) head += ` ${act}`;
  }
  // Une autre espèce dans le cadre : rencontre (prédateur / proie) ou simple voisinage.
  const other = subjects.find((x) => x.kind === "animal" && x.sp !== m.sp && x.act !== "dead" && x.inside >= x.total * 0.3);
  if (other && m.kind === "animal" && m.act !== "dead") {
    const tense = ["hunt", "attack", "defend", "flee"].includes(m.act) || ["hunt", "attack", "defend", "flee"].includes(other.act) || m.carnivore !== other.carnivore;
    const cnt = subjects.filter((x) => x.sp === other.sp && x.act !== "dead").length;
    head += ` ${tense ? "face à" : "avec"} ${cnt > 1 ? `des ${plural(other.name)}` : `un ${other.name}`}`;
  }
  const place = placePhrase(m, ctx);
  return place ? `${head} ${place}` : head;
}

/** Note de la photo (1 à 5 étoiles), titre et remarques. */
export function scoreShot(subjects: Subject[], ctx: ShotContext): Score {
  // On ne compte que les sujets un minimum visibles.
  const seen = subjects.filter((x) => x.inside >= 4 && x.inside >= x.total * 0.15);
  const notes: string[] = [];
  let main = -1, best = 0;
  seen.forEach((x, i) => {
    const v = x.inside * (1 + interest(x.act)) * (x.kind === "nest" ? 0.8 : 1);
    if (v > best) { best = v; main = i; }
  });
  const species = [...new Set(seen.map((x) => x.sp))];
  if (main < 0) {
    if (ctx.night) notes.push("Photo de nuit");
    return { stars: 1, title: titleOf(seen, -1, ctx), notes: notes.length ? notes : ["Aucun animal dans le cadre"], species, main: -1 };
  }
  const m = seen[main];
  let pts = 1.5;
  const frac = m.inside / Math.max(1, m.total);
  if (frac < 0.5) { pts -= 0.5; notes.push("Sujet coupé"); }
  else if (frac >= 0.9) { pts += 0.5; notes.push("Sujet entier"); }
  const rel = m.inside / Math.max(1, ctx.area);
  if (rel < 0.01) { pts -= 0.5; notes.push("Sujet trop petit"); }
  else if (rel >= 0.04 && rel <= 0.55) { pts += 0.5; notes.push("Belle taille"); }
  const d = Math.hypot(m.cx - 0.5, m.cy - 0.5);
  const third = (v: number) => Math.min(Math.abs(v - 1 / 3), Math.abs(v - 2 / 3)) < 0.08;
  if (d < 0.15) { pts += 0.5; notes.push("Bien centré"); }
  else if (third(m.cx) && (third(m.cy) || Math.abs(m.cy - 0.5) < 0.15)) { pts += 0.5; notes.push("Règle des tiers"); }
  const it = interest(m.act);
  if (it >= 1) { pts += 1; notes.push("Moment rare"); }
  else if (it > 0) { pts += 0.5; notes.push("Joli moment"); }
  if (seen.some((x) => x.kind === "animal" && isYoung(x.stage) && x.act !== "dead")) { pts += 0.5; notes.push("Un petit !"); }
  if ((ctx.population[m.sp] ?? 0) <= 2) { pts += 0.5; notes.push("Espèce rare"); }
  if (species.length >= 2) { pts += 0.5; notes.push("Plusieurs espèces"); }
  if (ctx.night) { pts += 0.5; notes.push("Photo de nuit"); }
  const stars = Math.max(1, Math.min(5, Math.round(pts)));
  return { stars, title: titleOf(seen, main, ctx), notes, species, main: subjects.indexOf(m) };
}

/** Étoiles en ASCII : « *** » + « .. ». */
export const starsText = (n: number) => "*".repeat(n) + ".".repeat(5 - n);
