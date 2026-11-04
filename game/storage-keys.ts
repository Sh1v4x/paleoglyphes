// Values are frozen: renaming one would silently drop every player's saved data.
export const STORAGE_KEYS = {
  progress: "ascii-dino-progress-v1",
  journalSeen: "ascii-dino-journal-seen-v1",
  settings: "paleoglyphes:settings",
  reserve: "paleoglyphes:reserve",
  day: "paleoglyphes-photo-day",
  photoDb: "paleoglyphes",
} as const;
