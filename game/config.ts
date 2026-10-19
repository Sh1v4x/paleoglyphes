/** Taille d'une cellule en px CSS. Chaque caractère joue le rôle d'un pixel. */
export const CELL_W = 4;
export const CELL_H = 7;
export const FONT_SIZE = 6.5;

/** Calque d'interface : grille plus grosse, lisible, posée par-dessus le monde. */
export const UI_CELL_W = 8;
export const UI_CELL_H = 15;
export const UI_FONT_SIZE = 13;

/**
 * Taille du monde en cellules : les terres et leurs biomes (toundra au nord, Hell Creek au centre,
 * désert et marais au sud, voir world/biomes.ts) + une bande de mer à l'est, la Voie maritime
 * intérieure de l'Ouest.
 */
export const LAND_COLS = 3040;
export const WORLD_COLS = 3540;
export const WORLD_ROWS = 1560;

export const WORLD_W = WORLD_COLS * CELL_W;
export const WORLD_H = WORLD_ROWS * CELL_H;

/** Échelle des modèles : pixels monde par mètre réel (tailles relatives fidèles). */
export const PX_PER_M = 30;

export const STEP = 1 / 60;
export const DEV = process.env.NODE_ENV !== "production";
