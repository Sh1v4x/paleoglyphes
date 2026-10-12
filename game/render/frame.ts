/** Grille de cellules d'un écran : glyphe + couleur fg + couleur bg par cellule (RGBA, prêt pour ImageData). */
export interface Frame {
  cols: number;
  rows: number;
  ch: Uint8Array;
  fg: Uint8ClampedArray;
  bg: Uint8ClampedArray;
  /** 0 = terrain, 1 = décor, 2 = ankylosaure. Sert aux reflets. */
  obj: Uint8Array;
  /** Lumière par cellule (RGB) et lumière d'accent (feux follets, runes). */
  lr: Float32Array;
  lg: Float32Array;
  lb: Float32Array;
  acc: Float32Array;
}

export function createFrame(cols: number, rows: number): Frame {
  const n = cols * rows;
  return {
    cols, rows,
    ch: new Uint8Array(n),
    fg: new Uint8ClampedArray(n * 4),
    bg: new Uint8ClampedArray(n * 4),
    obj: new Uint8Array(n),
    lr: new Float32Array(n),
    lg: new Float32Array(n),
    lb: new Float32Array(n),
    acc: new Float32Array(n),
  };
}

export function setFg(f: Frame, i: number, r: number, g: number, b: number) {
  const k = i * 4;
  f.fg[k] = r; f.fg[k + 1] = g; f.fg[k + 2] = b; f.fg[k + 3] = 255;
}
export function setBg(f: Frame, i: number, r: number, g: number, b: number) {
  const k = i * 4;
  f.bg[k] = r; f.bg[k + 1] = g; f.bg[k + 2] = b; f.bg[k + 3] = 255;
}
