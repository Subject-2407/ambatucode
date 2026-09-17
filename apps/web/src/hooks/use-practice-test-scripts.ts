"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PracticeTestScriptView,
  PracticeTestScriptsView,
  SaveReferenceSolutionRequest,
  StarterCodeMap,
  UploadPracticeTestScriptRequest,
  ValidateTestScriptsRequest,
  ValidateTestScriptsResponse,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { isValidating, VALIDATION_POLL_MS } from "@/components/test-scripts/validation";

/**
 * A Practice Activity's test scripts and reference solutions, for its
 * Architect.
 *
 * Read on their own rather than with the activity, because the activity is
 * also what a Coder reads and neither may travel with it.
 */

export const practiceTestScriptKeys = {
  list: (practiceId: string) => ["practice", practiceId, "test-scripts"] as const,
};

export function usePracticeTestScripts(practiceId: string) {
  return useQuery({
    queryKey: practiceTestScriptKeys.list(practiceId),
    queryFn: ({ signal }) =>
      apiClient.get<PracticeTestScriptsView>(`/api/practice/${practiceId}/test-scripts`, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data && isValidating(query.state.data.scripts) ? VALIDATION_POLL_MS : false,
  });
}

function useInvalidateScripts(practiceId: string) {
  const queryClient = useQueryClient();
  return () =>
    void queryClient.invalidateQueries({ queryKey: practiceTestScriptKeys.list(practiceId) });
}

export function useUploadPracticeTestScript(practiceId: string) {
  const invalidate = useInvalidateScripts(practiceId);
  return useMutation({
    mutationFn: (input: UploadPracticeTestScriptRequest) =>
      apiClient.post<PracticeTestScriptView>(`/api/practice/${practiceId}/test-scripts`, input),
    onSuccess: invalidate,
  });
}

export function useDeletePracticeTestScript(practiceId: string) {
  const invalidate = useInvalidateScripts(practiceId);
  return useMutation({
    mutationFn: (testScriptId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/practice-test-scripts/${testScriptId}`),
    onSuccess: invalidate,
  });
}

export function useSavePracticeReferenceSolution(practiceId: string) {
  const invalidate = useInvalidateScripts(practiceId);
  return useMutation({
    mutationFn: (input: SaveReferenceSolutionRequest) =>
      apiClient.put<StarterCodeMap>(`/api/practice/${practiceId}/reference-solution`, input),
    onSuccess: invalidate,
  });
}

export function useValidatePracticeTestScripts(practiceId: string) {
  const invalidate = useInvalidateScripts(practiceId);
  return useMutation({
    mutationFn: (input: ValidateTestScriptsRequest) =>
      apiClient.post<ValidateTestScriptsResponse>(
        `/api/practice/${practiceId}/test-scripts/validate`,
        input,
      ),
    onSuccess: invalidate,
  });
}
