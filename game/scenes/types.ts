import type { Input } from "../input";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import type { GameState } from "../state";

export type Mode = "dig" | "lab" | "park" | "journal" | "meteor";

/** Lignes d'interface occupées par l'en-tête (marge, onglets, filet). */
export const HEADER_ROWS = 3;
/** Première ligne d'interface libre pour les scènes (une ligne d'air sous l'en-tête). */
export const UI_TOP = HEADER_ROWS + 1;

/**
 * Un écran du jeu. Le cœur (scenes/index.ts) gère les onglets, le menu Échap et les notifications ;
 * la scène ne s'occupe que de son contenu.
 * - `world` : calque monde (petites cellules 4x7 px, détail « au pixel »).
 * - `ui` : calque d'interface (cellules 8x15 px, lisibles, fond transparent). Les lignes 0 à HEADER_ROWS-1
 *   sont l'en-tête ; le contenu commence à UI_TOP.
 * - Les clics sur des zones d'interface arrivent dans `input.ui` (ids), les autres dans `input.worldClicks`.
 */
export interface Scene {
  /** Appelé quand on arrive sur l'écran. */
  enter?(s: GameState): void;
  update(s: GameState, input: Input, dt: number): void;
  compose(s: GameState, th: Theme, world: Frame, ui: Frame): void;
}
