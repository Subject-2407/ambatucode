/**
 * Which Sections of a Module a Coder has folded shut.
 *
 * Kept in `localStorage`, per Module, because it is a reading convenience and
 * nothing else: it belongs to this browser, it is fine to lose, and nobody else
 * ever needs to see it. Every Section starts open, so a Coder who has never
 * folded anything — or whose storage is blocked — sees the whole Module.
 *
 * Only ids are stored, never titles, and an id that has left the Module is
 * simply never matched again.
 */

const PREFIX = "amb:section-folds:";

/** Enough for any real Module; a runaway list is cut rather than stored. */
const MAX_FOLDS = 200;

export function sectionFoldsKey(moduleId: string): string {
  return `${PREFIX}${moduleId}`;
}

/** Whatever is in storage is untrusted: another tab, an old build, a person. */
export function parseSectionFolds(raw: string | null): ReadonlySet<string> {
  if (raw === null) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === "string").slice(0, MAX_FOLDS));
  } catch {
    return new Set();
  }
}

export function serializeSectionFolds(folded: ReadonlySet<string>): string {
  return JSON.stringify([...folded].slice(0, MAX_FOLDS));
}

/**
 * The store the overview subscribes to, through `useSyncExternalStore`.
 *
 * Memory first, storage second. A browser that refuses `localStorage` still
 * folds a Section when it is clicked; it just does not remember it next visit.
 * The raw string is the snapshot, so an unchanged value is the same value and
 * React does not re-render for nothing.
 */
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function readStorage(moduleId: string): string | null {
  try {
    return window.localStorage.getItem(sectionFoldsKey(moduleId));
  } catch {
    // Private windows and locked-down lab profiles throw on access.
    return null;
  }
}

export function sectionFoldsSnapshot(moduleId: string): string | null {
  if (!memory.has(moduleId)) memory.set(moduleId, readStorage(moduleId));
  return memory.get(moduleId) ?? null;
}

export function setSectionFolds(moduleId: string, folded: ReadonlySet<string>): void {
  const raw = folded.size === 0 ? null : serializeSectionFolds(folded);
  memory.set(moduleId, raw);
  try {
    if (raw === null) window.localStorage.removeItem(sectionFoldsKey(moduleId));
    else window.localStorage.setItem(sectionFoldsKey(moduleId), raw);
  } catch {
    // Not remembering a fold is harmless; failing the click would not be.
  }
  for (const listener of listeners) listener();
}

/** Another tab folding the same Module is picked up too. */
export function subscribeSectionFolds(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || !event.key.startsWith(PREFIX)) return;
    memory.delete(event.key.slice(PREFIX.length));
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
