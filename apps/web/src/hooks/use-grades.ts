"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GradeRecordQuery,
  GradeRecordView,
  Paginated,
  ResetAttemptRequest,
  ResetAttemptResponse,
  SubmissionHistoryItem,
  SubmissionHistoryQuery,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

/**
 * Grading records, and a Coder's own submission history.
 *
 * Both sit behind the same wall on the server — Root reads neither, and a
 * Coder reads only their own — so nothing here tries to be clever about
 * access. A refusal arrives as an `ApiError` and the screen shows it.
 */

export const gradeKeys = {
  all: ["grades"] as const,
  module: (moduleId: string, query: GradeRecordQuery) =>
    ["grades", "module", moduleId, query] as const,
  assessment: (assessmentId: string, query: GradeRecordQuery) =>
    ["grades", "assessment", assessmentId, query] as const,
  history: (query: SubmissionHistoryQuery) => ["grades", "history", query] as const,
};

function toQueryParams(query: GradeRecordQuery) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    sectionId: query.sectionId,
    assessmentId: query.assessmentId,
    sessionId: query.sessionId,
    status: query.status,
    resetOnly: query.resetOnly === true ? "true" : undefined,
  };
}

export function useModuleGrades(moduleId: string, query: GradeRecordQuery, enabled = true) {
  return useQuery({
    enabled: enabled && moduleId !== "",
    queryKey: gradeKeys.module(moduleId, query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<GradeRecordView>>(`/api/modules/${moduleId}/grades`, {
        signal,
        query: toQueryParams(query),
      }),
    // Keeping the previous page on screen while the next loads stops the table
    // collapsing to a skeleton every time a filter changes.
    placeholderData: (previous) => previous,
  });
}

export function useAssessmentGrades(
  assessmentId: string,
  query: GradeRecordQuery,
  enabled = true,
) {
  return useQuery({
    enabled: enabled && assessmentId !== "",
    queryKey: gradeKeys.assessment(assessmentId, query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<GradeRecordView>>(`/api/assessments/${assessmentId}/grades`, {
        signal,
        query: toQueryParams(query),
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * A reset creates a new attempt and keeps every submission. The whole grade
 * cache is invalidated rather than one key, because the reset also clears the
 * official flag across the record.
 */
export function useResetAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, reason }: { attemptId: string } & ResetAttemptRequest) =>
      apiClient.post<ResetAttemptResponse>(`/api/attempts/${attemptId}/reset`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gradeKeys.all }),
  });
}

export function useSetOfficialAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, isOfficial }: { attemptId: string; isOfficial: boolean }) =>
      apiClient.patch<{ attemptId: string; isOfficial: boolean }>(
        `/api/attempts/${attemptId}/official`,
        { isOfficial },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gradeKeys.all }),
  });
}

export function useOwnSubmissions(query: SubmissionHistoryQuery) {
  return useQuery({
    queryKey: gradeKeys.history(query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<SubmissionHistoryItem>>("/api/me/submissions", {
        signal,
        query: {
          page: query.page,
          pageSize: query.pageSize,
          moduleId: query.moduleId,
          assessmentId: query.assessmentId,
        },
      }),
    placeholderData: (previous) => previous,
  });
}
