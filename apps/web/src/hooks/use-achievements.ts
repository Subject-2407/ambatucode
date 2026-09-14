"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SERVER_EVENTS,
  achievementAwardedPayloadSchema,
  type AchievementShowcaseView,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { getSocket } from "@/lib/socket";

export const achievementKeys = {
  all: ["achievements"] as const,
  showcase: (userId: string) => ["achievements", userId] as const,
};

export function useAchievements(userId: string, enabled = true) {
  return useQuery({
    enabled: enabled && userId !== "",
    queryKey: achievementKeys.showcase(userId),
    queryFn: ({ signal }) =>
      apiClient.get<AchievementShowcaseView>(`/api/users/${userId}/achievements`, { signal }),
  });
}

export type AwardedAchievement = {
  code: string;
  name: string;
  description: string;
  iconKey: string;
};

/**
 * Listens for titles this Coder earns while they have the app open.
 *
 * The award is already written by the time this fires; the event exists so the
 * moment is visible rather than discovered later on a profile page. The
 * showcase cache is invalidated alongside, so opening it next shows the new
 * title without a manual refresh.
 *
 * `onAwarded` is called on every award. The caller decides whether now is a
 * good time to say so — during a formal assessment it is not, and gamification
 * is supposed to recede there.
 */
export function useAchievementAwards(onAwarded: (award: AwardedAchievement) => void): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    function onEvent(raw: unknown) {
      const parsed = achievementAwardedPayloadSchema.safeParse(raw);
      if (!parsed.success) return;
      void queryClient.invalidateQueries({ queryKey: achievementKeys.all });
      onAwarded({
        code: parsed.data.code,
        name: parsed.data.name,
        description: parsed.data.description,
        iconKey: parsed.data.iconKey,
      });
    }

    socket.on(SERVER_EVENTS.ACHIEVEMENT_AWARDED, onEvent);
    return () => {
      socket.off(SERVER_EVENTS.ACHIEVEMENT_AWARDED, onEvent);
    };
  }, [onAwarded, queryClient]);
}
