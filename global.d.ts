import type { GameState } from "./game/state";

declare global {
  interface Window {
    /** Only set in dev builds. */
    __game?: GameState;
  }
}
