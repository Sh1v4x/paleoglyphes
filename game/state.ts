import { START_HOUR } from "./daycycle";
import type { Style } from "./palette";
import { loadProgress, type Progress } from "./progress";
import { createDigState, type DigState } from "./scenes/dig";
import { createJournalState, type JournalState } from "./scenes/journal";
import { createLabState, type LabState } from "./scenes/lab";
import { createParkState, type ParkState } from "./scenes/park";
import type { Mode } from "./scenes/types";
import type { Toast } from "./ui/toast";
import { generateWorld, type World } from "./world/generate";

export interface Menu {
  open: boolean;
  /** Ligne sélectionnée : 0 mode test, 1 tout recommencer, 2 reprendre. */
  index: number;
  /** « Tout recommencer » attend une confirmation. */
  confirm: boolean;
}

export interface GameState {
  time: number;
  style: Style;
  mode: Mode;
  menu: Menu;
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
}

export function worldFor(s: GameState, style: Style = s.style): World {
  return (s.worlds[style] ??= generateWorld(style));
}

export function createState(): GameState {
  return {
    time: 0,
    style: "cartoon",
    mode: "park",
    menu: { open: false, index: 0, confirm: false },
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
  };
}
