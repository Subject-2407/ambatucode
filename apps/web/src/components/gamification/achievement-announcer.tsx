"use client";

import { useCallback, useEffect, useRef } from "react";
import { toaster } from "@/components/ui/toaster";
import { useAchievementAwards, type AwardedAchievement } from "@/hooks/use-achievements";
import { useAssessmentMode } from "@/providers/assessment-mode";

/**
 * Says so when a Coder earns a title.
 *
 * Renders nothing. It is mounted once in the Coder shell so an award announces
 * itself wherever the Coder happens to be, rather than only on the page that
 * caused it.
 *
 * Two rules it enforces:
 *
 * - **Not during an assessment.** The SRS asks for gamification to recede
 *   while a formal attempt is running, and a badge popping up over a timer is
 *   exactly the distraction that rule exists to prevent. Awards earned then are
 *   held and announced when the attempt ends.
 * - **Never twice.** A reconnect can redeliver, and a title earned once should
 *   feel like it was earned once.
 */
export function AchievementAnnouncer() {
  const { active } = useAssessmentMode();
  const announced = useRef(new Set<string>());
  const pending = useRef<AwardedAchievement[]>([]);
  /** Read by the callback below, which closes over its first render. */
  const isAssessment = useRef(active);

  const show = useCallback((award: AwardedAchievement) => {
    if (announced.current.has(award.code)) return;
    announced.current.add(award.code);
    toaster.success({
      title: `Title earned: ${award.name}`,
      description: award.description,
      duration: 8_000,
    });
  }, []);

  const onAwarded = useCallback(
    (award: AwardedAchievement) => {
      if (isAssessment.current) {
        pending.current.push(award);
        return;
      }
      show(award);
    },
    [show],
  );

  useAchievementAwards(onAwarded);

  useEffect(() => {
    isAssessment.current = active;
    if (active) return;

    // The attempt ended. Anything earned during it is worth hearing now.
    const held = pending.current;
    pending.current = [];
    for (const award of held) show(award);
  }, [active, show]);

  return null;
}
