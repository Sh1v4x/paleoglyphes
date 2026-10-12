const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  KeyA: [-1, 0], KeyQ: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyZ: [0, -1], KeyS: [0, 1],
};
const PRESS = new Set(["Escape", "Enter", "Space", "Tab", "Digit1", "Digit2", "Digit3", "Digit4", "KeyE", "KeyR", "KeyF", "KeyC", ...Object.keys(KEYS)]);

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
  /** Touches enfoncées depuis la dernière lecture (codes physiques). */
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
  };
  /** Clics routés vers l'interface (ids des zones cliquées), remplis par le cœur des scènes. */
  ui: string[];
  /** Clics qui ne sont pas tombés sur l'interface : à traiter comme des clics dans le monde. */
  worldClicks: Click[];
}

/** Écoute clavier et souris. Renvoie un lecteur (à appeler à chaque pas de logique) et un nettoyeur. */
export function bindInput(canvas: HTMLCanvasElement): { read: () => Input; dispose: () => void } {
  const down = new Set<string>();
  let pressed: string[] = [];
  const mouse: Input["mouse"] = { x: -1, y: -1, inside: false, down: false, clicks: [], presses: [], releases: [], dragX: 0, dragY: 0, wheel: 0 };
  let start: { x: number; y: number } | null = null;
  let moved = 0;

  const pos = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: KeyboardEvent) => {
    if (!PRESS.has(e.code)) return;
    e.preventDefault();
    if (KEYS[e.code]) down.add(e.code);
    if (!e.repeat) pressed.push(e.code);
  };
  const onUp = (e: KeyboardEvent) => down.delete(e.code);
  const onBlur = () => { down.clear(); mouse.down = false; };
  const onPDown = (e: PointerEvent) => {
    const p = pos(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur synthétique ou déjà relâché : la capture est un confort, pas une nécessité.
    }
    if (e.button === 0) { mouse.down = true; start = p; moved = 0; }
    mouse.presses.push({ ...p, button: e.button });
  };
  const onPMove = (e: PointerEvent) => {
    const p = pos(e);
    if (mouse.down) { mouse.dragX += p.x - mouse.x; mouse.dragY += p.y - mouse.y; moved += Math.abs(p.x - mouse.x) + Math.abs(p.y - mouse.y); }
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  };
  const onPUp = (e: PointerEvent) => {
    const p = pos(e);
    if (e.button === 0) mouse.down = false;
    mouse.releases.push({ ...p, button: e.button });
    if (start && moved < 6) mouse.clicks.push({ ...p, button: e.button });
    start = null;
  };
  const onLeave = () => { mouse.inside = false; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); mouse.wheel += e.deltaY; };
  const onMenu = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPDown);
  canvas.addEventListener("pointermove", onPMove);
  canvas.addEventListener("pointerup", onPUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onMenu);
  return {
    read: () => {
      let dx = 0, dy = 0;
      for (const k of down) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
      const p = pressed;
      pressed = [];
      const m = { ...mouse, clicks: mouse.clicks, presses: mouse.presses, releases: mouse.releases };
      mouse.clicks = []; mouse.presses = []; mouse.releases = []; mouse.dragX = 0; mouse.dragY = 0; mouse.wheel = 0;
      return { dx: Math.sign(dx), dy: Math.sign(dy), pressed: p, mouse: m, ui: [], worldClicks: [] };
    },
    dispose: () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPDown);
      canvas.removeEventListener("pointermove", onPMove);
      canvas.removeEventListener("pointerup", onPUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onMenu);
    },
  };
}
