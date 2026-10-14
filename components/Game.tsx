"use client";

import { useEffect, useRef } from "react";
import { DEV, FONT_SIZE } from "@/game/config";
import { bindInput } from "@/game/input";
import { startLoop } from "@/game/loop";
import { Renderer } from "@/game/render/draw";
import { composeGame, updateGame } from "@/game/scenes";
import { createState } from "@/game/state";

export default function Game({ fontFamily }: { fontFamily: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stop = () => {};
    let disposed = false;
    (async () => {
      await document.fonts.load(`${FONT_SIZE}px ${fontFamily}`);
      await document.fonts.ready;
      const canvas = ref.current;
      if (disposed || !canvas) return;
      const input = bindInput(canvas);
      const renderer = new Renderer(canvas, fontFamily);
      const state = createState();
      // Accès console pour le débogage (dev uniquement).
      if (DEV) (window as unknown as { __game: unknown }).__game = state;
      const resize = () => renderer.resize(window.innerWidth, window.innerHeight);
      resize();
      window.addEventListener("resize", resize);
      const halt = startLoop(
        (dt) => updateGame(state, input.read(), dt),
        (fps) => { composeGame(state, renderer.frame, renderer.ui, fps); renderer.draw(); },
      );
      stop = () => { halt(); input.dispose(); window.removeEventListener("resize", resize); };
    })();
    return () => { disposed = true; stop(); };
  }, [fontFamily]);

  // Le jeu se pilote entièrement au clavier (Tab, Entrée, Échap, H pour l'aide) ou à la souris.
  return (
    <canvas
      ref={ref}
      role="application"
      aria-label="Paleoglyphes, jeu educatif sur les dinosaures. Touche H : aide et liste des commandes. Tab : bouton suivant, Entree : activer, Echap : menu."
      style={{ display: "block", touchAction: "none" }}
    />
  );
}
