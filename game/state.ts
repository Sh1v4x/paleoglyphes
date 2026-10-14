import { START_HOUR } from "./daycycle";
import type { Style } from "./palette";
import { loadProgress, type Progress } from "./progress";
import { createDigState, type DigState } from "./scenes/dig";
import { createJournalState, type JournalState } from "./scenes/journal";
import { createLabState, type LabState } from "./scenes/lab";
import { createParkState, type ParkState } from "./scenes/park";
import { createMuseumState, type MuseumState } from "./scenes/museum";
import { createPhotosState, type PhotosState } from "./scenes/photos";
import type { Mode } from "./scenes/types";
import { createDocuState, type DocuState } from "./features/documentary";
import { createPhotoState, type PhotoState } from "./features/photo";
import { createWeatherState, type WeatherState } from "./features/weather";
import type { Toast } from "./ui/toast";
import { generateWorld, type World } from "./world/generate";

export interface Menu {
  open: boolean;
  /** Ligne sélectionnée (voir MENU_ITEMS dans ui/menu.ts) : 0 reprendre, 1 réglages, 2 mode test, 3 tout recommencer. */
  index: number;
  /** Page affichée : le menu en grandes lettres, ou les réglages. */
  page: "main" | "settings";
  /** « Tout recommencer » attend une confirmation. */
  confirm: boolean;
}

export interface GameState {
  time: number;
  style: Style;
  mode: Mode;
  menu: Menu;
  /** Fenêtre d'aide (touche H) ouverte. */
  help: boolean;
  progress: Progress;
  /** Heure de jeu dans la réserve (0..24) et vitesse de l'horloge (x1, x4, x16). */
  clock: number;
  clockSpeed: number;
  /** Un monde (réserve) par style, généré à la première visite. */
  worlds: Partial<Record<Style, World>>;
  toasts: Toast[];
  /** Dernière position de la souris (px CSS), pour les survols. */
  mouse: { x: number; y: number };
  dig: DigState;
  lab: LabState;
  park: ParkState;
  journal: JournalState;
  museum: MuseumState;
  photos: PhotosState;
  /** Fonctions de la réserve : documentaire, appareil photo, météo et saisons. */
  docu: DocuState;
  photo: PhotoState;
  weather: WeatherState;
}

export function worldFor(s: GameState, style: Style = s.style): World {
  return (s.worlds[style] ??= generateWorld(style));
}

export function createState(): GameState {
  return {
    time: 0,
    style: "cartoon",
    mode: "park",
    menu: { open: false, index: 0, confirm: false, page: "main" },
    help: false,
    progress: loadProgress(),
    clock: START_HOUR,
    clockSpeed: 1,
    worlds: {},
    toasts: [],
    mouse: { x: -1, y: -1 },
    dig: createDigState(),
    lab: createLabState(),
    park: createParkState(),
    journal: createJournalState(),
    museum: createMuseumState(),
    photos: createPhotosState(),
    docu: createDocuState(),
    photo: createPhotoState(),
    weather: createWeatherState(),
  };
}
