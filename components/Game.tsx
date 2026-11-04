"use client";

import { useEffect, useRef, useState } from "react";
import { DEV, FONT_SIZE } from "@/game/config";
import { bindInput } from "@/game/input";
import { startLoop } from "@/game/loop";
import { Renderer } from "@/game/render/draw";
import { view } from "@/game/render/metrics";
import { worldZoom } from "@/game/scenes/park";
import { composeGame, updateGame } from "@/game/scenes";
import { prepareEcosystem } from "@/game/scenes/ecosystem";
import { createState, worldFor } from "@/game/state";
import Loading from "./Loading";

/** Laisse le navigateur afficher l'étape annoncée avant un calcul qui l'occupe. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export default function Game({ fontFamily }: { fontFamily: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<string | null>("Chargement de la police...");

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
      // La carte (~2 s) puis la végétation et le plancton : chaque étape est annoncée avant de bloquer.
      setStep("Generation de la carte : Alaska, Hell Creek, Gobi, marais, mer...");
      await paint();
      if (disposed) return;
      worldFor(state);
      setStep("La vie s'installe : vegetation et plancton (Lenia)...");
      await paint();
      if (disposed) return;
      prepareEcosystem(state);
      setStep(null);
      // Accès console pour le débogage (dev uniquement).
      if (DEV) (window as unknown as { __game: unknown }).__game = state;
      // La zone de jeu (main) : la fenêtre moins les zones sûres d'un téléphone (voir globals.css).
      const box = canvas.parentElement ?? document.body;
      const resize = () => renderer.resize(box.clientWidth, box.clientHeight);
      resize();
      window.addEventListener("resize", resize);
      const halt = startLoop(
        (dt) => updateGame(state, input.read(), dt),
        (fps) => { view.zoom = worldZoom(state); renderer.sync(); composeGame(state, renderer.frame, renderer.ui, fps); renderer.draw(); },
      );
      stop = () => { halt(); input.dispose(); window.removeEventListener("resize", resize); };
    })();
    return () => { disposed = true; stop(); };
  }, [fontFamily]);

  // Le jeu se pilote entièrement au clavier (Tab, Entrée, Échap, H pour l'aide), à la souris ou au doigt.
  return (
    <>
      {step && <Loading step={step} />}
      <canvas
        ref={ref}
        role="application"
        aria-label="Paleoglyphes, jeu educatif sur les dinosaures. Touche H : aide et liste des commandes. Tab : bouton suivant, Entree : activer, Echap : menu."
        style={{ display: "block", touchAction: "none" }}
      />
    </>
  );
}
