"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language, SaveDraftResponse } from "@ambatucode/shared";
import { apiClient, isApiError } from "@/lib/api-client";
import { writeLocalDraft } from "@/lib/local-draft";

/**
 * The two writing halves of draft persistence: the browser's own copy and the
 * server's.
 *
 * Neither is what gets graded. Submit sends the editor buffer directly, so a
 * draft that never landed cannot cost a Coder their work — these layers exist
 * only so a refresh, a flat battery, or a dead access point does not.
 */

/** Quiet enough to mean "stopped typing", short enough to lose almost nothing. */
const DEBOUNCE_MS = 2_000;
/** Continuous typing never goes quiet, so a backup runs regardless. */
const PERIODIC_MS = 20_000;
/** Local writes are cheap but not free; this keeps them off the typing path. */
const LOCAL_THROTTLE_MS = 500;

export type DraftSaveState =
  | { phase: "clean" }
  | { phase: "dirty" }
  | { phase: "saving" }
  | { phase: "saved"; atMs: number }
  | { phase: "offline" }
  | { phase: "closed"; message: string };

export type UseAttemptDraftResult = {
  saveState: DraftSaveState;
};

type Confirmed = { language: Language; sourceCode: string; atMs: number };
/**
 * `offline` means the request did not reach the server and will be retried.
 * `closed` means it reached the server and was refused — the attempt is
 * submitted, expired, or its session has ended — so retrying is pointless and
 * would produce one rejection per timer tick.
 */
type Failure = { kind: "offline" } | { kind: "closed"; message: string };

export function useAttemptDraft(input: {
  attemptId: string;
  language: Language;
  sourceCode: string;
  /** False once the attempt is submitted, expired, or superseded. */
  enabled: boolean;
}): UseAttemptDraftResult {
  const { attemptId, language, sourceCode, enabled } = input;

  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  /** The current buffer, readable from timers that closed over an older render. */
  const latest = useRef({ language, sourceCode });
  useEffect(() => {
    latest.current = { language, sourceCode };
  }, [language, sourceCode]);

  const inFlight = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = failure?.kind === "closed";

  const save = useCallback(async () => {
    if (!enabled || closed || inFlight.current) return;

    const { language: draftLanguage, sourceCode: draftSource } = latest.current;
    inFlight.current = true;
    setSaving(true);
    try {
      const response = await apiClient.put<SaveDraftResponse>(`/api/attempts/${attemptId}/draft`, {
        language: draftLanguage,
        sourceCode: draftSource,
      });
      setConfirmed({
        language: draftLanguage,
        sourceCode: draftSource,
        atMs: new Date(response.savedAt).getTime(),
      });
      setFailure(null);
    } catch (error) {
      if (isApiError(error) && !error.isNetworkError) {
        setFailure({ kind: "closed", message: error.userMessage });
      } else {
        // The local copy already holds this buffer, so nothing is lost; the
        // next periodic backup tries again once the network returns.
        setFailure({ kind: "offline" });
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [attemptId, closed, enabled]);

  // Local copy first and on its own schedule: it must survive a crash that
  // happens before any request completes, so it cannot wait on the network.
  useEffect(() => {
    if (!enabled || localTimer.current !== null) return;

    localTimer.current = setTimeout(() => {
      localTimer.current = null;
      void writeLocalDraft({
        attemptId,
        language: latest.current.language,
        sourceCode: latest.current.sourceCode,
        savedAtMs: Date.now(),
      });
    }, LOCAL_THROTTLE_MS);
  }, [attemptId, enabled, language, sourceCode]);

  // Debounced server autosave, restarted on every keystroke.
  useEffect(() => {
    if (!enabled || closed) return;

    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void save(), DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    };
  }, [closed, enabled, language, save, sourceCode]);

  // Periodic backup. A Coder typing without pause never trips the debounce, and
  // is exactly the Coder with the most unsaved work.
  useEffect(() => {
    if (!enabled || closed) return;
    const timer = setInterval(() => void save(), PERIODIC_MS);
    return () => clearInterval(timer);
  }, [closed, enabled, save]);

  // A last write on the way out. Best effort: the browser may not give us long
  // enough, which is precisely why the local copy is written eagerly above.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      void writeLocalDraft({
        attemptId,
        language: latest.current.language,
        sourceCode: latest.current.sourceCode,
        savedAtMs: Date.now(),
      });
      void save();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [attemptId, enabled, save]);

  return { saveState: describeSave({ confirmed, saving, failure, language, sourceCode }) };
}

/**
 * Derived rather than stored, so the indicator cannot disagree with the buffer
 * it is describing: "Saved" means the confirmed text is the text on screen,
 * and any edit since makes it unsaved again without anything having to
 * remember to say so.
 */
function describeSave(input: {
  confirmed: Confirmed | null;
  saving: boolean;
  failure: Failure | null;
  language: Language;
  sourceCode: string;
}): DraftSaveState {
  const { confirmed, saving, failure, language, sourceCode } = input;
  if (failure?.kind === "closed") return { phase: "closed", message: failure.message };
  if (saving) return { phase: "saving" };

  const matches = confirmed?.sourceCode === sourceCode && confirmed.language === language;
  if (matches && confirmed) return { phase: "saved", atMs: confirmed.atMs };
  if (failure?.kind === "offline") return { phase: "offline" };
  return confirmed === null ? { phase: "clean" } : { phase: "dirty" };
}
