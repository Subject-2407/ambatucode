"use client";

import { memo, useRef } from "react";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MonitorParticipantRow } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { describeSubmission } from "@/components/assessment/submission-status";
import { formatRemaining } from "@/lib/attempt-clock";
import { ParticipantStateBadge, participantState } from "./readiness-board";

/**
 * One card per participant, virtualized.
 *
 * A lab session is a hundred or more Coders and the feed updates constantly,
 * so only the rows on screen are rendered and each card is memoized: a single
 * participant's disconnect must re-render one card, not the grid.
 */

/** Fixed so the virtualizer can measure without a layout pass per row. */
const ROW_HEIGHT = 88;
const OVERSCAN = 6;

export function ParticipantGrid({ rows }: { rows: MonitorParticipantRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No participants have joined this session yet.
      </Text>
    );
  }

  return (
    <Box ref={scrollRef} height="32rem" overflowY="auto" role="list" aria-label="Participants">
      <Box position="relative" height={`${String(virtualizer.getTotalSize())}px`}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <Box
              key={row.userId}
              role="listitem"
              position="absolute"
              top="0"
              insetStart="0"
              width="100%"
              height={`${String(item.size)}px`}
              transform={`translateY(${String(item.start)}px)`}
              px="1"
              py="1"
            >
              <ParticipantCard row={row} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Memoized on the row object: the feed replaces one participant at a time, so
 * every other card keeps its previous props and skips rendering entirely.
 */
const ParticipantCard = memo(function ParticipantCard({ row }: { row: MonitorParticipantRow }) {
  const submission = row.submission;
  const summary = submission ? describeSubmission(submission.status, submission.score) : null;

  return (
    <Stack
      gap="2"
      height="100%"
      justify="center"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="md"
      bg="bg.surface"
      px="3"
      py="2"
    >
      <HStack justify="space-between" gap="3">
        <Stack gap="0" minWidth="0">
          <Text fontSize="sm" truncate>
            {row.displayName}
          </Text>
          <Text fontSize="xs" color="fg.muted" truncate>
            {row.username}
          </Text>
        </Stack>
        <ParticipantStateBadge state={participantState(row)} />
      </HStack>

      <HStack gap="2" wrap="wrap">
        {row.attempt === null ? (
          <Text fontSize="xs" color="fg.muted">
            Not started
          </Text>
        ) : (
          <>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {row.attempt.remainingMs === null
                ? "No timer"
                : formatRemaining(row.attempt.remainingMs)}
            </Text>
            {row.attempt.paused ? <Badge tone="warning">Paused</Badge> : null}
            {row.attempt.attemptNumber > 1 ? (
              <Badge tone="neutral">Attempt {row.attempt.attemptNumber}</Badge>
            ) : null}
          </>
        )}
        {summary ? <Badge tone={summary.tone}>{summary.label}</Badge> : null}
        {submission?.isAutoSubmitted ? <Badge tone="warning">Auto</Badge> : null}
      </HStack>
    </Stack>
  );
});
