import type { Input } from "../input";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import type { GameState } from "../state";

export type Mode = "dig" | "lab" | "park" | "journal";

/**
 * Un écran du jeu. Le cœur (scenes/index.ts) gère les onglets, le menu Échap et les notifications ;
 * la scène ne s'occupe que de son contenu.
 * - `world` : calque monde (petites cellules 4x7 px, détail « au pixel »).
 * - `ui` : calque d'interface (cellules 8x15 px, lisibles, fond transparent). La ligne 0 est réservée aux onglets.
 * - Les clics sur des zones d'interface arrivent dans `input.ui` (ids), les autres dans `input.worldClicks`.
 */
export interface Scene {
  /** Appelé quand on arrive sur l'écran. */
  enter?(s: GameState): void;
  update(s: GameState, input: Input, dt: number): void;
  compose(s: GameState, th: Theme, world: Frame, ui: Frame): void;
}
