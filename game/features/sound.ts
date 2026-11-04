import { settings } from "../settings";

/**
 * Moteur de son : tout est synthétisé avec la Web Audio API, aucun fichier audio n'est téléchargé.
 * - Un seul AudioContext, créé (ou relancé) au premier geste du joueur : règles d'autoplay des navigateurs.
 * - Chaîne : bus effets + bus ambiance -> étouffoir (neige, brouillard) -> compresseur-limiteur
 *   (jamais de saturation) -> volume du joueur -> sortie.
 * - Sons ponctuels (`play`) : deux ou trois oscillateurs ou bruits filtrés à enveloppe courte, programmés
 *   un peu en avance, débranchés dès qu'ils se taisent.
 * - Ambiance (`setBed`) : des lits de bruit filtré en boucle (vent, sable, ressac, pluie) et un bourdonnement
 *   d'insectes, créés une seule fois ; on ne fait que glisser leurs gains et leurs filtres.
 * - Limiteur de voix : jamais plus de MAX_VOICES sons ponctuels à la fois, et un même son espacé d'un délai,
 *   pour que des dizaines d'animaux ne s'empilent jamais.
 * Sans Web Audio (Node, scripts de simulation) : tout est un no-op silencieux.
 */

const MAX_VOICES = 12;

// ---------------------------------------------------------------------------
// Parties pures (testées par scripts/test-sound.ts)
// ---------------------------------------------------------------------------

/**
 * Limiteur de voix : renvoie une fonction qui accepte ou refuse un son `key` de durée `dur` à l'instant `now`
 * (s) : au plus `max` voix en cours, et le même `key` pas plus d'une fois tous les `gap` s.
 */
export function createLimiter(max: number) {
  const ends: number[] = [];
  const last = new Map<string, number>();
  return (key: string, now: number, gap: number, dur: number): boolean => {
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends.splice(i, 1);
    if (ends.length >= max || now - (last.get(key) ?? -1e9) < gap) return false;
    last.set(key, now);
    ends.push(now + dur);
    return true;
  };
}

/**
 * Atténuation et panoramique d'une source (px monde) vue depuis le centre de la caméra (cx, cy) ; hw, hh :
 * demi-largeur et demi-hauteur de la vue. Plein volume au centre, un quart au bord de l'écran, silence à
 * deux demi-vues ; panoramique selon l'écart horizontal (jamais tout à fait sur une seule oreille).
 */
export function spatial(x: number, y: number, cx: number, cy: number, hw: number, hh: number): { gain: number; pan: number } {
  const dx = (x - cx) / hw, dy = (y - cy) / hh;
  const d = Math.hypot(dx, dy);
  const k = Math.max(0, 1 - d / 2);
  return { gain: k * k, pan: Math.max(-0.8, Math.min(0.8, dx * 0.8)) };
}

// ---------------------------------------------------------------------------
// Contexte et chaîne de sortie
// ---------------------------------------------------------------------------

type BedName = "wind" | "hiss" | "surf" | "rain" | "buzz";
interface Bed { f: BiquadFilterNode; g: GainNode }

let ctx: AudioContext | null = null;
let out: { master: GainNode; muffle: BiquadFilterNode; sfx: GainNode; amb: GainNode; noise: AudioBuffer; beds: Record<BedName, Bed> } | null = null;
const limit = createLimiter(MAX_VOICES);

/** Crée (premier geste) ou relance le contexte audio. Sans Web Audio : rien. */
export function unlockAudio() {
  if (!ctx) {
    if (typeof AudioContext === "undefined") return;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    build(ctx);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function build(c: AudioContext) {
  const master = c.createGain();
  const comp = c.createDynamicsCompressor();
  // Compresseur réglé en limiteur doux : un orage et un T. rex ensemble ne saturent pas.
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.004; comp.release.value = 0.3;
  const muffle = c.createBiquadFilter();
  muffle.type = "lowpass"; muffle.frequency.value = 18000;
  const sfx = c.createGain(), amb = c.createGain();
  sfx.connect(muffle); amb.connect(muffle); muffle.connect(comp); comp.connect(master); master.connect(c.destination);
  // Bruit blanc stéréo (deux canaux indépendants : l'ambiance est large), 2 s en boucle.
  const noise = c.createBuffer(2, c.sampleRate * 2, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = noise.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const bed = (type: BiquadFilterType, freq: number, q: number): Bed => {
    const src = c.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(amb);
    src.start(0, Math.random() * 2);
    return { f, g };
  };
  // Bourdonnement d'insectes : deux dents de scie presque accordées (battement lent), très filtrées.
  const buzzF = c.createBiquadFilter();
  buzzF.type = "bandpass"; buzzF.frequency.value = 520; buzzF.Q.value = 2;
  const buzzG = c.createGain();
  buzzG.gain.value = 0;
  for (const hz of [176, 179.5]) {
    const o = c.createOscillator();
    o.type = "sawtooth"; o.frequency.value = hz;
    o.connect(buzzF);
    o.start();
  }
  buzzF.connect(buzzG).connect(amb);
  out = {
    master, muffle, sfx, amb, noise,
    beds: {
      wind: bed("lowpass", 420, 1.2),
      hiss: bed("highpass", 4800, 0.7),
      surf: bed("lowpass", 520, 0.7),
      rain: bed("bandpass", 2600, 0.5),
      buzz: { f: buzzF, g: buzzG },
    },
  };
  applyVolume();
}

/** Volume et coupure (réglages) : courbe en carré, plus naturelle à l'oreille. */
export function applyVolume() {
  if (!ctx || !out) return;
  out.master.gain.setTargetAtTime(settings.mute ? 0 : settings.volume * settings.volume, ctx.currentTime, 0.05);
}

/** Le son est-il prêt et audible ? (sinon le jeu ne calcule rien pour lui). */
export const audible = () => !!ctx && ctx.state === "running" && !settings.mute && settings.volume > 0;

/** Branche le déverrouillage au premier geste et la pause quand l'onglet est caché. Renvoie un nettoyeur. */
export function bindSound(): () => void {
  const onGesture = () => unlockAudio();
  const onVis = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };
  window.addEventListener("pointerdown", onGesture);
  window.addEventListener("keydown", onGesture);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    document.removeEventListener("visibilitychange", onVis);
    void ctx?.suspend();
  };
}

// ---------------------------------------------------------------------------
// Ambiance : lits continus, étouffoir, bus
// ---------------------------------------------------------------------------

/** Glisse un lit d'ambiance vers un gain (et une fréquence de filtre) en `tc` s : les fondus enchaînés. */
export function setBed(name: BedName, gain: number, freq?: number, tc = 0.8) {
  if (!ctx || !out) return;
  const b = out.beds[name], t = ctx.currentTime;
  b.g.gain.setTargetAtTime(gain, t, tc);
  if (freq !== undefined) b.f.frequency.setTargetAtTime(freq, t, tc);
}

/** Étouffoir global (neige, brouillard) : fréquence de coupure en Hz. */
export function setMuffle(freq: number) {
  if (ctx && out) out.muffle.frequency.setTargetAtTime(freq, ctx.currentTime, 1);
}

/** Niveau du bus d'ambiance (menu ouvert, écrans d'intérieur, noir de la météorite). */
export function setAmbience(gain: number, tc = 0.6) {
  if (ctx && out) out.amb.gain.setTargetAtTime(gain, ctx.currentTime, tc);
}

// ---------------------------------------------------------------------------
// Briques des sons ponctuels
// ---------------------------------------------------------------------------

interface Voice { c: AudioContext; t: number; dest: GainNode; noise: AudioBuffer }

/** Enveloppe : montée linéaire, maintien, chute exponentielle (sans clic). */
function env(p: AudioParam, t: number, peak: number, a: number, hold: number, rel: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
}

interface Shape {
  /** Départ (s après la voix), attaque, maintien, chute, gain crête. */
  at?: number;
  a?: number;
  hold?: number;
  rel?: number;
  gain?: number;
  /** Filtre : type, fréquence de départ et d'arrivée, résonance. */
  filter?: BiquadFilterType;
  ff?: number;
  ffTo?: number;
  q?: number;
}
interface Tone extends Shape {
  type?: OscillatorType;
  f: number;
  to?: number;
  /** Modulation d'amplitude (Hz) : la rugosité d'un grognement. */
  am?: number;
}

/** Branche l'enveloppe (et le filtre) d'une brique ; renvoie l'entrée et l'instant de fin. */
function shaped(v: Voice, o: Shape): { input: AudioNode; t0: number; t1: number } {
  const t0 = v.t + (o.at ?? 0), a = o.a ?? 0.005, hold = o.hold ?? 0, rel = o.rel ?? 0.1;
  const g = v.c.createGain();
  env(g.gain, t0, o.gain ?? 0.3, a, hold, rel);
  g.connect(v.dest);
  let input: AudioNode = g;
  if (o.filter) {
    const f = v.c.createBiquadFilter();
    f.type = o.filter; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.ff ?? 1000, t0);
    if (o.ffTo) f.frequency.exponentialRampToValueAtTime(o.ffTo, t0 + a + hold + rel);
    f.connect(g);
    input = f;
  }
  return { input, t0, t1: t0 + a + hold + rel + 0.02 };
}

function tone(v: Voice, o: Tone) {
  const { input, t0, t1 } = shaped(v, o);
  const osc = v.c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t1 - 0.02);
  if (o.am) {
    const am = v.c.createGain(), lfo = v.c.createOscillator(), depth = v.c.createGain();
    am.gain.value = 0.5; depth.gain.value = 0.5; lfo.frequency.value = o.am;
    lfo.connect(depth).connect(am.gain);
    osc.connect(am).connect(input);
    lfo.start(t0); lfo.stop(t1);
  } else osc.connect(input);
  osc.start(t0); osc.stop(t1);
}

function hiss(v: Voice, o: Shape) {
  const { input, t0, t1 } = shaped(v, o);
  const src = v.c.createBufferSource();
  src.buffer = v.noise;
  src.connect(input);
  src.start(t0, Math.random() * 1.5);
  src.stop(t1);
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------

/**
 * Chaque son : durée (pour le limiteur), écart minimal entre deux occurrences (s), et sa recette.
 * `p` : hauteur de base (Hz) tirée de la taille de l'animal (voir sound-watch.ts), ou un paramètre libre.
 */
const RECIPES = {
  // Interface
  click: { dur: 0.06, gap: 0.04, fn: (v: Voice) => tone(v, { f: 1900, to: 1500, rel: 0.05, gain: 0.16 }) },
  tick: { dur: 0.05, gap: 0.05, fn: (v: Voice) => tone(v, { f: 1250, rel: 0.04, gain: 0.08 }) },
  // Cris des animaux
  trumpet: {
    dur: 1.5, gap: 1.2,
    fn: (v: Voice, p: number) => {
      // Hadrosaure : l'air passe dans la crête creuse, un cor grave et résonant.
      for (const d of [1, 1.006]) tone(v, { type: "sawtooth", f: p * 1.6 * d, to: p * 1.45 * d, a: 0.18, hold: 0.7, rel: 0.5, gain: 0.13, filter: "lowpass", ff: p * 9, ffTo: p * 4, q: 7 });
      tone(v, { f: p * 0.8, a: 0.2, hold: 0.6, rel: 0.5, gain: 0.12 });
    },
  },
  growl: {
    dur: 1.4, gap: 1.5,
    fn: (v: Voice, p: number) => {
      tone(v, { type: "sawtooth", f: p * 0.6, to: p * 0.48, a: 0.12, hold: 0.55, rel: 0.55, gain: 0.45, filter: "lowpass", ff: 380, q: 2, am: 21 });
      hiss(v, { a: 0.15, hold: 0.45, rel: 0.5, gain: 0.18, filter: "bandpass", ff: 260, ffTo: 160, q: 1.4 });
    },
  },
  rumble: {
    dur: 2.1, gap: 2.5,
    fn: (v: Voice, p: number) => {
      // Sauropode : un grondement très grave, presque senti plus qu'entendu.
      const f = Math.max(40, p * 0.55);
      tone(v, { f, to: f * 0.88, a: 0.4, hold: 0.8, rel: 0.8, gain: 0.5 });
      tone(v, { type: "triangle", f: f * 2, to: f * 1.8, a: 0.4, hold: 0.6, rel: 0.7, gain: 0.12 });
    },
  },
  honk: {
    dur: 0.65, gap: 1,
    fn: (v: Voice, p: number) => {
      for (let i = 0; i < 2; i++) tone(v, { type: "square", at: i * 0.27, f: p * 2.2, to: p * 1.9, a: 0.02, hold: 0.1, rel: 0.12, gain: 0.14, filter: "bandpass", ff: p * 5.5, q: 3 });
    },
  },
  chirp: {
    dur: 0.45, gap: 0.6,
    fn: (v: Voice, p: number) => {
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) tone(v, { type: "triangle", at: i * 0.11, f: p * 14, to: p * 9.5, a: 0.005, hold: 0.03, rel: 0.05, gain: 0.11 });
    },
  },
  cry: {
    dur: 0.75, gap: 1,
    fn: (v: Voice, p: number) => {
      const f = p * 5;
      tone(v, { type: "sawtooth", f, to: f * 1.3, a: 0.04, hold: 0.12, rel: 0.1, gain: 0.12, filter: "bandpass", ff: f * 2, q: 2 });
      tone(v, { type: "sawtooth", at: 0.25, f: f * 1.3, to: f * 0.75, a: 0.02, hold: 0.15, rel: 0.25, gain: 0.12, filter: "bandpass", ff: f * 2, q: 2 });
    },
  },
  splash: {
    dur: 0.75, gap: 0.5,
    fn: (v: Voice) => {
      hiss(v, { a: 0.01, hold: 0.05, rel: 0.55, gain: 0.4, filter: "bandpass", ff: 1500, ffTo: 350, q: 0.8 });
      tone(v, { f: 95, to: 40, rel: 0.3, gain: 0.3 });
    },
  },
  step: {
    dur: 0.25, gap: 0.32,
    fn: (v: Voice, p: number) => {
      tone(v, { f: p, to: p * 0.6, rel: 0.18, gain: 0.45 });
      hiss(v, { rel: 0.08, gain: 0.18, filter: "lowpass", ff: 260 });
    },
  },
  crunch: {
    dur: 0.18, gap: 0.7,
    fn: (v: Voice) => {
      for (let i = 0; i < 2; i++) hiss(v, { at: i * rnd(0.04, 0.07), rel: 0.05, gain: 0.14, filter: "highpass", ff: 2400 });
    },
  },
  flap: {
    dur: 0.45, gap: 0.6,
    fn: (v: Voice) => {
      for (let i = 0; i < 3; i++) hiss(v, { at: i * 0.13, a: 0.03, rel: 0.08, gain: 0.2, filter: "lowpass", ff: 700 });
    },
  },
  strike: {
    dur: 0.22, gap: 0.3,
    fn: (v: Voice) => {
      hiss(v, { rel: 0.12, gain: 0.18, filter: "bandpass", ff: 900, ffTo: 300 });
      tone(v, { f: 110, to: 50, rel: 0.15, gain: 0.2 });
    },
  },
  thud: {
    dur: 0.6, gap: 0.5,
    fn: (v: Voice) => {
      tone(v, { f: 70, to: 35, rel: 0.5, gain: 0.35 });
      hiss(v, { rel: 0.3, gain: 0.15, filter: "lowpass", ff: 300 });
    },
  },
  cheep: {
    dur: 0.5, gap: 0.4,
    fn: (v: Voice) => {
      for (let i = 0; i < 4; i++) tone(v, { at: i * rnd(0.07, 0.11), f: rnd(3000, 3400), to: rnd(3700, 4100), rel: 0.05, gain: 0.07 });
    },
  },
  // Météo
  crack: {
    dur: 0.3, gap: 0.5,
    fn: (v: Voice) => {
      hiss(v, { a: 0.001, rel: 0.25, gain: 0.35, filter: "highpass", ff: 1500 });
      hiss(v, { a: 0.001, rel: 0.1, gain: 0.2, filter: "bandpass", ff: 3200 });
    },
  },
  thunder: {
    dur: 3.6, gap: 1.5,
    fn: (v: Voice) => {
      hiss(v, { a: 0.02, hold: 0.2, rel: 2.8, gain: 0.8, filter: "lowpass", ff: 900, ffTo: 110, q: 0.7 });
      hiss(v, { at: rnd(0.4, 0.8), a: 0.3, rel: 1.6, gain: 0.45, filter: "lowpass", ff: 220 });
      tone(v, { f: 52, to: 30, a: 0.05, rel: 2, gain: 0.4 });
    },
  },
  // Petites bêtes de l'ambiance
  bird: {
    dur: 0.7, gap: 0.35,
    fn: (v: Voice) => {
      const n = 2 + Math.floor(Math.random() * 3), base = rnd(2200, 3600);
      for (let i = 0; i < n; i++) tone(v, { at: i * 0.13, f: base * rnd(0.85, 1.15), to: base * rnd(0.7, 1.3), a: 0.01, hold: 0.04, rel: 0.05, gain: 0.07 });
    },
  },
  cricket: {
    dur: 0.2, gap: 0.12,
    fn: (v: Voice) => {
      const f = rnd(4200, 4700);
      for (let i = 0; i < 3; i++) tone(v, { at: i * 0.055, f, a: 0.003, hold: 0.02, rel: 0.02, gain: 0.035 });
    },
  },
  frog: {
    dur: 0.3, gap: 0.2,
    fn: (v: Voice) => {
      const f = rnd(170, 280);
      for (let i = 0; i < 2; i++) tone(v, { type: "square", at: i * 0.11, f, to: f * 0.9, a: 0.01, hold: 0.05, rel: 0.04, gain: 0.1, filter: "bandpass", ff: 700, q: 4 });
    },
  },
  drip: { dur: 0.1, gap: 0.15, fn: (v: Voice) => tone(v, { f: rnd(1300, 1700), to: 650, a: 0.001, rel: 0.07, gain: 0.06 }) },
  // Fouille
  brush: { dur: 0.14, gap: 0.11, fn: (v: Voice) => hiss(v, { a: 0.02, hold: 0.04, rel: 0.06, gain: 0.09, filter: "bandpass", ff: rnd(3800, 5200), q: 0.7 }) },
  chisel: {
    dur: 0.1, gap: 0.16,
    fn: (v: Voice) => {
      tone(v, { type: "square", f: rnd(2500, 2800), to: 2300, rel: 0.04, gain: 0.04 });
      hiss(v, { rel: 0.03, gain: 0.15, filter: "highpass", ff: 3000 });
      tone(v, { f: 320, to: 200, rel: 0.05, gain: 0.15 });
    },
  },
  loupe: {
    dur: 0.6, gap: 0.3,
    fn: (v: Voice) => {
      tone(v, { f: 2600, a: 0.01, rel: 0.5, gain: 0.05 });
      tone(v, { at: 0.06, f: 3900, a: 0.01, rel: 0.45, gain: 0.035 });
    },
  },
  tok: { dur: 0.08, gap: 0.25, fn: (v: Voice) => tone(v, { type: "triangle", f: 300, to: 220, rel: 0.06, gain: 0.14 }) },
  shatter: {
    dur: 0.35, gap: 0.3,
    fn: (v: Voice) => {
      hiss(v, { rel: 0.25, gain: 0.3, filter: "bandpass", ff: 1300, ffTo: 500, q: 1.2 });
      tone(v, { type: "sawtooth", f: 420, to: 110, rel: 0.25, gain: 0.06, filter: "lowpass", ff: 1200 });
    },
  },
  chime: {
    dur: 0.9, gap: 0.3,
    fn: (v: Voice) => {
      [660, 880, 1320].forEach((f, i) => tone(v, { at: i * 0.09, f, a: 0.005, rel: 0.5, gain: 0.08 }));
    },
  },
  // Atelier
  place: {
    dur: 0.08, gap: 0.05,
    fn: (v: Voice) => {
      tone(v, { type: "triangle", f: 900, to: 700, rel: 0.05, gain: 0.16 });
      hiss(v, { rel: 0.03, gain: 0.08, filter: "bandpass", ff: 2500 });
    },
  },
  wrong: { dur: 0.2, gap: 0.2, fn: (v: Voice) => tone(v, { type: "triangle", f: 170, to: 120, rel: 0.16, gain: 0.2 }) },
  synth: {
    dur: 2.7, gap: 2,
    fn: (v: Voice) => {
      // La synthèse : une montée qui scintille pendant les 2,5 s de l'animation.
      tone(v, { type: "sawtooth", f: 110, to: 880, a: 0.3, hold: 1.9, rel: 0.3, gain: 0.07, filter: "lowpass", ff: 300, ffTo: 5000, q: 8 });
      tone(v, { f: 220, to: 1760, a: 0.3, hold: 1.9, rel: 0.3, gain: 0.05, am: 9 });
      hiss(v, { a: 1.5, hold: 0.7, rel: 0.3, gain: 0.05, filter: "bandpass", ff: 600, ffTo: 6000, q: 2 });
    },
  },
  reveal: {
    dur: 1.6, gap: 1,
    fn: (v: Voice) => {
      [523, 659, 784, 1046].forEach((f, i) => tone(v, { at: i * 0.06, f, a: 0.01, hold: 0.2, rel: 1.2, gain: 0.07 }));
    },
  },
  // Météorite
  approach: {
    dur: 4.2, gap: 3,
    fn: (v: Voice, p: number) => {
      hiss(v, { a: p, hold: 0.1, rel: 0.15, gain: 0.35, filter: "bandpass", ff: 250, ffTo: 2600, q: 1.5 });
      tone(v, { type: "sawtooth", f: 60, to: 140, a: p, rel: 0.15, gain: 0.08, filter: "lowpass", ff: 300 });
    },
  },
  impact: {
    dur: 4.8, gap: 3,
    fn: (v: Voice) => {
      tone(v, { f: 62, to: 22, a: 0.01, hold: 0.3, rel: 4.2, gain: 0.9 });
      hiss(v, { a: 0.005, hold: 0.3, rel: 4.2, gain: 0.8, filter: "lowpass", ff: 2200, ffTo: 70 });
    },
  },
  debris: {
    dur: 0.5, gap: 0.12,
    fn: (v: Voice) => {
      tone(v, { f: rnd(70, 110), to: 38, rel: 0.4, gain: 0.25 });
      hiss(v, { rel: 0.3, gain: 0.15, filter: "lowpass", ff: 600 });
    },
  },
  roar: {
    dur: 5.6, gap: 3,
    fn: (v: Voice) => {
      // L'onde de choc : un souffle énorme qui balaie la réserve puis s'éteint dans la poussière.
      hiss(v, { a: 0.25, hold: 1.8, rel: 3.4, gain: 0.7, filter: "lowpass", ff: 1600, ffTo: 180 });
      tone(v, { f: 46, to: 32, a: 0.4, hold: 1.8, rel: 3.2, gain: 0.45 });
    },
  },
} satisfies Record<string, { dur: number; gap: number; fn: (v: Voice, p: number) => void }>;

export type Sfx = keyof typeof RECIPES;

export interface PlayOpts {
  /** Gain (atténuation de distance comprise), panoramique -1..1, paramètre de la recette. */
  gain?: number;
  pan?: number;
  p?: number;
  /** Clé du limiteur (par défaut le nom du son) : par espèce, pour que deux espèces puissent se répondre. */
  key?: string;
  /** Sur le bus d'ambiance (coupé avec elle) plutôt que celui des effets. */
  amb?: boolean;
}

/** Joue un son ponctuel (si le limiteur l'accepte). */
export function play(name: Sfx, o: PlayOpts = {}) {
  if (!ctx || !out || ctx.state !== "running") return;
  const gain = o.gain ?? 1;
  if (gain < 0.004) return;
  const r = RECIPES[name];
  const t = ctx.currentTime + 0.03;
  if (!limit(o.key ?? name, t, r.gap, r.dur)) return;
  const dest = ctx.createGain();
  dest.gain.value = gain;
  const pan = ctx.createStereoPanner();
  pan.pan.value = o.pan ?? 0;
  dest.connect(pan).connect(o.amb ? out.amb : out.sfx);
  r.fn({ c: ctx, t, dest, noise: out.noise }, o.p ?? 100);
  // Les sources s'arrêtent seules ; on débranche la sortie de la voix ensuite.
  setTimeout(() => pan.disconnect(), (r.dur + 0.5) * 1000);
}

/** Tous les sons (pour les essais : scripts/test-sound.ts). */
export const SFX_NAMES = Object.keys(RECIPES) as Sfx[];
