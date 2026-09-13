"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSessionRequest,
  MonitorSnapshot,
  ReadinessView,
  ReplaceParticipantsRequest,
  SessionView,
  StartSessionRequest,
  StartSessionResponse,
  UpdateSessionRequest,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { assessmentKeys } from "./use-assessments";

/**
 * Assessment Sessions, from the Architect's side.
 *
 * Readiness is polled rather than only pushed: the board is also what an
 * Architect looks at before an exam begins, and a stale count there is worse
 * than a redundant request. The socket feed corrects it between polls, so the
 * interval is generous.
 */

const READINESS_POLL_MS = 15_000;

export const sessionKeys = {
  all: ["sessions"] as const,
  list: (assessmentId: string) => ["sessions", "list", assessmentId] as const,
  detail: (sessionId: string) => ["sessions", "detail", sessionId] as const,
  readiness: (sessionId: string) => ["sessions", "readiness", sessionId] as const,
  monitor: (sessionId: string) => ["sessions", "monitor", sessionId] as const,
};

export function useSessions(assessmentId: string) {
  return useQuery({
    queryKey: sessionKeys.list(assessmentId),
    queryFn: ({ signal }) =>
      apiClient.get<SessionView[]>(`/api/assessments/${assessmentId}/sessions`, { signal }),
  });
}

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: ({ signal }) =>
      apiClient.get<SessionView>(`/api/sessions/${sessionId}`, { signal }),
  });
}

export function useReadiness(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: sessionKeys.readiness(sessionId),
    queryFn: ({ signal }) =>
      apiClient.get<ReadinessView>(`/api/sessions/${sessionId}/readiness`, { signal }),
    enabled,
    refetchInterval: enabled ? READINESS_POLL_MS : false,
  });
}

export function useMonitorSnapshot(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.monitor(sessionId),
    queryFn: ({ signal }) =>
      apiClient.get<MonitorSnapshot>(`/api/sessions/${sessionId}/monitor`, { signal }),
    // The live feed takes over from here; refetching would fight it.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateSession(assessmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionRequest) =>
      apiClient.post<SessionView>(`/api/assessments/${assessmentId}/sessions`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list(assessmentId) });
      await queryClient.invalidateQueries({ queryKey: assessmentKeys.detail(assessmentId) });
    },
  });
}

function useInvalidateSession(sessionId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    await queryClient.invalidateQueries({ queryKey: sessionKeys.readiness(sessionId) });
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
  };
}

export function useUpdateSession(sessionId: string) {
  const invalidate = useInvalidateSession(sessionId);
  return useMutation({
    mutationFn: (changes: UpdateSessionRequest) =>
      apiClient.patch<SessionView>(`/api/sessions/${sessionId}`, changes),
    onSuccess: invalidate,
  });
}

export function useReplaceParticipants(sessionId: string) {
  const invalidate = useInvalidateSession(sessionId);
  return useMutation({
    mutationFn: (input: ReplaceParticipantsRequest) =>
      apiClient.put<ReadinessView>(`/api/sessions/${sessionId}/participants`, input),
    onSuccess: invalidate,
  });
}

/**
 * Starting answers in one of two ways: it started, or it declined and handed
 * back the counts so the Architect can decide with the numbers in front of
 * them. Both are successes as far as the request is concerned — the warning is
 * data, not an error.
 */
export function useStartSession(sessionId: string) {
  const invalidate = useInvalidateSession(sessionId);
  return useMutation({
    mutationFn: (input: StartSessionRequest) =>
      apiClient.post<StartSessionResponse>(`/api/sessions/${sessionId}/start`, input),
    onSuccess: invalidate,
  });
}

export function useEndSession(sessionId: string) {
  const invalidate = useInvalidateSession(sessionId);
  return useMutation({
    mutationFn: () => apiClient.post<SessionView>(`/api/sessions/${sessionId}/end`),
    onSuccess: invalidate,
  });
}
