/**
 * Taille réelle des cellules à l'écran (px CSS), mise à jour par le Renderer au redimensionnement.
 * Sert à convertir la souris en cellules : monde (petites) ou interface (lisibles).
 */
export const metrics = { cellW: 4, cellH: 7, uiW: 8, uiH: 15, cols: 1, rows: 1, ucols: 1, urows: 1 };

/**
 * Zoom du calque monde : taille des glyphes (1 = normal, 2 = deux fois plus gros). Fixé avant chaque
 * image par le jeu (seule la réserve zoome) ; le Renderer reconstruit sa grille quand il change.
 */
export const view = { zoom: 1 };

/** Cellule de l'interface sous un point (px CSS). */
export const uiCellAt = (x: number, y: number) => ({ x: Math.floor(x / metrics.uiW), y: Math.floor(y / metrics.uiH) });
/** Cellule écran du calque monde sous un point (px CSS). */
export const worldCellAt = (x: number, y: number) => ({ x: Math.floor(x / metrics.cellW), y: Math.floor(y / metrics.cellH) });
