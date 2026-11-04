import type { Frame } from "../render/frame";
import { isSpeciesId } from "../species";
import type { SpeciesId } from "../species/types";
import { STORAGE_KEYS } from "../storage-keys";
import type { BiomeId } from "../world/biomes";
import type { Act } from "./photo-score";

/**
 * Album photo : capture des cellules du calque monde et stockage durable (IndexedDB).
 * Sans IndexedDB (navigation privée, tests), l'album reste en mémoire le temps de la partie.
 */

export interface Photo {
  id: string;
  /** Jour de la réserve, heure de jeu (0..24) et date réelle (ms). */
  day: number;
  clock: number;
  real: number;
  title: string;
  stars: number;
  species: SpeciesId[];
  /** Bonus et remarques de la notation. */
  notes: string[];
  /** Biome au centre du cadre et action du sujet principal (absents des photos plus anciennes). */
  biome?: BiomeId;
  act?: Act;
  cols: number;
  rows: number;
  /** Glyphe par cellule ; couleurs RGB tassées (3 octets par cellule). */
  ch: Uint8Array;
  fg: Uint8Array;
  bg: Uint8Array;
}

export const MAX_PHOTOS = 60;

/** Copie les cellules d'un rectangle du calque monde (glyphes + couleurs, sans l'alpha). */
export function captureCells(world: Frame, x: number, y: number, w: number, h: number): Pick<Photo, "cols" | "rows" | "ch" | "fg" | "bg"> {
  const x0 = Math.max(0, Math.min(world.cols - 1, x)), y0 = Math.max(0, Math.min(world.rows - 1, y));
  const cols = Math.max(1, Math.min(w, world.cols - x0)), rows = Math.max(1, Math.min(h, world.rows - y0));
  const n = cols * rows;
  const ch = new Uint8Array(n), fg = new Uint8Array(n * 3), bg = new Uint8Array(n * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const s = (y0 + j) * world.cols + x0 + i, d = j * cols + i;
      ch[d] = world.ch[s];
      for (let c = 0; c < 3; c++) { fg[d * 3 + c] = world.fg[s * 4 + c]; bg[d * 3 + c] = world.bg[s * 4 + c]; }
    }
  }
  return { cols, rows, ch, fg, bg };
}

/** La photo en texte brut (une ligne par rangée, espaces pour les cellules vides). */
export function photoText(p: Pick<Photo, "cols" | "rows" | "ch">): string {
  const lines: string[] = [];
  for (let j = 0; j < p.rows; j++) {
    let l = "";
    for (let i = 0; i < p.cols; i++) {
      const c = p.ch[j * p.cols + i];
      l += c > 32 && c < 127 ? String.fromCharCode(c) : " ";
    }
    lines.push(l.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Vérifie qu'un enregistrement relu de la base a la bonne forme (base corrompue, ancienne version...). */
export function validPhoto(v: unknown): v is Photo {
  if (!isRecord(v)) return false;
  const { id, cols, rows, ch, fg, bg, title, stars, notes, day, clock, real, species } = v;
  if (typeof id !== "string" || !isNum(cols) || !isNum(rows)) return false;
  const n = cols * rows;
  return ch instanceof Uint8Array && fg instanceof Uint8Array && bg instanceof Uint8Array
    && ch.length === n && fg.length === n * 3 && bg.length === n * 3
    && typeof title === "string" && isNum(stars) && isStrings(notes) && isNum(day) && isNum(clock) && isNum(real)
    && Array.isArray(species) && species.every(isSpeciesId);
}

export const newPhotoId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;

interface Album {
  /** Photos les plus récentes d'abord. */
  photos: Photo[];
  loaded: boolean;
  loading: boolean;
  /** false : IndexedDB indisponible ou écriture refusée, les photos seront perdues au rechargement. */
  persistent: boolean;
}

export const album: Album = { photos: [], loaded: false, loading: false, persistent: true };

const DB = STORAGE_KEYS.photoDb, STORE = "photos";
let dbp: Promise<IDBDatabase | null> | null = null;

/** Ouvre la base ; crée le magasin « photos » s'il manque (montée de version si besoin). */
function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let idb: IDBFactory;
    try {
      idb = globalThis.indexedDB;
      if (!idb) { resolve(null); return; }
    } catch {
      resolve(null);
      return;
    }
    const open = (version?: number) => {
      let req: IDBOpenDBRequest;
      try {
        req = version ? idb.open(DB, version) : idb.open(DB);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) {
          // Une autre page monte la version : on libère la base.
          db.onversionchange = () => db.close();
          resolve(db);
          return;
        }
        const v = db.version + 1;
        db.close();
        open(v);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    };
    open();
  });
  return dbp;
}

/** Charge l'album (une seule fois). */
export function loadAlbum(): void {
  if (album.loaded || album.loading) return;
  album.loading = true;
  void openDb().then((db) => {
    if (!db) { album.persistent = false; album.loaded = true; album.loading = false; return; }
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => {
        // Prise de vue et suppression attendent la fin du chargement : rien à fusionner.
        album.photos = req.result.filter(validPhoto).sort((a, b) => b.real - a.real);
        album.loaded = true; album.loading = false;
      };
      req.onerror = () => { album.persistent = false; album.loaded = true; album.loading = false; };
    } catch {
      album.persistent = false; album.loaded = true; album.loading = false;
    }
  });
}

/** Resolves true once the transaction is committed; an abort (quota exceeded...) comes without `error`. */
async function write(fn: (st: IDBObjectStore) => void): Promise<boolean> {
  const db = await openDb();
  const ok = await new Promise<boolean>((resolve) => {
    if (!db) { resolve(false); return; }
    try {
      const tx = db.transaction(STORE, "readwrite");
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  if (!ok) album.persistent = false;
  return ok;
}

export type AddOutcome = "loading" | "full" | "saved" | "memory";

/** Ajoute une photo : en mémoire tout de suite, puis « saved » une fois écrite dans la base, sinon « memory ». */
export async function addPhoto(p: Photo): Promise<AddOutcome> {
  if (!album.loaded) return "loading";
  if (album.photos.length >= MAX_PHOTOS) return "full";
  album.photos.unshift(p);
  return (await write((st) => st.put(p))) ? "saved" : "memory";
}

export function removePhoto(id: string): boolean {
  if (!album.loaded) return false;
  album.photos = album.photos.filter((p) => p.id !== id);
  void write((st) => st.delete(id));
  return true;
}

/** « Tout recommencer » : l'album est vidé, en mémoire et dans la base. */
export function clearAlbum(): void {
  album.photos = [];
  void write((st) => st.clear());
}
