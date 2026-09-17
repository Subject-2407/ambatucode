import type { Language } from "@ambatucode/shared";

/**
 * The browser's own copy of an attempt's source code.
 *
 * IndexedDB rather than `localStorage` for two reasons the SRS cares about:
 * source can run to hundreds of kilobytes, and `localStorage` is synchronous —
 * writing on every keystroke would stall the main thread inside the editor the
 * Coder is typing in.
 *
 * This layer is a recovery aid, never an authority. It exists so a refresh, a
 * closed lid, or a dead Wi-Fi connection cannot lose work that the server had
 * not received yet. What gets graded is always what the Coder sends on Submit.
 */

const DATABASE_NAME = "ambatucode";
const DATABASE_VERSION = 1;
const STORE_NAME = "attempt-drafts";

export type LocalDraft = {
  attemptId: string;
  language: Language;
  sourceCode: string;
  /** Epoch milliseconds from the browser's clock. See `chooseDraft`. */
  savedAtMs: number;
};

/**
 * Every entry point resolves rather than rejects.
 *
 * A private window, blocked site data, or a browser with IndexedDB disabled
 * all surface as a thrown or errored request here. None of them is a reason to
 * interrupt an assessment: the Coder still has the server draft, and a failed
 * local write must degrade to "no local copy", never to a broken editor.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "attemptId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) {
          resolve(null);
          return;
        }
        try {
          const transaction = database.transaction(STORE_NAME, mode);
          const request = work(transaction.objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          transaction.oncomplete = () => database.close();
          transaction.onabort = () => {
            database.close();
            resolve(null);
          };
        } catch {
          database.close();
          resolve(null);
        }
      }),
  );
}

export async function readLocalDraft(attemptId: string): Promise<LocalDraft | null> {
  const row = await runTransaction<unknown>("readonly", (store) => store.get(attemptId));
  return isLocalDraft(row) && row.attemptId === attemptId ? row : null;
}

export async function writeLocalDraft(draft: LocalDraft): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(draft));
}

/**
 * Dropped once the attempt is over, so a shared lab machine does not keep one
 * Coder's source where the next one could restore it.
 */
export async function clearLocalDraft(attemptId: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(attemptId));
}

/** `unknown` from the store is exactly as untrusted as a request body. */
function isLocalDraft(value: unknown): value is LocalDraft {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.attemptId === "string" &&
    typeof row.language === "string" &&
    typeof row.sourceCode === "string" &&
    typeof row.savedAtMs === "number"
  );
}

// --- Recovery ---------------------------------------------------------------

export type ServerDraft = { language: Language; sourceCode: string; savedAtMs: number };

export type DraftChoice =
  | { source: "LOCAL"; language: Language; sourceCode: string }
  | { source: "SERVER"; language: Language; sourceCode: string }
  | { source: "NONE" };

/**
 * Which draft the editor should open with, after a reload or a reconnect.
 *
 * The two timestamps come from different clocks — the local one from this
 * browser, the server one from the database — so comparing them is not sound
 * in general. It is sound here because of what the two drafts are: the local
 * copy is written on every change, the server copy only when an autosave
 * lands, so the local copy is a superset of the server's except when the
 * server has work from a *different* device.
 *
 * `skewMs` is therefore applied before comparing, and the tie goes to the
 * local copy. The SRS is explicit that a Coder's newer local work is never
 * silently discarded; restoring a slightly stale local buffer costs a
 * keystroke, while dropping a newer one costs whatever they typed offline.
 */
export function chooseDraft(input: {
  local: LocalDraft | null;
  server: ServerDraft | null;
  /** Server clock minus browser clock, as measured from `attempt:state`. */
  skewMs: number;
}): DraftChoice {
  const { local, server, skewMs } = input;

  if (!local && !server) return { source: "NONE" };
  if (!local) {
    return server
      ? { source: "SERVER", language: server.language, sourceCode: server.sourceCode }
      : { source: "NONE" };
  }
  if (!server) {
    return { source: "LOCAL", language: local.language, sourceCode: local.sourceCode };
  }

  // Identical content is not a conflict, whatever the timestamps say. Calling
  // it a restore would tell the Coder their work was recovered when nothing
  // was ever at risk.
  if (local.sourceCode === server.sourceCode && local.language === server.language) {
    return { source: "SERVER", language: server.language, sourceCode: server.sourceCode };
  }

  const localOnServerClock = local.savedAtMs + skewMs;
  return localOnServerClock >= server.savedAtMs
    ? { source: "LOCAL", language: local.language, sourceCode: local.sourceCode }
    : { source: "SERVER", language: server.language, sourceCode: server.sourceCode };
}
