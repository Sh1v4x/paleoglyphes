"use client";

import { useEffect, useRef } from "react";
import { FONT_SIZE } from "@/game/config";
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

  return <canvas ref={ref} style={{ display: "block", touchAction: "none" }} />;
}
