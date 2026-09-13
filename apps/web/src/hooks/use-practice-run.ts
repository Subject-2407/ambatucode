"use client";

import { useRunJob, type RunJobState } from "./use-run-job";

/**
 * Runs a Practice Activity. Unlimited, never an attempt, never a grade — the
 * endpoint is the only thing that distinguishes it from an assessment Run.
 */
export type PracticeRunState = RunJobState;

export function usePracticeRun(practiceId: string) {
  return useRunJob(`/api/practice/${practiceId}/run`);
}
