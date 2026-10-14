import type { Frame } from "../render/frame";
import type { SpeciesId } from "../species/types";

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

/** Vérifie qu'un enregistrement relu de la base a la bonne forme (base corrompue, ancienne version...). */
export function validPhoto(v: unknown): v is Photo {
  const p = v as Photo;
  if (!p || typeof p.id !== "string" || typeof p.cols !== "number" || typeof p.rows !== "number") return false;
  const n = p.cols * p.rows;
  return p.ch instanceof Uint8Array && p.fg instanceof Uint8Array && p.bg instanceof Uint8Array
    && p.ch.length === n && p.fg.length === n * 3 && p.bg.length === n * 3;
}

export const newPhotoId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;

/** L'album en mémoire (photos les plus récentes d'abord) et l'état du stockage. */
export const album = {
  photos: [] as Photo[],
  loaded: false,
  loading: false,
  /** false : IndexedDB indisponible, les photos seront perdues au rechargement. */
  persistent: true,
};

const DB = "paleoglyphes", STORE = "photos";
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
        const got = (req.result as unknown[]).filter(validPhoto);
        // Les photos prises pendant le chargement restent en tête.
        const ids = new Set(album.photos.map((p) => p.id));
        album.photos = [...album.photos, ...got.filter((p) => !ids.has(p.id))].sort((a, b) => b.real - a.real);
        album.loaded = true; album.loading = false;
      };
      req.onerror = () => { album.persistent = false; album.loaded = true; album.loading = false; };
    } catch {
      album.persistent = false; album.loaded = true; album.loading = false;
    }
  });
}

function write(fn: (st: IDBObjectStore) => void) {
  void openDb().then((db) => {
    if (!db) { album.persistent = false; return; }
    try {
      const tx = db.transaction(STORE, "readwrite");
      fn(tx.objectStore(STORE));
      tx.onerror = () => { album.persistent = false; };
    } catch {
      album.persistent = false;
    }
  });
}

/** Ajoute une photo (mémoire tout de suite, base en arrière-plan). Renvoie false si l'album est plein. */
export function addPhoto(p: Photo): boolean {
  if (album.photos.length >= MAX_PHOTOS) return false;
  album.photos.unshift(p);
  write((st) => st.put(p));
  return true;
}

export function removePhoto(id: string): void {
  album.photos = album.photos.filter((p) => p.id !== id);
  write((st) => st.delete(id));
}
