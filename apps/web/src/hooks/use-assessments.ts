"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssessmentDetailResponse,
  AssessmentSummary,
  CreateAssessmentRequest,
  CreateTestCaseRequest,
  SaveReferenceSolutionRequest,
  StarterCodeMap,
  TestCaseView,
  TestScriptView,
  UpdateAssessmentRequest,
  UpdateTestCaseRequest,
  UploadTestScriptRequest,
  ValidateTestScriptsRequest,
  ValidateTestScriptsResponse,
} from "@ambatucode/shared";
import { isValidating, VALIDATION_POLL_MS } from "@/components/test-scripts/validation";
import { apiClient } from "@/lib/api-client";
import { moduleKeys } from "./use-modules";

/**
 * Assessment authoring.
 *
 * Test cases and scripts are read as part of the Assessment rather than on
 * their own — the Architect view carries both — so every write here
 * invalidates the assessment, and the module tree alongside it whenever a
 * change could alter how the Assessment appears in a Section.
 */

export const assessmentKeys = {
  all: ["assessments"] as const,
  detail: (assessmentId: string) => ["assessments", "detail", assessmentId] as const,
};

export function useAssessment(assessmentId: string) {
  return useQuery({
    queryKey: assessmentKeys.detail(assessmentId),
    queryFn: ({ signal }) =>
      apiClient.get<AssessmentDetailResponse>(`/api/assessments/${assessmentId}`, { signal }),
    // A validation's result lands on the scripts, so while one is in flight
    // the Architect's view is re-read until it arrives.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.view === "ARCHITECT" && isValidating(data.assessment.testScripts)
        ? VALIDATION_POLL_MS
        : false;
    },
  });
}

function useInvalidateAssessment(assessmentId: string, moduleId?: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: assessmentKeys.detail(assessmentId) });
    if (moduleId) await queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) });
  };
}

export function useCreateAssessment(moduleId: string, sectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssessmentRequest) =>
      apiClient.post<AssessmentSummary>(`/api/sections/${sectionId}/assessments`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) }),
  });
}

export function useUpdateAssessment(assessmentId: string, moduleId?: string) {
  const invalidate = useInvalidateAssessment(assessmentId, moduleId);
  return useMutation({
    mutationFn: (changes: UpdateAssessmentRequest) =>
      apiClient.patch<AssessmentSummary>(`/api/assessments/${assessmentId}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteAssessment(moduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/assessments/${assessmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) }),
  });
}

export function useCreateTestCase(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (input: CreateTestCaseRequest) =>
      apiClient.post<TestCaseView>(`/api/assessments/${assessmentId}/test-cases`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateTestCase(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: ({ testCaseId, changes }: { testCaseId: string; changes: UpdateTestCaseRequest }) =>
      apiClient.patch<TestCaseView>(`/api/test-cases/${testCaseId}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteTestCase(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (testCaseId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/test-cases/${testCaseId}`),
    onSuccess: invalidate,
  });
}

export function useUploadTestScript(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (input: UploadTestScriptRequest) =>
      apiClient.post<TestScriptView>(`/api/assessments/${assessmentId}/test-scripts`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteTestScript(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (testScriptId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/test-scripts/${testScriptId}`),
    onSuccess: invalidate,
  });
}

export function useSaveReferenceSolution(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (input: SaveReferenceSolutionRequest) =>
      apiClient.put<StarterCodeMap>(`/api/assessments/${assessmentId}/reference-solution`, input),
    onSuccess: invalidate,
  });
}

export function useValidateTestScripts(assessmentId: string) {
  const invalidate = useInvalidateAssessment(assessmentId);
  return useMutation({
    mutationFn: (input: ValidateTestScriptsRequest) =>
      apiClient.post<ValidateTestScriptsResponse>(
        `/api/assessments/${assessmentId}/test-scripts/validate`,
        input,
      ),
    onSuccess: invalidate,
  });
}
