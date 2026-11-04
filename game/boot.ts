import { DEV, FONT_SIZE } from "./config";
import { bindSound } from "./features/sound";
import { bindInput } from "./input";
import { startLoop } from "./loop";
import { Renderer } from "./render/draw";
import { view } from "./render/metrics";
import { autosave, loadReserve, saveReserve } from "./save";
import { composeGame, updateGame } from "./scenes";
import { prepareEcosystem } from "./scenes/ecosystem";
import { worldZoom } from "./scenes/park";
import { createState, worldFor } from "./state";
import { STRINGS } from "./strings";
import { toast } from "./ui/toast";

export interface BootHooks {
  /** Étape annoncée par l'écran de chargement (null : le jeu est prêt). */
  onStep: (label: string | null) => void;
  /** Le composant a été démonté pendant le chargement. */
  cancelled: () => boolean;
}

/** Laisse le navigateur afficher l'étape annoncée avant un calcul qui l'occupe. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function loadFont(fontFamily: string) {
  try {
    await document.fonts.load(`${FONT_SIZE}px ${fontFamily}`);
    await document.fonts.ready;
  } catch {
    // Police indisponible (réseau, bloqueur) : la police de repli de la pile CSS suffit pour jouer.
  }
}

/**
 * Démarre le jeu dans `canvas`. Le Renderer est créé en premier : sans WebGL2 il lève une erreur avant
 * qu'aucun écouteur ne soit posé. Renvoie la fonction d'arrêt, ou null si le chargement a été annulé.
 */
export async function bootGame(canvas: HTMLCanvasElement, fontFamily: string, hooks: BootHooks): Promise<(() => void) | null> {
  hooks.onStep(STRINGS.boot.font);
  await loadFont(fontFamily);
  if (hooks.cancelled()) return null;
  const renderer = new Renderer(canvas, fontFamily);
  const state = createState();
  // La carte (~2 s) puis la végétation et le plancton : chaque étape est annoncée avant de bloquer.
  const steps: [string, () => void][] = [
    [STRINGS.boot.map, () => worldFor(state)],
    [STRINGS.boot.life, () => prepareEcosystem(state)],
    [STRINGS.boot.reserve, () => loadReserve(state)],
  ];
  for (const [label, run] of steps) {
    hooks.onStep(label);
    await paint();
    if (hooks.cancelled()) return null;
    run();
  }
  hooks.onStep(null);
  if (DEV) window.__game = state;

  const input = bindInput(canvas);
  // Son : le contexte audio naît au premier geste (règles d'autoplay).
  const unbindSound = bindSound();
  // La zone de jeu (main) : la fenêtre moins les zones sûres d'un téléphone (voir globals.css).
  const box = canvas.parentElement ?? document.body;
  const resize = () => renderer.resize(box.clientWidth, box.clientHeight);
  resize();
  window.addEventListener("resize", resize);
  // Sauvegarde de la réserve quand on quitte la page ou change d'onglet (en plus de l'automatique).
  const save = () => { saveReserve(state); };
  const hidden = () => { if (document.visibilityState === "hidden") saveReserve(state); };
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", hidden);
  const halt = startLoop(
    (dt) => { updateGame(state, input.read(), dt); autosave(state, dt); },
    (fps) => { view.zoom = worldZoom(state); renderer.sync(); composeGame(state, renderer.frame, renderer.ui, fps); renderer.draw(); },
    () => toast(state, STRINGS.boot.stalledTitle, STRINGS.boot.stalledBody),
  );
  return () => {
    halt();
    input.dispose();
    unbindSound();
    window.removeEventListener("resize", resize);
    window.removeEventListener("pagehide", save);
    document.removeEventListener("visibilitychange", hidden);
  };
}
