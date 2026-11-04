import { CELL_H, CELL_W, UI_CELL_H, UI_CELL_W, UI_FONT_SIZE } from "../config";
import { clockLabel } from "../daycycle";
import { SPECIES } from "../species";
import type { GameState } from "../state";
import { ascii, wrap } from "../ui/kit";
import { toast } from "../ui/toast";
import { BIOME_INFO } from "../world/biomes";
import { downloadBlob, drawCells, exportScale, gameFont } from "./photo-export";
import { starsText, type Act } from "./photo-score";
import type { Photo } from "./photo-store";

/**
 * Partage d'une photo, sans serveur : une carte PNG (la photo dans un cadre ASCII, légende, titre du jeu
 * et lien), envoyée par le partage natif (Web Share API) ou, à défaut, copiée dans le presse-papiers,
 * ou téléchargée. Toujours appelé depuis un clic ou une touche : les navigateurs l'exigent.
 */

export const GAME_URL = "https://sh1v4x.github.io/paleoglyphes/";

/** Ce que faisait le sujet, pour la légende. */
const ACT_LABEL: Record<Act, string> = {
  idle: "tranquille", walk: "en promenade", eat: "en plein repas", drink: "s'abreuve", rest: "endormi",
  call: "lance un appel", hunt: "en chasse", attack: "a l'attaque", defend: "sur la defensive", flee: "en fuite",
  fly: "en plein vol", dive: "plonge sur sa proie", swim: "nage sous les vagues", nest: "couve son nid",
  hatch: "eclosion en cours", court: "en pleine parade", young: "un petit qui grandit", scavenge: "pille un nid",
  dead: "une carcasse",
};

/** Une rangée de la carte : séparateur, zone de la photo ou ligne de texte (avec sa couleur). */
export type CardRow = { kind: "sep" } | { kind: "photo" } | { kind: "text"; t: string; tone: "title" | "text" | "dim" | "gold" };

/** Lignes « Libellé : valeur », la valeur coupée et alignée sous elle-même. */
function field(label: string, value: string, w: number): CardRow[] {
  const head = `${label.padEnd(9)}: `;
  return wrap(value, Math.max(10, w - head.length)).map((l, i) => ({ kind: "text", t: `${i ? " ".repeat(head.length) : head}${l}`, tone: "text" }));
}

/** Contenu de la carte (module pur) : `w` = largeur intérieure en caractères. */
export function cardRows(p: Photo, w: number): CardRow[] {
  const sep: CardRow = { kind: "sep" };
  const head = "PALEOGLYPHES", tag = "photo-safari au Cretace";
  const rows: CardRow[] = [sep, { kind: "text", t: `${head}${tag.padStart(w - head.length)}`, tone: "title" }, sep, { kind: "photo" }, sep];
  for (const l of wrap(p.title, w)) rows.push({ kind: "text", t: l, tone: "gold" });
  const names = p.species.map((id) => SPECIES[id]?.name).filter(Boolean);
  if (names.length) rows.push(...field(names.length > 1 ? "Especes" : "Espece", names.join(", "), w));
  if (p.act) rows.push(...field("Activite", ACT_LABEL[p.act], w));
  const b = p.biome !== undefined ? BIOME_INFO[p.biome] : undefined;
  if (b) rows.push(...field("Lieu", `${b.name} (${b.site}, ${b.age})`, w));
  rows.push(...field("Note", `[${starsText(p.stars)}]   Jour ${p.day}, ${clockLabel(p.clock)}`, w));
  rows.push(sep, { kind: "text", t: `Joue toi aussi : ${GAME_URL}`, tone: "dim" }, sep);
  return rows.map((r) => (r.kind === "text" ? { ...r, t: ascii(r.t).slice(0, w).padEnd(w) } : r));
}

const COLORS = { bg: "#14121a", frame: "#c88214", title: "#f2e6c8", text: "#f2e6c8", dim: "#968c7d", gold: "#e0a83c" };

/** Rend la carte de partage dans un canvas : cadre ASCII sur une grille de cellules d'interface. */
export function shareCanvas(p: Photo): HTMLCanvasElement {
  const scale = exportScale();
  const cw = UI_CELL_W * scale, ch = UI_CELL_H * scale;
  const pw = p.cols * CELL_W * scale, ph = p.rows * CELL_H * scale;
  // Largeur intérieure : celle de la photo (au moins 60 caractères pour la légende).
  const w = Math.max(60, Math.ceil(pw / cw) + 2), photoRows = Math.ceil(ph / ch) + 1;
  const rows = cardRows(p, w);
  const cols = w + 4, n = rows.reduce((a, r) => a + (r.kind === "photo" ? photoRows : 1), 0);
  const cv = document.createElement("canvas");
  cv.width = (cols + 2) * cw;
  cv.height = (n + 2) * ch;
  const g = cv.getContext("2d")!;
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  // Chaque glyphe centré dans sa cellule, comme le calque d'interface du jeu.
  const glyphs = (x: number, y: number, t: string, color: string) => {
    g.font = `${UI_FONT_SIZE * scale}px ${gameFont()}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    for (let k = 0; k < t.length; k++) if (t[k] !== " ") g.fillText(t[k], (x + k + 1) * cw + cw / 2, (y + 1) * ch + ch / 2 + 0.5 * scale);
  };
  let y = 0;
  for (const r of rows) {
    if (r.kind === "sep") { glyphs(0, y++, `+${"-".repeat(cols - 2)}+`, COLORS.frame); continue; }
    if (r.kind === "text") { glyphs(0, y, "|", COLORS.frame); glyphs(2, y, r.t, COLORS[r.tone]); glyphs(cols - 1, y++, "|", COLORS.frame); continue; }
    for (let j = 0; j < photoRows; j++) { glyphs(0, y + j, "|", COLORS.frame); glyphs(cols - 1, y + j, "|", COLORS.frame); }
    drawCells(g, p, Math.round(3 * cw + (w * cw - pw) / 2), Math.round((y + 1) * ch + (photoRows * ch - ph) / 2), scale);
    y += photoRows;
  }
  return cv;
}

// ponytail: une seule carte en cache (la dernière partagée) ; elle se refait au besoin.
let cache: { id: string; blob: Promise<Blob | null> } | null = null;

/** La carte en PNG (gardée en cache pour un second essai instantané). */
export function shareBlob(p: Photo): Promise<Blob | null> {
  if (cache?.id !== p.id) {
    const blob = new Promise<Blob | null>((resolve) => {
      try { shareCanvas(p).toBlob(resolve, "image/png"); } catch { resolve(null); }
    });
    cache = { id: p.id, blob };
  }
  return cache.blob;
}

/**
 * Partage la photo : partage natif avec le fichier si possible, sinon copie de l'image,
 * sinon téléchargement. Les messages disent ce qui s'est passé.
 */
export async function sharePhoto(s: GameState, p: Photo): Promise<void> {
  const name = `paleoglyphes-${p.id}.png`;
  const bp = shareBlob(p);
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.share && nav.canShare) {
    const blob = await bp;
    if (!blob) { toast(s, "Image impossible a creer", "Essaie \"Copier en texte\" a la place."); return; }
    const data: ShareData = {
      files: [new File([blob], name, { type: "image/png" })],
      title: "Paleoglyphes",
      text: `${ascii(p.title)} [${starsText(p.stars)}] - ma photo dans Paleoglyphes, le jeu de dinosaures en ASCII : ${GAME_URL}`,
    };
    if (nav.canShare(data)) {
      try {
        await nav.share(data);
        toast(s, "Photo partagee !", p.title);
        return;
      } catch (e) {
        // Fenêtre de partage fermée : rien d'autre à faire.
        if (e instanceof DOMException && e.name === "AbortError") { toast(s, "Partage annule"); return; }
        // Refus (permission, geste trop ancien...) : on tente la copie.
      }
    }
  }
  // L'image est passée en promesse : Safari exige le ClipboardItem dès le geste.
  if (typeof ClipboardItem !== "undefined" && nav?.clipboard?.write) {
    try {
      await nav.clipboard.write([new ClipboardItem({ "image/png": bp.then((b) => b ?? Promise.reject(new Error("image"))) })]);
      toast(s, "Image copiee", "Colle-la dans une conversation ou un document.");
      return;
    } catch {
      // Presse-papiers refusé : téléchargement.
    }
  }
  const blob = await bp;
  if (!blob) { toast(s, "Image impossible a creer", "Essaie \"Copier en texte\" a la place."); return; }
  try {
    downloadBlob(blob, name);
    toast(s, "Telechargement de la photo", name);
  } catch {
    toast(s, "Partage impossible", "Ni partage, ni copie, ni telechargement ne sont permis ici.");
  }
}

/** Copie le lien du jeu (et le montre si la copie est refusée). */
export async function copyGameLink(s: GameState): Promise<void> {
  try {
    await navigator.clipboard.writeText(GAME_URL);
    toast(s, "Lien du jeu copie", GAME_URL);
  } catch {
    toast(s, "Copie impossible : voici le lien", GAME_URL);
  }
}
