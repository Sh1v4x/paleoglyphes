import type { Input } from "../input";
import type { Theme } from "../palette";
import type { Frame } from "../render/frame";
import type { GameState } from "../state";
import type { Hint } from "../ui/kit";

export type Mode = "dig" | "lab" | "park" | "journal" | "museum" | "photos" | "meteor";

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
 *   Un bouton activé au clavier (Tab puis Entrée) arrive aussi dans `input.ui`, comme un clic.
 * - Le cœur gère Tab / Maj+Tab (focus), Entrée / Espace sur un bouton focalisé, Échap (retour puis menu),
 *   H (aide) : la scène ne les voit pas dans `input.pressed` quand il les a utilisés.
 */
export interface Scene {
  /** Appelé quand on arrive sur l'écran. */
  enter?(s: GameState): void;
  update(s: GameState, input: Input, dt: number): void;
  compose(s: GameState, th: Theme, world: Frame, ui: Frame): void;
  /** Aides de la ligne du bas (touches les plus utiles, selon l'état de l'écran). */
  hints?(s: GameState): readonly Hint[];
  /** Liste complète des commandes de l'écran, pour la fenêtre d'aide (H) ; à défaut, `hints`. */
  help?(s: GameState): readonly Hint[];
  /**
   * Retour (Échap, Retour arrière) : ferme ce qui est ouvert dans l'écran (fiche, fenêtre, viseur...).
   * Renvoie true si quelque chose a été fermé ; sinon Échap ouvre le menu.
   */
  back?(s: GameState): boolean;
}
