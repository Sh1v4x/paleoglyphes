"use client";

import dynamic from "next/dynamic";
import Loading from "./Loading";

const Game = dynamic(() => import("./Game"), { ssr: false, loading: () => <Loading step="Chargement du jeu..." /> });

export default function GameLoader({ fontFamily }: { fontFamily: string }) {
  return <Game fontFamily={fontFamily} />;
}
