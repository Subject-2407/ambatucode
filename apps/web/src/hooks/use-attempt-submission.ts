"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SERVER_EVENTS,
  isTerminalSubmissionStatus,
  type Language,
  type SubmissionCoderView,
  type SubmissionStatusPayload,
  type SubmissionStatusView,
  type SubmissionSummary,
  type SubmitAttemptResponse,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { getSocket } from "@/lib/socket";

/**
 * The one formal Submit of an attempt, and the pipeline that follows it.
 *
 * Two things are deliberate here. The source code is passed in by the caller at
 * click time and sent straight through — this hook never reads a draft, so a
 * pending autosave that never landed cannot change what is graded. And the
 * submission is followed over the socket with an HTTP poll behind it, because
 * a Coder watching their only submission is exactly the person who must not be
 * left staring at a spinner when a socket drops.
 */

export type AttemptSubmissionState =
  | { phase: "none" }
  | { phase: "submitting" }
  | { phase: "tracking"; submission: SubmissionSummary }
  | { phase: "settled"; submission: SubmissionSummary; detail: SubmissionCoderView | null };

/** Grace before the poll starts, so the socket gets first go in the common case. */
const POLL_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;

export function useAttemptSubmission(input: {
  attemptId: string;
  /** An attempt reopened after a refresh already has its submission. */
  initial: SubmissionSummary | null;
}) {
  const { attemptId, initial } = input;

  const [state, setState] = useState<AttemptSubmissionState>(() =>
    initial === null
      ? { phase: "none" }
      : isTerminalSubmissionStatus(initial.status)
        ? { phase: "settled", submission: initial, detail: null }
        : { phase: "tracking", submission: initial },
  );

  /** Read from listeners and timers that closed over an earlier render. */
  const tracked = useRef<SubmissionSummary | null>(initial);
  useEffect(() => {
    tracked.current =
      state.phase === "tracking" || state.phase === "settled" ? state.submission : null;
  }, [state]);

  const settle = useCallback(async (submission: SubmissionSummary) => {
    setState({ phase: "settled", submission, detail: null });
    try {
      // The aggregate and the public-case rows live behind this endpoint, where
      // the Coder-facing serializer has already dropped every hidden row.
      const detail = await apiClient.get<SubmissionCoderView>(`/api/submissions/${submission.id}`);
      setState({ phase: "settled", submission: { ...submission, ...detail }, detail });
    } catch {
      // The status is already on screen; the detail is an enrichment, and a
      // failure to fetch it must not look like a failed submission.
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onStatus = (payload: SubmissionStatusPayload) => {
      const current = tracked.current;
      if (payload.kind !== "SUBMIT" || current === null) return;
      if (payload.submissionId !== current.id) return;

      const next: SubmissionSummary = {
        ...current,
        status: payload.status,
        score: payload.score,
      };
      if (isTerminalSubmissionStatus(payload.status)) void settle(next);
      else setState({ phase: "tracking", submission: next });
    };

    socket.on(SERVER_EVENTS.SUBMISSION_STATUS, onStatus);
    return () => {
      socket.off(SERVER_EVENTS.SUBMISSION_STATUS, onStatus);
    };
  }, [settle]);

  // The fallback. It starts late and stops the moment the pipeline is done, so
  // in the ordinary case where the socket works it never issues a request.
  useEffect(() => {
    if (state.phase !== "tracking") return;
    const submissionId = state.submission.id;

    let interval: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const status = await apiClient.get<SubmissionStatusView>(
          `/api/submissions/${submissionId}/status`,
        );
        const current = tracked.current;
        if (current === null || current.id !== submissionId) return;
        const next: SubmissionSummary = {
          ...current,
          status: status.status,
          score: status.score,
          gradedAt: status.gradedAt,
        };
        if (isTerminalSubmissionStatus(status.status)) void settle(next);
        else setState({ phase: "tracking", submission: next });
      } catch {
        // Offline, most likely. The next interval tries again.
      }
    };

    const start = setTimeout(() => {
      void poll();
      interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }, POLL_DELAY_MS);

    return () => {
      clearTimeout(start);
      if (interval !== null) clearInterval(interval);
    };
  }, [settle, state]);

  const submit = useCallback(
    async (payload: { language: Language; sourceCode: string }) => {
      setState({ phase: "submitting" });
      try {
        const response = await apiClient.post<SubmitAttemptResponse>(
          `/api/attempts/${attemptId}/submit`,
          payload,
        );
        setState({ phase: "tracking", submission: response.submission });
        return response.submission;
      } catch (error) {
        setState({ phase: "none" });
        throw error;
      }
    },
    [attemptId],
  );

  /**
   * Adopts a submission this browser did not create — an auto-submit at the
   * deadline, or the one a rejected Submit told us already exists.
   */
  const adopt = useCallback(
    async (submissionId: string) => {
      try {
        const detail = await apiClient.get<SubmissionCoderView>(`/api/submissions/${submissionId}`);
        if (isTerminalSubmissionStatus(detail.status)) {
          setState({ phase: "settled", submission: detail, detail });
        } else {
          setState({ phase: "tracking", submission: detail });
        }
      } catch {
        // Nothing to show yet. The terminal modal still explains what happened.
      }
    },
    [],
  );

  return { state, submit, adopt };
}
