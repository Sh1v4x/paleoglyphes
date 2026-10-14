/**
 * Réglages du joueur (menu Échap > Réglages), gardés dans le navigateur.
 * - `uiScale` : taille du calque d'interface (cellules 8x15 px multipliées), appliquée par le Renderer.
 * - `reduceMotion` : coupe secousses, éclairs, flashs et clignotements rapides.
 * - `showFps` : compteur d'images dans l'en-tête (outil de développement).
 * Sans stockage (navigation privée, scripts Node) : valeurs par défaut, sans erreur.
 */

export const UI_SCALES = [1, 1.25, 1.5] as const;
export type UiScale = (typeof UI_SCALES)[number];

export interface Settings {
  uiScale: UiScale;
  reduceMotion: boolean;
  showFps: boolean;
}

const KEY = "paleoglyphes:settings";

function defaults(): Settings {
  let reduce = false;
  try {
    reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // Pas de navigateur : on garde les animations.
  }
  return { uiScale: 1, reduceMotion: reduce, showFps: false };
}

function load(): Settings {
  const d = defaults();
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return d;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      uiScale: UI_SCALES.includes(v.uiScale as UiScale) ? (v.uiScale as UiScale) : d.uiScale,
      reduceMotion: typeof v.reduceMotion === "boolean" ? v.reduceMotion : d.reduceMotion,
      showFps: typeof v.showFps === "boolean" ? v.showFps : d.showFps,
    };
  } catch {
    return d;
  }
}

/** Réglages courants (objet partagé : le modifier puis appeler `saveSettings`). */
export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Sans stockage : le réglage vaut pour la session.
  }
}

/** Animations réduites ? (raccourci lisible pour les effets). */
export const calm = () => settings.reduceMotion;
