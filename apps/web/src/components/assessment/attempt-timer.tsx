"use client";

import { useEffect, useRef, useState } from "react";
import { HStack, Text } from "@chakra-ui/react";
import { pixelFocusRing, pixelNotch } from "@/theme/pixel";
import { PauseCircle, Timer } from "lucide-react";
import type { ExecutionMode } from "@ambatucode/shared";
import {
  describeRemaining,
  formatRemaining,
  remainingFrom,
  shouldAnnounceTier,
  timerTier,
  type TimerTier,
} from "@/lib/attempt-clock";
import type { AttemptTimerState } from "@/hooks/use-attempt-socket";

/**
 * The countdown.
 *
 * It renders the server's deadline through the measured clock skew, on
 * `requestAnimationFrame` rather than an interval: a frame callback is paused
 * by the browser while the tab is hidden and resumes in step with the display,
 * so the digits never drift or stutter and a backgrounded tab costs nothing.
 *
 * Reaching zero here means nothing. The server decides when an attempt ends,
 * and the workspace waits for it to say so — this component's last job is to
 * stop counting and let the caller show "Finishing…".
 */

const TIER_COLOR: Readonly<Record<TimerTier, string>> = {
  normal: "fg.default",
  warning: "fg.warning",
  danger: "fg.error",
  expired: "fg.error",
};

/**
 * The last frame's reading, tagged with the deadline it was measured against.
 *
 * The tag is what makes it safe to render from: when the server moves the
 * deadline — an Individual clock resuming, a tick correcting a drifted
 * browser — the stale reading no longer matches and the value is recomputed
 * on the spot rather than showing the old countdown for a frame.
 */
type Reading = { deadlineMs: number; remainingMs: number };

export function AttemptTimer({
  timer,
  executionMode,
  onExpire,
}: {
  timer: AttemptTimerState;
  executionMode: ExecutionMode | null;
  /**
   * Fired once when the local countdown reaches zero. It is a cue to stop
   * offering Submit and say "Finishing…", never a conclusion that the attempt
   * is over — only the server's `attempt:auto_submitted` decides that.
   */
  onExpire?: () => void;
}) {
  const { deadlineMs, skewMs, paused, frozenRemainingMs } = timer;

  const [reading, setReading] = useState<Reading | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  /** Which escalations have been announced, so each is said exactly once. */
  const announced = useRef<TimerTier[]>([]);
  const expired = useRef(false);
  const expireRef = useRef(onExpire);

  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (paused || deadlineMs === null) return;

    let frame = 0;
    /** Only re-render when the shown second changes; a frame is far finer. */
    let shownSecond = -1;

    const step = () => {
      const next = remainingFrom(deadlineMs, skewMs);
      const second = Math.ceil(next / 1000);
      if (second !== shownSecond) {
        shownSecond = second;
        setReading({ deadlineMs, remainingMs: next });

        const tier = timerTier(next);
        if (shouldAnnounceTier(tier, announced.current)) {
          announced.current = [...announced.current, tier];
          setAnnouncement(describeRemaining(next));
        }
        if (tier === "expired" && !expired.current) {
          expired.current = true;
          expireRef.current?.();
        }
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [deadlineMs, paused, skewMs]);

  const remainingMs = paused
    ? frozenRemainingMs
    : deadlineMs === null
      ? null
      : reading?.deadlineMs === deadlineMs
        ? reading.remainingMs
        : remainingFrom(deadlineMs, skewMs);

  if (remainingMs === null) {
    return (
      <HStack gap="2" color="fg.muted">
        <Timer size={16} aria-hidden />
        <Text fontSize="sm">No time limit</Text>
      </HStack>
    );
  }

  const tier = timerTier(remainingMs);

  return (
    <HStack gap="2" aria-label="Time remaining">
      {paused ? <PauseCircle size={16} aria-hidden /> : <Timer size={16} aria-hidden />}
      {/*
        The display face and a hard border, because this is the one number an
        Architect reads from the back of a lab and a Coder checks without
        breaking off from the editor. The tier drives the border as well as the
        text, so running out is legible without depending on colour alone.
      */}
      <Text
        textStyle="display"
        fontSize="xl"
        fontVariantNumeric="tabular-nums"
        color={TIER_COLOR[tier]}
        borderWidth="0"
        boxShadow={pixelFocusRing("currentColor", 3)}
        clipPath={pixelNotch(3)}
        borderRadius="0"
        paddingInline="2.5"
        paddingBlock="0.5"
        lineHeight="1.3"
      >
        {formatRemaining(remainingMs)}
      </Text>
      {paused ? (
        <Text fontSize="xs" color="fg.muted">
          Paused
        </Text>
      ) : executionMode === "LIVE" ? (
        <Text fontSize="xs" color="fg.muted">
          Live
        </Text>
      ) : null}

      {/*
        Assertive because a timer warning is the one message worth interrupting
        a screen reader for. The visible digits carry no announcement of their
        own — reading every second aloud would make the workspace unusable.
      */}
      <Text srOnly aria-live="assertive" aria-atomic="true">
        {announcement}
      </Text>
    </HStack>
  );
}
