"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SERVER_EVENTS,
  isTerminalSubmissionStatus,
  type Language,
  type RunPracticeResponse,
  type RunTestResultView,
  type SubmissionStatus,
  type SubmissionStatusPayload,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { getSocket } from "@/lib/socket";

/**
 * Runs a Practice Activity and follows the result.
 *
 * The HTTP call only queues the job; the per-case results arrive over the
 * socket, addressed to this Coder. So the request and the answer come back on
 * two different channels, and the job id is what ties them together — a stale
 * result from an earlier press must never overwrite the current one.
 */

export type PracticeRunState =
  | { phase: "idle" }
  | { phase: "waiting"; jobId: string; status: SubmissionStatus }
  | {
      phase: "finished";
      jobId: string;
      status: SubmissionStatus;
      testResults: RunTestResultView[];
      compilerOutput: string | null;
    }
  | { phase: "failed"; message: string };

/**
 * How long to wait for a result before saying so.
 *
 * Comfortably longer than any run's wall-clock limit, so this never fires on a
 * slow-but-working execution. It exists for the case the queue has no worker
 * attached: a Coder pressing Run against a stopped worker would otherwise
 * watch a spinner forever, with nothing on screen to suggest why.
 */
const RESULT_TIMEOUT_MS = 90_000;

export function usePracticeRun(practiceId: string) {
  const [state, setState] = useState<PracticeRunState>({ phase: "idle" });
  /** The run currently on screen. Anything else arriving is from a past press. */
  const activeJobId = useRef<string | null>(null);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutId.current !== null) {
      clearTimeout(timeoutId.current);
      timeoutId.current = null;
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onStatus = (payload: SubmissionStatusPayload) => {
      // A SUBMIT belongs to the assessment workspace, and a RUN whose id we do
      // not recognise belongs to a press the Coder has already moved past.
      if (payload.kind !== "RUN" || payload.jobId !== activeJobId.current) return;

      if (!isTerminalSubmissionStatus(payload.status)) {
        setState({ phase: "waiting", jobId: payload.jobId, status: payload.status });
        return;
      }

      clearTimer();
      activeJobId.current = null;
      setState({
        phase: "finished",
        jobId: payload.jobId,
        status: payload.status,
        testResults: payload.testResults,
        compilerOutput: payload.compilerOutput,
      });
    };

    socket.on(SERVER_EVENTS.SUBMISSION_STATUS, onStatus);
    return () => {
      socket.off(SERVER_EVENTS.SUBMISSION_STATUS, onStatus);
    };
  }, [clearTimer]);

  // A run in flight when the Coder navigates away has nowhere to land.
  useEffect(() => clearTimer, [clearTimer]);

  const run = useCallback(
    async (input: { language: Language; sourceCode: string }) => {
      clearTimer();
      activeJobId.current = null;
      setState({ phase: "waiting", jobId: "", status: "QUEUED" });

      try {
        const { jobId } = await apiClient.post<RunPracticeResponse>(
          `/api/practice/${practiceId}/run`,
          input,
        );
        activeJobId.current = jobId;
        setState({ phase: "waiting", jobId, status: "QUEUED" });

        timeoutId.current = setTimeout(() => {
          if (activeJobId.current !== jobId) return;
          activeJobId.current = null;
          setState({
            phase: "failed",
            message: "No result came back. The execution worker may not be running.",
          });
        }, RESULT_TIMEOUT_MS);
      } catch (error) {
        activeJobId.current = null;
        throw error;
      }
    },
    [clearTimer, practiceId],
  );

  const reset = useCallback(() => {
    clearTimer();
    activeJobId.current = null;
    setState({ phase: "idle" });
  }, [clearTimer]);

  return { state, run, reset, isRunning: state.phase === "waiting" };
}
