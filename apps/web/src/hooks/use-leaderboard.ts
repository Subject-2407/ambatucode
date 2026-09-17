"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  leaderboardUpdatePayloadSchema,
  type LeaderboardScope,
  type LeaderboardView,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { getSocket } from "@/lib/socket";

/**
 * A leaderboard, fetched once and then kept current by the server.
 *
 * The HTTP read is the source of the whole view — the title, how many
 * assessments it counts, how many its Architects hid. The socket carries rows
 * only, so an update patches the rows into the cached view rather than
 * replacing it. Joining the room is authorized server-side against the Module,
 * so a failed join simply means no live updates, never a broken page.
 */

export const leaderboardKeys = {
  all: ["leaderboard"] as const,
  scope: (scope: LeaderboardScope, scopeId: string, limit: number) =>
    ["leaderboard", scope, scopeId, limit] as const,
};

const PATH_FOR_SCOPE: Readonly<Record<LeaderboardScope, (id: string) => string>> = {
  MODULE: (id) => `/api/modules/${id}/leaderboard`,
  SECTION: (id) => `/api/sections/${id}/leaderboard`,
  ASSESSMENT: (id) => `/api/assessments/${id}/leaderboard`,
};

export function useLeaderboard(
  scope: LeaderboardScope,
  scopeId: string,
  options: { limit?: number; enabled?: boolean } = {},
) {
  const limit = options.limit ?? 25;
  const enabled = (options.enabled ?? true) && scopeId !== "";
  const queryClient = useQueryClient();
  const queryKey = leaderboardKeys.scope(scope, scopeId, limit);

  const query = useQuery({
    enabled,
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<LeaderboardView>(PATH_FOR_SCOPE[scope](scopeId), { signal, query: { limit } }),
    // The server caches for five seconds; matching that here keeps a tab
    // switch from firing a request the server would answer from cache anyway.
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const payload = { scope, scopeId };

    /**
     * Room membership belongs to a socket, and a reconnect is a new socket. A
     * board that joined once and never rejoined would look alive and silently
     * stop updating — the worst failure available to a live view.
     */
    function join() {
      socket.emit(CLIENT_EVENTS.LEADERBOARD_JOIN, payload);
    }

    join();
    socket.on("connect", join);

    function onUpdate(raw: unknown) {
      const parsed = leaderboardUpdatePayloadSchema.safeParse(raw);
      if (!parsed.success) return;
      // One socket can watch several boards at once.
      if (parsed.data.scope !== scope || parsed.data.scopeId !== scopeId) return;

      queryClient.setQueryData<LeaderboardView>(queryKey, (previous) =>
        previous === undefined
          ? previous
          : { ...previous, rows: parsed.data.rows.slice(0, limit), generatedAtMs: Date.now() },
      );
    }

    socket.on(SERVER_EVENTS.LEADERBOARD_UPDATE, onUpdate);
    return () => {
      socket.off("connect", join);
      socket.off(SERVER_EVENTS.LEADERBOARD_UPDATE, onUpdate);
      socket.emit(CLIENT_EVENTS.LEADERBOARD_LEAVE, payload);
    };
    // `queryKey` is derived from the three values already listed.
  }, [enabled, scope, scopeId, limit, queryClient, queryKey]);

  return query;
}
