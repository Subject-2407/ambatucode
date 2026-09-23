"use client";

import { memo, useCallback, useRef, useState } from "react";
import { Box, HStack, Stack, Text, chakra } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MonitorParticipantRow } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { PixelFrame, type PixelFrameTone } from "@/components/ui/pixel-frame";
import { describeSubmission } from "@/components/assessment/submission-status";
import { formatRemaining } from "@/lib/attempt-clock";
import { CodePeekDialog } from "./code-peek";
import { ParticipantStateBadge, participantState, type ParticipantState } from "./readiness-board";

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
  // The card whose code is open. Held here rather than per card so opening one
  // does not give every other card a piece of dialog state to re-render on.
  const [peeking, setPeeking] = useState<{ attemptId: string; displayName: string } | null>(null);
  const onPeek = useCallback(
    (attemptId: string, displayName: string) => setPeeking({ attemptId, displayName }),
    [],
  );

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
              <ParticipantCard row={row} onPeek={onPeek} />
            </Box>
          );
        })}
      </Box>

      {peeking === null ? null : (
        <CodePeekDialog
          attemptId={peeking.attemptId}
          displayName={peeking.displayName}
          onClose={() => setPeeking(null)}
        />
      )}
    </Box>
  );
}

/**
 * A participant's state drives the frame as well as the badge.
 *
 * An Architect supervising a lab reads this grid from several metres away, and
 * at that distance a 4px coloured edge is legible where a badge's text is not.
 * The badge stays because colour alone is not a channel.
 */
const STATE_TONE: Readonly<Record<ParticipantState, PixelFrameTone>> = {
  READY: "accent",
  NOT_READY: "muted",
  OFFLINE: "danger",
};

/**
 * Memoized on the row object: the feed replaces one participant at a time, so
 * every other card keeps its previous props and skips rendering entirely.
 *
 * `onPeek` is held by the grid and stable, so it does not defeat that.
 */
const ParticipantCard = memo(function ParticipantCard({
  row,
  onPeek,
}: {
  row: MonitorParticipantRow;
  onPeek: (attemptId: string, displayName: string) => void;
}) {
  const submission = row.submission;
  const summary = submission ? describeSubmission(submission.status, submission.score) : null;
  const state = participantState(row);
  // Nothing to open before the Coder has started: there is no attempt, so
  // there is no source and nothing the Architect could be shown.
  const attemptId = row.attempt?.id ?? null;

  return (
    <PixelFrame tone={STATE_TONE[state]} height="100%">
      <Stack gap="2" height="100%" justify="center" px="3" py="2">
        <HStack justify="space-between" gap="3">
          <Stack gap="0" minWidth="0">
            {attemptId === null ? (
              <Text fontSize="sm" truncate>
                {row.displayName}
              </Text>
            ) : (
              // A button rather than a card-wide click target: the card carries
              // a name, a timer and several badges, and making all of it one
              // control would leave a screen reader announcing the lot as the
              // label of "view code".
              <chakra.button
                type="button"
                textAlign="start"
                minWidth="0"
                cursor="pointer"
                aria-label={`View ${row.displayName}'s code`}
                onClick={() => onPeek(attemptId, row.displayName)}
                _hover={{ color: "accent.fg", textDecoration: "underline" }}
              >
                <Text fontSize="sm" truncate>
                  {row.displayName}
                </Text>
              </chakra.button>
            )}
            <Text fontSize="xs" color="fg.muted" truncate>
              {row.username}
            </Text>
          </Stack>
          <ParticipantStateBadge state={state} />
        </HStack>

        <HStack gap="2" wrap="wrap">
          {row.attempt === null ? (
            <Text fontSize="xs" color="fg.muted">
              Not started
            </Text>
          ) : (
            <>
              <Text fontSize="xs" color="fg.muted" textStyle="data">
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
    </PixelFrame>
  );
});
