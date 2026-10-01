"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSessionRequest,
  ModuleSessionOption,
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
  byModule: (moduleId: string) => ["sessions", "module", moduleId] as const,
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

/** Every session in a Module, for the grading records' session filter. */
export function useModuleSessions(moduleId: string, enabled = true) {
  return useQuery({
    queryKey: sessionKeys.byModule(moduleId),
    queryFn: ({ signal }) =>
      apiClient.get<ModuleSessionOption[]>(`/api/modules/${moduleId}/sessions`, { signal }),
    enabled: enabled && moduleId !== "",
  });
}

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: ({ signal }) => apiClient.get<SessionView>(`/api/sessions/${sessionId}`, { signal }),
  });
}

/**
 * Read once whatever the session's state, and polled only while readiness can
 * still change. It used to be switched off entirely for a finished session,
 * which left that session's panel on a loading skeleton for good.
 */
export function useReadiness(sessionId: string, poll = true) {
  return useQuery({
    queryKey: sessionKeys.readiness(sessionId),
    queryFn: ({ signal }) =>
      apiClient.get<ReadinessView>(`/api/sessions/${sessionId}/readiness`, { signal }),
    refetchInterval: poll ? READINESS_POLL_MS : false,
  });
}

/** How often the monitor re-reads attempt state the feed does not carry. */
const MONITOR_POLL_MS = 10_000;

/**
 * The monitor's participants, attempts and counts, kept current.
 *
 * It used to be read once and never again, on the reasoning that the socket
 * feed took over. The feed carries connections and events, though, not
 * attempts — so a Coder who started, submitted or was graded after the
 * monitor opened stayed "Not started" on it until the page was reloaded, and
 * a Coder who joined late never appeared at all. Events are left out of these
 * re-reads; `useMonitorBacklog` fetched them once.
 */
export function useMonitorSnapshot(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: [...sessionKeys.monitor(sessionId), "rows"] as const,
    queryFn: ({ signal }) =>
      apiClient.get<MonitorSnapshot>(`/api/sessions/${sessionId}/monitor`, {
        signal,
        query: { events: "false" },
      }),
    refetchInterval: enabled ? MONITOR_POLL_MS : false,
    placeholderData: (previous) => previous,
  });
}

/** The events that happened before the monitor opened. Read once; the feed continues it. */
export function useMonitorBacklog(sessionId: string) {
  return useQuery({
    queryKey: [...sessionKeys.monitor(sessionId), "backlog"] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<MonitorSnapshot>(`/api/sessions/${sessionId}/monitor`, { signal }))
        .events,
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

export function useDeleteSession(sessionId: string, assessmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<{ deleted: boolean }>(`/api/sessions/${sessionId}`),
    onSuccess: async () => {
      // The detail query is dropped rather than refetched: it would 404.
      queryClient.removeQueries({ queryKey: sessionKeys.detail(sessionId) });
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list(assessmentId) });
      await queryClient.invalidateQueries({ queryKey: assessmentKeys.detail(assessmentId) });
    },
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
