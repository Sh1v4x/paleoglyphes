import { STEP } from "./config";

/** Erreurs d'affilée avant de prévenir le joueur (une erreur isolée ne bloque pas le jeu). */
const ERROR_STREAK = 30;

/**
 * Boucle rAF : logique à pas fixe (60 Hz), rendu à chaque frame. Renvoie une fonction d'arrêt.
 * Une exception dans une scène ne fige pas la boucle : l'image suivante est toujours programmée,
 * seule la première erreur d'une série est journalisée, et `onStall` est appelé quand la série dure.
 */
export function startLoop(step: (dt: number) => void, render: (fps: number) => void, onStall: () => void): () => void {
  let raf = 0, last = performance.now(), acc = 0, fps = 60, errors = 0;
  const tick = (now: number) => {
    try {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += dt;
      while (acc >= STEP) { step(STEP); acc -= STEP; }
      if (dt > 0) fps += (1 / dt - fps) * 0.05;
      render(fps);
      errors = 0;
    } catch (err) {
      // Sans cette remise à zéro, le retard accumulé ferait rejouer des dizaines de pas à l'image suivante.
      acc = 0;
      if (errors === 0) console.error(err);
      if (++errors === ERROR_STREAK) onStall();
    } finally {
      raf = requestAnimationFrame(tick);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
