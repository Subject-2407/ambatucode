"use client";

import { memo, useRef } from "react";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AssessmentEventType, MonitorEventPayload } from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * The chronological feed of what happened in this session.
 *
 * Tone matters here as much as layout. A disconnect is a logged fact, not an
 * accusation: Wi-Fi drops, laptops sleep, and the SRS is explicit that a
 * disconnect is never an automatic cheating penalty. So connection events read
 * as information, and only the anti-cheat events carry a warning colour — and
 * even those say what was observed, never what it meant.
 */

const ROW_HEIGHT = 56;

const EVENT_LABEL: Readonly<Record<AssessmentEventType, string>> = {
  SESSION_STARTED: "Session started",
  SESSION_ENDED: "Session ended",
  ATTEMPT_STARTED: "Started the assessment",
  ATTEMPT_SUBMITTED: "Submitted",
  ATTEMPT_AUTO_SUBMITTED: "Auto-submitted at the deadline",
  ATTEMPT_EXPIRED: "Attempt closed with nothing to submit",
  CONNECTED: "Connected",
  DISCONNECTED: "Disconnected",
  RECONNECTED: "Reconnected",
  FOCUS_LOST: "Left the assessment window",
  FOCUS_REGAINED: "Returned to the window",
  CLIPBOARD_BLOCKED: "Clipboard action blocked",
  TIMER_PAUSED: "Timer paused",
  TIMER_RESUMED: "Timer resumed",
  ATTEMPT_RESET: "Attempt reset",
};

const EVENT_TONE: Readonly<Record<AssessmentEventType, BadgeTone>> = {
  SESSION_STARTED: "info",
  SESSION_ENDED: "neutral",
  ATTEMPT_STARTED: "info",
  ATTEMPT_SUBMITTED: "success",
  ATTEMPT_AUTO_SUBMITTED: "warning",
  ATTEMPT_EXPIRED: "warning",
  CONNECTED: "neutral",
  DISCONNECTED: "neutral",
  RECONNECTED: "neutral",
  FOCUS_LOST: "warning",
  FOCUS_REGAINED: "neutral",
  CLIPBOARD_BLOCKED: "warning",
  TIMER_PAUSED: "neutral",
  TIMER_RESUMED: "neutral",
  ATTEMPT_RESET: "info",
};

export function EventStream({
  events,
  nameFor,
}: {
  events: MonitorEventPayload[];
  /** Resolves a user id to a display name; ids mean nothing to an Architect. */
  nameFor: (userId: string | null) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (events.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Nothing has happened in this session yet.
      </Text>
    );
  }

  return (
    <Box ref={scrollRef} height="32rem" overflowY="auto" role="log" aria-label="Session events">
      <Box position="relative" height={`${String(virtualizer.getTotalSize())}px`}>
        {virtualizer.getVirtualItems().map((item) => {
          const event = events[item.index];
          if (!event) return null;
          return (
            <Box
              key={event.id}
              position="absolute"
              top="0"
              insetStart="0"
              width="100%"
              height={`${String(item.size)}px`}
              px="1"
            >
              <EventRow event={event} name={nameFor(event.userId)} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const EventRow = memo(function EventRow({
  event,
  name,
}: {
  event: MonitorEventPayload;
  name: string;
}) {
  return (
    <HStack
      justify="space-between"
      gap="3"
      height="100%"
      borderBottomWidth="1px"
      borderColor="border.muted"
      px="2"
    >
      <Stack gap="0" minWidth="0">
        <HStack gap="2" minWidth="0">
          <Badge tone={EVENT_TONE[event.type]}>{EVENT_LABEL[event.type]}</Badge>
          <Text fontSize="sm" truncate>
            {name}
          </Text>
        </HStack>
        {event.durationMs === null ? null : (
          <Text fontSize="xs" color="fg.muted">
            after {Math.round(event.durationMs / 1000)}s
          </Text>
        )}
      </Stack>
      <Text fontSize="xs" color="fg.muted" flexShrink="0" fontVariantNumeric="tabular-nums">
        {new Date(event.occurredAt).toLocaleTimeString()}
      </Text>
    </HStack>
  );
});
