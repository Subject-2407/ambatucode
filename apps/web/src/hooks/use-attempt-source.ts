"use client";

import { useQuery } from "@tanstack/react-query";
import type { AttemptSourceView } from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

export const attemptSourceKeys = {
  all: ["attempt-source"] as const,
  byAttempt: (attemptId: string) => ["attempt-source", attemptId] as const,
};

/**
 * The code a Coder has run or submitted, for the Architect supervising them.
 *
 * Refetched on an interval rather than pushed over the socket. A Run already
 * publishes its status to the Coder's own room, and widening that to carry
 * source into a monitor would put every participant's program on a channel
 * several people are subscribed to. Polling one attempt while its panel is
 * open keeps the source on a request the server authorizes each time.
 */
export function useAttemptSource(
  attemptId: string | null,
  /**
   * Whether the attempt can still change under the reader.
   *
   * False when the code is being read back from the grading records: that
   * attempt was submitted weeks ago and will never produce another snapshot,
   * so an interval there is a request every ten seconds for an answer that is
   * already final.
   */
  live = true,
) {
  return useQuery({
    enabled: attemptId !== null,
    queryKey: attemptSourceKeys.byAttempt(attemptId ?? ""),
    queryFn: ({ signal }) =>
      apiClient.get<AttemptSourceView>(`/api/attempts/${attemptId ?? ""}/source`, { signal }),
    // Long enough not to be a poll loop on a lab of a hundred, short enough
    // that a Run made while the Architect is watching shows up on its own.
    refetchInterval: live ? 10_000 : false,
  });
}
