import { STEP } from "./config";

/** Boucle rAF : logique à pas fixe (60 Hz), rendu à chaque frame. Renvoie une fonction d'arrêt. */
export function startLoop(step: (dt: number) => void, render: (fps: number) => void): () => void {
  let raf = 0, last = performance.now(), acc = 0, fps = 60;
  const tick = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    render(fps);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
