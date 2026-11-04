const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  KeyA: [-1, 0], KeyQ: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyZ: [0, -1], KeyS: [0, 1],
};
/**
 * Touches lues par le jeu (les autres restent au navigateur). Carte du clavier :
 * 1-6 onglets ; Tab / Maj+Tab focus suivant / précédent ; Entrée / Espace activer ; Échap retour puis menu ;
 * Retour arrière : retour ; H aide ; V documentaire ; P appareil photo ; C recensement ; M carte ; T temps ;
 * E/R/F outils de fouille ; N (dev) debug navigation ; flèches / ZQSD / WASD déplacements ;
 * zoom de la réserve : les deux touches à droite du 0 (« = » et « ) » en AZERTY, « = » et « - » en QWERTY),
 * + et - du pavé numérique, pincement ou Ctrl + molette.
 * Écran tactile : un doigt glisse et touche (clic), deux doigts pincent (zoom), voir `pointer`.
 */
const PRESS = new Set(["Equal", "Minus", "NumpadAdd", "NumpadSubtract", "Escape", "Enter", "Space", "Tab", "Backspace", "KeyH", "KeyT", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "KeyP", "KeyV", "KeyM", "KeyE", "KeyR", "KeyF", "KeyC", "KeyN", ...Object.keys(KEYS)]);

export interface Click {
  /** Position en px CSS dans le canvas. */
  x: number;
  y: number;
  button: number;
}

export interface Input {
  /** Direction maintenue (flèches, ZQSD, WASD). */
  dx: number;
  dy: number;
  /** Touches enfoncées depuis la dernière lecture (codes physiques ; « ShiftTab » pour Maj+Tab). */
  pressed: string[];
  mouse: {
    /** Position courante en px CSS dans le canvas. */
    x: number;
    y: number;
    inside: boolean;
    /** Bouton gauche enfoncé. */
    down: boolean;
    /** Clics (appui + relâché sans glisser) depuis la dernière lecture. */
    clicks: Click[];
    /** Appuis (début d'un geste) depuis la dernière lecture : utile pour gratter, glisser-déposer. */
    presses: Click[];
    /** Relâchés depuis la dernière lecture. */
    releases: Click[];
    /** Déplacement cumulé bouton enfoncé depuis la dernière lecture (px CSS). */
    dragX: number;
    dragY: number;
    /** Molette cumulée. */
    wheel: number;
    /** Zoom cumulé (pincement du pavé tactile, Ctrl/Cmd + molette) : < 0 zoom avant. Absent = 0. */
    zoom?: number;
  };
  /** Clics routés vers l'interface (ids des zones cliquées), remplis par le cœur des scènes. */
  ui: string[];
  /** Clics qui ne sont pas tombés sur l'interface : à traiter comme des clics dans le monde. */
  worldClicks: Click[];
}

/**
 * Écran tactile ? Vrai quand le dernier geste vient d'un doigt (au départ : l'appareil n'a qu'un pointeur
 * grossier) ; une souris, un stylet ou une touche du clavier le remettent à faux. L'interface s'y adapte :
 * pas de pastilles de touches, des gestes dans la ligne d'aide, des boutons à la place du clavier.
 *
 * `coarse` : l'appareil n'a qu'un pointeur grossier (téléphone, tablette) ; fixé au départ, il choisit la
 * taille d'interface « auto » (un écran tactile d'ordinateur garde sa taille).
 */
export const pointer = { touch: false, coarse: false };

/** Déplacement (px CSS cumulés) au-delà duquel un appui n'est plus un clic : souris, doigt. */
const TAP_SLOP = { mouse: 6, touch: 14 };
/** Pincement : unités de `mouse.zoom` par px d'écart entre les deux doigts. */
const PINCH_GAIN = 1.5;

/** Glisser vertical pas encore converti en crans de molette (px), voir `dragToWheel`. */
let scrollAcc = 0;

/**
 * Écran tactile : le glisser d'un doigt fait défiler comme la molette (un cran tous les `step` px, doigt
 * vers le haut = descendre) au lieu de glisser. Sans effet à la souris.
 */
export function dragToWheel(input: Input, step: number) {
  const m = input.mouse;
  if (!pointer.touch || !m.down) { scrollAcc = 0; return; }
  scrollAcc -= m.dragY;
  m.dragX = m.dragY = 0;
  const n = Math.trunc(scrollAcc / step);
  if (n) { m.wheel += n * 100; scrollAcc -= n * step; }
}

/** Écoute clavier, souris et doigts. Renvoie un lecteur (à appeler à chaque pas de logique) et un nettoyeur. */
export function bindInput(canvas: HTMLCanvasElement): { read: () => Input; dispose: () => void } {
  const down = new Set<string>();
  let pressed: string[] = [];
  const mouse: Input["mouse"] = { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0, zoom: 0 };
  let start: { x: number; y: number } | null = null;
  let moved = 0;
  // Doigts posés (id -> position) et écart du pincement en cours (0 : pas de pincement).
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  try {
    pointer.touch = pointer.coarse = matchMedia("(pointer: coarse)").matches;
  } catch {
    // Pas de matchMedia : on attend le premier geste.
  }

  const pos = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: KeyboardEvent) => {
    if (!PRESS.has(e.code)) return;
    e.preventDefault();
    pointer.touch = false;
    if (KEYS[e.code]) down.add(e.code);
    // Maj+Tab : focus précédent (code à part, pour ne pas suivre l'état des touches de modification).
    if (!e.repeat) pressed.push(e.code === "Tab" && e.shiftKey ? "ShiftTab" : e.code);
  };
  const onUp = (e: KeyboardEvent) => down.delete(e.code);
  const onBlur = () => { down.clear(); mouse.down = false; fingers.clear(); pinch = 0; };
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPDown = (e: PointerEvent) => {
    const p = pos(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur synthétique ou déjà relâché : la capture est un confort, pas une nécessité.
    }
    pointer.touch = e.pointerType === "touch";
    if (pointer.touch) {
      fingers.set(e.pointerId, p);
      // Deuxième doigt : pincement. Le premier appui n'est plus ni un glisser ni un clic.
      if (fingers.size >= 2) { pinch = spread(); mouse.down = false; start = null; return; }
    }
    if (e.button === 0) { mouse.down = true; start = p; moved = 0; }
    // Le doigt n'a pas survolé avant d'appuyer : la position part d'ici (sinon le premier glisser saute).
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
    mouse.presses.push({ ...p, button: e.button });
  };
  const onPMove = (e: PointerEvent) => {
    const p = pos(e);
    if (fingers.has(e.pointerId)) {
      fingers.set(e.pointerId, p);
      if (fingers.size >= 2) {
        // Écarter les doigts zoome (zoom < 0), centré entre eux.
        const d = spread(), [a, b] = [...fingers.values()];
        mouse.zoom = (mouse.zoom ?? 0) - (d - pinch) * PINCH_GAIN;
        pinch = d;
        mouse.x = (a.x + b.x) / 2; mouse.y = (a.y + b.y) / 2; mouse.inside = true;
        return;
      }
      // Doigt resté après un pincement : il ne reprend pas la main (pas de glisser parasite).
      if (pinch) return;
    }
    if (mouse.down) { mouse.dragX += p.x - mouse.x; mouse.dragY += p.y - mouse.y; moved += Math.abs(p.x - mouse.x) + Math.abs(p.y - mouse.y); }
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  };
  const onPUp = (e: PointerEvent) => {
    const p = pos(e);
    const finger = fingers.delete(e.pointerId);
    if (finger && pinch) {
      if (!fingers.size) { pinch = 0; mouse.inside = false; mouse.x = mouse.y = -1; }
      return;
    }
    if (e.button === 0) mouse.down = false;
    mouse.releases.push({ ...p, button: e.button });
    // Appui annulé par le navigateur (pointercancel) : pas un clic.
    if (start && e.type === "pointerup" && moved < (finger ? TAP_SLOP.touch : TAP_SLOP.mouse)) mouse.clicks.push({ ...p, button: e.button });
    start = null;
    // Un doigt levé ne survole plus rien (pas d'étiquette ni d'infobulle qui restent affichées).
    if (finger) { mouse.inside = false; mouse.x = mouse.y = -1; }
  };
  const onLeave = () => { mouse.inside = false; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Le pincement d'un pavé tactile arrive comme une molette avec Ctrl.
    if (e.ctrlKey || e.metaKey) mouse.zoom = (mouse.zoom ?? 0) + e.deltaY;
    else mouse.wheel += e.deltaY;
  };
  const onMenu = (e: Event) => e.preventDefault();
  // Safari iOS : son propre geste de pincement (zoom de la page) passe outre touch-action.
  const onGesture = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPDown);
  canvas.addEventListener("pointermove", onPMove);
  canvas.addEventListener("pointerup", onPUp);
  canvas.addEventListener("pointercancel", onPUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onMenu);
  document.addEventListener("gesturestart", onGesture);
  return {
    read: () => {
      let dx = 0, dy = 0;
      for (const k of down) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
      const p = pressed;
      pressed = [];
      const m = { ...mouse, clicks: mouse.clicks, presses: mouse.presses, releases: mouse.releases };
      mouse.clicks = []; mouse.presses = []; mouse.releases = []; mouse.dragX = 0; mouse.dragY = 0; mouse.wheel = 0; mouse.zoom = 0;
      return { dx: Math.sign(dx), dy: Math.sign(dy), pressed: p, mouse: m, ui: [], worldClicks: [] };
    },
    dispose: () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPDown);
      canvas.removeEventListener("pointermove", onPMove);
      canvas.removeEventListener("pointerup", onPUp);
      canvas.removeEventListener("pointercancel", onPUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("gesturestart", onGesture);
    },
  };
}
