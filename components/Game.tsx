"use client";

import { useEffect, useRef, useState } from "react";
import { bootGame } from "@/game/boot";
import { STRINGS } from "@/game/strings";
import Loading from "./Loading";

export default function Game({ fontFamily }: { fontFamily: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<string | null>(STRINGS.boot.font);

  // Boucle de jeu impérative (canvas WebGL, écouteurs clavier et pointeur) : démarrée au montage, arrêtée au démontage.
  useEffect(() => {
    let stop = () => {};
    let disposed = false;
    const canvas = ref.current;
    if (!canvas) return;
    bootGame(canvas, fontFamily, { onStep: setStep, cancelled: () => disposed })
      .then((halt) => {
        if (!halt) return;
        if (disposed) halt();
        else stop = halt;
      })
      .catch((err) => {
        console.error(err);
        if (!disposed) setStep(STRINGS.boot.failed);
      });
    return () => { disposed = true; stop(); };
  }, [fontFamily]);

  // Le jeu se pilote entièrement au clavier (Tab, Entrée, Échap, H pour l'aide), à la souris ou au doigt.
  return (
    <>
      {step && <Loading step={step} />}
      <canvas ref={ref} role="application" aria-label={STRINGS.canvasLabel} />
    </>
  );
}
