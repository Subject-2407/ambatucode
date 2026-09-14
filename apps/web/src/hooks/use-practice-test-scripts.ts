"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeTestScriptView, UploadPracticeTestScriptRequest } from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

/**
 * A Practice Activity's test scripts, for its Architect.
 *
 * Read on their own rather than with the activity, because the activity is
 * also what a Coder reads and scripts must never travel with it.
 */

export const practiceTestScriptKeys = {
  list: (practiceId: string) => ["practice", practiceId, "test-scripts"] as const,
};

export function usePracticeTestScripts(practiceId: string) {
  return useQuery({
    queryKey: practiceTestScriptKeys.list(practiceId),
    queryFn: ({ signal }) =>
      apiClient.get<PracticeTestScriptView[]>(`/api/practice/${practiceId}/test-scripts`, {
        signal,
      }),
  });
}

export function useUploadPracticeTestScript(practiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadPracticeTestScriptRequest) =>
      apiClient.post<PracticeTestScriptView>(`/api/practice/${practiceId}/test-scripts`, input),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: practiceTestScriptKeys.list(practiceId) }),
  });
}

export function useDeletePracticeTestScript(practiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (testScriptId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/practice-test-scripts/${testScriptId}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: practiceTestScriptKeys.list(practiceId) }),
  });
}
