import type { Input } from "../input";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import { saveProgress } from "../progress";
import { SPECIES } from "../species";
import type { Fact, Species, SpeciesId } from "../species/types";
import type { GameState } from "../state";
import { ascii, button, text, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { box, DEFENSE, du, fitSprite, fmtKg, fmtM, GROUP, hasF, isDino, knownList, le } from "./journal-common";
import { UI_TOP } from "./types";

/**
 * Quiz du carnet : questions tirées des faits débloqués et des fiches des espèces connues.
 * Toutes les 3 bonnes réponses : un « indice de fouille » (progress.hints), à dépenser dans la fouille.
 */

export interface Question {
  key: string;
  prompt: string;
  /** Citation (fait du carnet, nom masqué). */
  quote?: string;
  options: string[];
  answer: number;
  /** Explication montrée après la réponse. */
  explain: string;
  /** Espèces illustrées avant / après la réponse. */
  pre: SpeciesId[];
  post: SpeciesId[];
}

export interface QuizState {
  q: Question | null;
  /** Réponse choisie (-1 : pas encore). */
  picked: number;
  score: number;
  asked: number;
  streak: number;
  /** Clés des dernières questions (pour éviter les répétitions). */
  recent: string[];
}

export function createQuizState(): QuizState {
  return { q: null, picked: -1, score: 0, asked: 0, streak: 0, recent: [] };
}

/** Nombre minimal de faits débloqués pour jouer. */
const MIN_FACTS = 3;
const HINT_EVERY = 3;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const rnd = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** Retire le nom de l'espèce d'un texte (sinon la réponse est dans la question !). */
function mask(text: string, sp: Species): string {
  const words = [sp.name, ...sp.latin.split(" ")].map((w) => ascii(w)).filter((w) => w.length >= 4);
  const stems = words.map((w) => w.slice(0, Math.min(w.length, 6)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let t = ascii(text);
  if (sp.id === "trex") t = t.replace(/T\. ?rex/gi, "___");
  for (const st of stems) t = t.replace(new RegExp(`\\b${st}[a-z]*`, "gi"), "___");
  return t;
}

interface Pools { K: Species[]; F: { sp: Species; f: Fact }[] }

/** Construit une question à choix multiple : la bonne réponse + des distracteurs mélangés. */
function choice(key: string, prompt: string, right: string, wrong: string[], explain: string, pre: SpeciesId[], post: SpeciesId[], quote?: string): Question {
  const options = shuffle([right, ...wrong.slice(0, 3)]);
  return { key, prompt, quote, options, answer: options.indexOf(right), explain, pre, post };
}

const ERA_NAMES = ["Trias", "Jurassique", "Crétacé", "Paléogène (après les dinosaures)"];
const DEF_Q: Partial<Record<Species["behavior"]["defense"], string>> = {
  club: "Quel animal avait une massue au bout de la queue ?",
  horns: "Quel animal faisait face aux prédateurs avec des cornes et une collerette ?",
  headbutt: "Quel animal avait un crâne épais en forme de dôme ?",
  flee: "Quel animal comptait surtout sur la fuite en troupeau pour se défendre ?",
};

type Gen = (P: Pools) => Question | null;
const GENS: [Gen, number][] = [
  // « De quel animal parle ce fait ? »
  [({ K, F }) => {
    if (K.length < 3 || !F.length) return null;
    const { sp, f } = rnd(F);
    const others = shuffle(K.filter((o) => o.id !== sp.id)).map((o) => o.name);
    return choice(`fact:${sp.id}:${f.id}`, `De quel animal parle cette page du carnet ? « ${f.title} »`, sp.name, others,
      `${sp.name} : ${f.text}`, [], [sp.id], mask(f.text, sp));
  }, 3],
  // Vrai ou faux, à partir d'un fait.
  [({ K, F }) => {
    if (K.length < 2 || !F.length) return null;
    const { sp, f } = rnd(F);
    const truth = Math.random() < 0.5;
    const who = truth ? sp : rnd(K.filter((o) => o.id !== sp.id));
    const q = choice(`tf:${sp.id}:${f.id}:${who.id}`, `Vrai ou faux ? Ce fait parle ${du(who.name)}.`, truth ? "Vrai" : "Faux", [truth ? "Faux" : "Vrai"],
      `${truth ? "Vrai" : `Faux, il parle ${du(sp.name)}`}. ${f.text}`, [], [sp.id], mask(f.text, sp));
    q.options = ["Vrai", "Faux"];
    q.answer = truth ? 0 : 1;
    return q;
  }, 2],
  // Défense (massue, cornes, dôme...).
  [({ K }) => {
    const cands = K.filter((sp) => DEF_Q[sp.behavior.defense]);
    if (K.length < 3 || !cands.length) return null;
    const sp = rnd(cands), d = sp.behavior.defense;
    const others = shuffle(K.filter((o) => o.behavior.defense !== d)).map((o) => o.name);
    if (others.length < 2) return null;
    return choice(`def:${sp.id}`, DEF_Q[d]!, sp.name, others, `${sp.name} : ${DEFENSE[d]}.`, [], [sp.id]);
  }, 2],
  // Période.
  [({ K }) => {
    if (!K.length) return null;
    const sp = rnd(K);
    const right = /jurassique/i.test(sp.period) ? ERA_NAMES[1] : /trias/i.test(sp.period) ? ERA_NAMES[0] : ERA_NAMES[2];
    const q = choice(`era:${sp.id}`, `À quelle période vivait ${le(sp.name)} ?`, right, ERA_NAMES.filter((e) => e !== right),
      `${sp.name} : ${sp.period} (Ma = millions d'années). Trias 252-201 Ma, Jurassique 201-145 Ma, Crétacé 145-66 Ma.`, [sp.id], []);
    q.options = ERA_NAMES; q.answer = ERA_NAMES.indexOf(right);
    return q;
  }, 2],
  // Plus long.
  [({ K }) => {
    const L = K.filter((sp) => sp.habitat !== "air");
    if (L.length < 2) return null;
    for (let n = 0; n < 8; n++) {
      const [a, b] = shuffle(L);
      if (Math.max(a.lengthM, b.lengthM) < 1.25 * Math.min(a.lengthM, b.lengthM)) continue;
      const big = a.lengthM > b.lengthM ? a : b;
      const q = choice(`len:${[a.id, b.id].sort().join(":")}`, `Plus long : ${a.name} ou ${b.name} ?`, big.name, [(big === a ? b : a).name],
        `${a.name} : ${fmtM(a.lengthM)} ; ${b.name} : ${fmtM(b.lengthM)}. Compare-les dans l'onglet Tailles !`, [a.id, b.id], []);
      q.options = [a.name, b.name]; q.answer = big === a ? 0 : 1;
      return q;
    }
    return null;
  }, 2],
  // Plus lourd.
  [({ K }) => {
    if (K.length < 2) return null;
    for (let n = 0; n < 8; n++) {
      const [a, b] = shuffle(K);
      if (Math.max(a.massKg, b.massKg) < 1.5 * Math.min(a.massKg, b.massKg)) continue;
      const big = a.massKg > b.massKg ? a : b;
      const q = choice(`kg:${[a.id, b.id].sort().join(":")}`, `Plus lourd : ${a.name} ou ${b.name} ?`, big.name, [(big === a ? b : a).name],
        `${a.name} : ${fmtKg(a.massKg)} ; ${b.name} : ${fmtKg(b.massKg)}.`, [a.id, b.id], []);
      q.options = [a.name, b.name]; q.answer = big === a ? 0 : 1;
      return q;
    }
    return null;
  }, 1],
  // Régime.
  [({ K }) => {
    if (!K.length) return null;
    const sp = rnd(K);
    const opts = ["Des plantes (herbivore)", "D'autres animaux (carnivore)", "Un peu de tout (omnivore)"];
    const i = sp.behavior.diet === "herbivore" ? 0 : sp.behavior.diet === "carnivore" ? 1 : 2;
    const q = choice(`diet:${sp.id}`, `Que mangeait ${le(sp.name)} ?`, opts[i], [], `${cap(le(sp.name))} était ${sp.behavior.diet}${sp.behavior.scavenger ? ", et mangeait aussi les carcasses" : ""}.`, [sp.id], []);
    q.options = opts; q.answer = i;
    return q;
  }, 1],
  // Dinosaure ou pas ?
  [({ K }) => {
    if (!K.length) return null;
    const sp = rnd(K);
    const q = choice(`dino:${sp.id}`, `Vrai ou faux ? ${sp.name} était un dinosaure.`, isDino(sp.id) ? "Vrai" : "Faux", [],
      isDino(sp.id) ? `Vrai : ${le(sp.name)} était bien un dinosaure.` : `Faux ! ${sp.name} était un ${GROUP[sp.id]}, pas un dinosaure : il vivait pourtant à la même époque.`, [sp.id], []);
    q.options = ["Vrai", "Faux"]; q.answer = isDino(sp.id) ? 0 : 1;
    return q;
  }, 2],
];

function pools(s: GameState): Pools {
  const K = knownList(s);
  const F = K.flatMap((sp) => sp.facts.filter((f) => hasF(s, sp.id, f.id)).map((f) => ({ sp, f })));
  return { K, F };
}

export const quizReady = (s: GameState) => pools(s).F.length >= MIN_FACTS;

function nextQuestion(s: GameState) {
  const qz = s.journal.quiz;
  qz.picked = -1;
  const P = pools(s);
  if (P.F.length < MIN_FACTS) { qz.q = null; return; }
  const total = GENS.reduce((n, [, w]) => n + w, 0);
  let best: Question | null = null;
  for (let n = 0; n < 30; n++) {
    let r = Math.random() * total, g = GENS[0][0];
    for (const [fn, w] of GENS) { if ((r -= w) < 0) { g = fn; break; } }
    const q = g(P);
    if (!q) continue;
    best = q;
    if (!qz.recent.includes(q.key)) break;
  }
  qz.q = best;
  if (best) qz.recent = [best.key, ...qz.recent].slice(0, 10);
}

function answer(s: GameState, i: number) {
  const qz = s.journal.quiz, q = qz.q;
  if (!q || qz.picked >= 0) return;
  qz.picked = i;
  qz.asked++;
  const p = s.progress;
  const st = (p.quiz ??= { correct: 0, answered: 0, bestStreak: 0 });
  st.answered++;
  if (i === q.answer) {
    qz.score++; qz.streak++;
    st.correct++;
    st.bestStreak = Math.max(st.bestStreak, qz.streak);
    if (st.correct % HINT_EVERY === 0) {
      p.hints = (p.hints ?? 0) + 1;
      toast(s, "Indice de fouille gagne !", "Dans la fouille (touche 2), utilise-le pour voir les fossiles caches.");
    }
  } else qz.streak = 0;
  saveProgress(p);
}

export function quizUpdate(s: GameState, input: Input) {
  const qz = s.journal.quiz;
  if (!qz.q && quizReady(s)) nextQuestion(s);
  for (const id of input.ui) {
    if (id.startsWith("journal:q:opt:")) answer(s, Number(id.slice(14)));
    else if (id === "journal:q:next") nextQuestion(s);
  }
  for (const k of input.pressed) if (k === "Enter" && qz.picked >= 0) nextQuestion(s);
}

export function quizPage(s: GameState, th: Theme, world: Frame, ui: Frame) {
  const u = th.ui, qz = s.journal.quiz, p = s.progress;
  const top = UI_TOP;
  const W = Math.min(110, ui.cols - 6), x = Math.floor((ui.cols - W) / 2);
  const st = p.quiz ?? { correct: 0, answered: 0, bestStreak: 0 };
  text(ui, x, top, "Quiz du carnet", u.hi);
  const info = `Score ${qz.score}/${qz.asked}   Série ${qz.streak}   Record ${st.bestStreak}   Indices de fouille : ${p.hints ?? 0}`;
  text(ui, x + W - ascii(info).length, top, info, u.text);
  const left = HINT_EVERY - (st.correct % HINT_EVERY);
  text(ui, x, top + 1, `Toutes les ${HINT_EVERY} bonnes réponses : un indice de fouille (encore ${left}). Il révèle les fossiles cachés d'un site.`, u.dim);

  const H = ui.rows - 3 - (top + 3);
  // Cadre sans fond : les illustrations du calque monde restent visibles.
  box(ui, th, x, top + 3, W, H, u.border);
  const q = qz.q;
  if (!q) {
    const got = pools(s).F.length;
    const msg = [
      "Débloque des faits dans la réserve pour jouer !",
      "",
      `Faits débloqués : ${got}/${MIN_FACTS} au minimum.`,
      "Clique sur les animaux de la réserve quand ils mangent, dorment, appellent... chaque observation remplit le carnet.",
    ];
    let yy = top + 5;
    for (const m of msg) for (const l of wrap(m, W - 8)) text(ui, x + 4, yy++, l, m === msg[0] ? u.hi : u.text, u.panel, u.alpha);
    return;
  }
  const tw = W - 8;
  let yy = top + 5;
  const ill = 22; // place pour l'illustration à droite
  const qw = q.pre.length || qz.picked >= 0 ? tw - ill - 2 : tw;
  for (const l of wrap(q.prompt, qw)) text(ui, x + 4, yy++, l, u.hi, u.panel, u.alpha);
  if (q.quote) { yy++; for (const l of wrap(`« ${q.quote} »`, qw)) text(ui, x + 4, yy++, l, u.text, u.panel, u.alpha); }
  yy++;
  const done = qz.picked >= 0;
  const bw = Math.min(qw - 20, Math.max(30, ...q.options.map((o) => ascii(o).length + 10)));
  q.options.forEach((o, i) => {
    const lab = `${String.fromCharCode(65 + i)})  ${o}`;
    button(ui, th, `journal:q:opt:${i}`, x + 4, yy, lab, { w: bw, disabled: done && i !== q.answer, active: done && i === q.answer });
    if (done && i === q.answer) text(ui, x + 6 + bw, yy, "<- [OK] bonne réponse", u.ok, u.panel, u.alpha);
    else if (done && i === qz.picked) text(ui, x + 6 + bw, yy, "<- [X] ta réponse", u.bad, u.panel, u.alpha);
    yy += 2;
  });
  if (done) {
    const ok = qz.picked === q.answer;
    text(ui, x + 4, yy++, ok ? (qz.streak >= 3 ? `[OK] Bravo ! ${qz.streak} bonnes réponses d'affilée !` : "[OK] Bravo !") : "[X] Raté... mais tu as appris quelque chose :", ok ? u.ok : u.bad, u.panel, u.alpha);
    for (const l of wrap(q.explain, qw)) if (yy < top + 3 + H - 3) text(ui, x + 4, yy++, l, u.text, u.panel, u.alpha);
    button(ui, th, "journal:q:next", x + 4, Math.min(yy + 1, top + 3 + H - 2), "Question suivante", { key: "Entree", variant: "primary" });
  }
  // Illustrations (calque monde).
  const show = [...q.pre, ...(done ? q.post : [])];
  const ih = Math.max(4, Math.min(12, Math.floor((H - 4) / Math.max(1, show.length)) - 1));
  show.forEach((id, i) => {
    const sp = SPECIES[id];
    if (!sp) return;
    const ix = x + W - ill - 3, iy = top + 5 + i * (ih + 1);
    fitSprite(world, th, `quiz:${id}`, sp.model, ix, iy, ill, ih - 1, s.time, 1.2, undefined, 0.05);
    // Pas de nom sous l'image si la question porte justement sur le nom.
    if (!done && q.key.startsWith("fact:")) return;
    text(ui, ix + Math.max(0, Math.floor((ill - ascii(sp.name).length) / 2)), iy + ih - 1, sp.name, u.dim, u.panel, u.alpha);
  });
}
