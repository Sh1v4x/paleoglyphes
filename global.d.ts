import type { GameState } from "./game/state";

declare global {
  interface Window {
    /** Accès console pour le débogage (dev uniquement). */
    __game?: GameState;
  }
}
