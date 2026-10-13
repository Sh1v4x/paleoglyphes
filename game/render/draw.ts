import { CELL_H, CELL_W, FONT_SIZE, UI_CELL_H, UI_CELL_W, UI_FONT_SIZE } from "../config";
import { createFrame, type Frame } from "./frame";
import { metrics } from "./metrics";

const FIRST = 32, LAST = 126;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Simple "blit" de deux grilles : chaque pixel lit le glyphe de sa cellule dans l'atlas,
// puis mélange fg/bg de la cellule. Le calque d'interface (cellules plus grosses) se pose
// par-dessus, avec la transparence de son fond. Aucun effet : la lumière est déjà dans la grille.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uCh;
uniform sampler2D uFg;
uniform sampler2D uBg;
uniform ivec2 uCell;
uniform sampler2D uUiAtlas;
uniform sampler2D uUiCh;
uniform sampler2D uUiFg;
uniform sampler2D uUiBg;
uniform ivec2 uUiCell;
uniform ivec2 uUiSize;
uniform float uHeight;
out vec4 o;
void main() {
  ivec2 px = ivec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  ivec2 cell = px / uCell;
  ivec2 inner = px - cell * uCell;
  int c = int(texelFetch(uCh, cell, 0).r * 255.0 + 0.5);
  vec3 fg = texelFetch(uFg, cell, 0).rgb;
  vec3 bg = texelFetch(uBg, cell, 0).rgb;
  float a = c > ${FIRST} ? texelFetch(uAtlas, ivec2((c - ${FIRST}) * uCell.x + inner.x, inner.y), 0).r : 0.0;
  vec3 col = mix(bg, fg, a);

  ivec2 ucell = px / uUiCell;
  ivec2 uinner = px - ucell * uUiCell;
  if (ucell.x >= uUiSize.x || ucell.y >= uUiSize.y) { o = vec4(col, 1.0); return; }
  int uc = int(texelFetch(uUiCh, ucell, 0).r * 255.0 + 0.5);
  vec4 ubg = texelFetch(uUiBg, ucell, 0);
  vec4 ufg = texelFetch(uUiFg, ucell, 0);
  col = mix(col, ubg.rgb, ubg.a);
  float ua = uc > ${FIRST} ? texelFetch(uUiAtlas, ivec2((uc - ${FIRST}) * uUiCell.x + uinner.x, uinner.y), 0).r : 0.0;
  col = mix(col, ufg.rgb, ua * ufg.a);
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/**
 * Dessine la grille de cellules.
 * - Atlas : les 95 glyphes ASCII pré-rendus une fois (fillText, blanc) à la taille exacte d'une cellule.
 * - Chaque frame : la grille (glyphe, fg, bg) est envoyée en 3 petites textures cols x rows,
 *   puis un seul appel de dessin pose chaque glyphe dans sa cellule, aux couleurs exactes.
 */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private atlasTex: WebGLTexture;
  private chTex: WebGLTexture;
  private fgTex: WebGLTexture;
  private bgTex: WebGLTexture;
  private uiAtlasTex: WebGLTexture;
  private uiChTex: WebGLTexture;
  private uiFgTex: WebGLTexture;
  private uiBgTex: WebGLTexture;
  private uCell: WebGLUniformLocation;
  private uUiCell: WebGLUniformLocation;
  private uUiSize: WebGLUniformLocation;
  private uHeight: WebGLUniformLocation;
  /** Calque monde (petites cellules) et calque d'interface (cellules lisibles, fond transparent). */
  frame: Frame = createFrame(1, 1);
  ui: Frame = createFrame(1, 1);

  constructor(private canvas: HTMLCanvasElement, private fontFamily: string) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 indisponible");
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const tex = (unit: number, name: string) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      return t;
    };
    this.atlasTex = tex(0, "uAtlas");
    this.chTex = tex(1, "uCh");
    this.fgTex = tex(2, "uFg");
    this.bgTex = tex(3, "uBg");
    this.uiAtlasTex = tex(4, "uUiAtlas");
    this.uiChTex = tex(5, "uUiCh");
    this.uiFgTex = tex(6, "uUiFg");
    this.uiBgTex = tex(7, "uUiBg");
    this.uCell = gl.getUniformLocation(prog, "uCell")!;
    this.uUiCell = gl.getUniformLocation(prog, "uUiCell")!;
    this.uUiSize = gl.getUniformLocation(prog, "uUiSize")!;
    this.uHeight = gl.getUniformLocation(prog, "uHeight")!;
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(CELL_W * dpr));
    const ch = Math.max(1, Math.round(CELL_H * dpr));
    const cols = Math.ceil(width / CELL_W), rows = Math.ceil(height / CELL_H);
    this.canvas.width = cols * cw;
    this.canvas.height = rows * ch;
    this.canvas.style.width = `${(cols * cw) / dpr}px`;
    this.canvas.style.height = `${(rows * ch) / dpr}px`;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2i(this.uCell, cw, ch);
    gl.uniform1f(this.uHeight, this.canvas.height);
    this.frame = createFrame(cols, rows);

    const ucw = Math.max(1, Math.round(UI_CELL_W * dpr));
    const uch = Math.max(1, Math.round(UI_CELL_H * dpr));
    // L'interface tient entièrement dans la fenêtre : jamais de ligne coupée sur les bords.
    const ucols = Math.floor((width * dpr) / ucw), urows = Math.floor((height * dpr) / uch);
    gl.uniform2i(this.uUiCell, ucw, uch);
    gl.uniform2i(this.uUiSize, ucols, urows);
    this.ui = createFrame(ucols, urows);
    Object.assign(metrics, { cellW: cw / dpr, cellH: ch / dpr, uiW: ucw / dpr, uiH: uch / dpr, cols, rows, ucols, urows });

    this.upload(0, this.atlasTex, this.buildAtlas(cw, ch, FONT_SIZE * dpr, dpr));
    this.upload(4, this.uiAtlasTex, this.buildAtlas(ucw, uch, UI_FONT_SIZE * dpr, dpr));
    this.alloc(1, this.chTex, gl.R8, gl.RED, cols, rows);
    this.alloc(2, this.fgTex, gl.RGBA8, gl.RGBA, cols, rows);
    this.alloc(3, this.bgTex, gl.RGBA8, gl.RGBA, cols, rows);
    this.alloc(5, this.uiChTex, gl.R8, gl.RED, ucols, urows);
    this.alloc(6, this.uiFgTex, gl.RGBA8, gl.RGBA, ucols, urows);
    this.alloc(7, this.uiBgTex, gl.RGBA8, gl.RGBA, ucols, urows);
  }

  /** Atlas des 95 glyphes ASCII à la taille exacte d'une cellule (canal rouge = couverture). */
  private buildAtlas(cw: number, ch: number, fontPx: number, dpr: number) {
    const n = LAST - FIRST + 1;
    const atlas = document.createElement("canvas");
    atlas.width = n * cw;
    atlas.height = ch;
    const a = atlas.getContext("2d")!;
    a.fillStyle = "#000";
    a.fillRect(0, 0, atlas.width, atlas.height);
    a.fillStyle = "#fff";
    a.font = `${fontPx}px ${this.fontFamily}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    for (let c = FIRST + 1; c <= LAST; c++) a.fillText(String.fromCharCode(c), (c - FIRST) * cw + cw / 2, ch / 2 + 0.5 * dpr);
    return atlas;
  }

  private upload(unit: number, t: WebGLTexture, img: HTMLCanvasElement) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }

  private alloc(unit: number, t: WebGLTexture, internal: number, format: number, w: number, h: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, null);
  }

  draw() {
    const gl = this.gl, f = this.frame;
    gl.activeTexture(gl.TEXTURE1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.cols, f.rows, gl.RED, gl.UNSIGNED_BYTE, f.ch);
    gl.activeTexture(gl.TEXTURE2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.cols, f.rows, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(f.fg.buffer));
    gl.activeTexture(gl.TEXTURE3);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.cols, f.rows, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(f.bg.buffer));
    const u = this.ui;
    gl.activeTexture(gl.TEXTURE5);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, u.cols, u.rows, gl.RED, gl.UNSIGNED_BYTE, u.ch);
    gl.activeTexture(gl.TEXTURE6);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, u.cols, u.rows, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(u.fg.buffer));
    gl.activeTexture(gl.TEXTURE7);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, u.cols, u.rows, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(u.bg.buffer));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
