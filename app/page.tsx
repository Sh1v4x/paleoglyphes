import GameLoader from "@/components/GameLoader";
import { mono } from "./fonts";

export default function Page() {
  return (
    <main>
      <GameLoader fontFamily={mono.style.fontFamily} />
    </main>
  );
}
