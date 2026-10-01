"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Box, HStack, Stack, Text, chakra } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ShieldAlert } from "lucide-react";
import { readinessStateOf, type MonitorParticipantRow } from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PixelFrame, type PixelFrameTone } from "@/components/ui/pixel-frame";
import { describeSubmission } from "@/components/assessment/submission-status";
import { formatRemaining } from "@/lib/attempt-clock";
import { attemptPhase, type AttemptPhase } from "@/lib/monitor-rows";
import { CodePeekDialog } from "./code-peek";
import { PresenceBadge, ReadinessStateBadge } from "./readiness-board";

/**
 * One card per participant, virtualized.
 *
 * A lab session is a hundred or more Coders and the feed updates constantly,
 * so only the rows on screen are rendered and each card is memoized: a single
 * participant's disconnect must re-render one card, not the grid.
 */

/** Fixed so the virtualizer can measure without a layout pass per row. */
const ROW_HEIGHT = 92;
const OVERSCAN = 6;

export function ParticipantGrid({
  rows,
  started,
  readAtMs,
  flags,
  emptyMessage,
}: {
  rows: MonitorParticipantRow[];
  /** Before the start a card shows readiness; after it, the attempt. */
  started: boolean;
  /** When the rows were read, which is what the countdowns run from. */
  readAtMs: number;
  flags: ReadonlyMap<string, number>;
  emptyMessage: string;
}) {
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
        {emptyMessage}
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
              <ParticipantCard
                row={row}
                started={started}
                readAtMs={readAtMs}
                flags={flags.get(row.userId) ?? 0}
                onPeek={onPeek}
              />
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

const PHASE_LABEL: Readonly<Record<AttemptPhase, string>> = {
  NOT_STARTED: "Not started",
  WORKING: "Working",
  PAUSED: "Paused",
  SUBMITTED: "Submitted",
  EXPIRED: "Closed, nothing submitted",
};

const PHASE_TONE: Readonly<Record<AttemptPhase, BadgeTone>> = {
  NOT_STARTED: "neutral",
  WORKING: "info",
  PAUSED: "warning",
  SUBMITTED: "success",
  EXPIRED: "warning",
};

/**
 * A participant's state drives the frame as well as the badges.
 *
 * An Architect supervising a lab reads this grid from several metres away, and
 * at that distance a 4px coloured edge is legible where a badge's text is not.
 * The edge answers "does this one need me": someone mid-attempt who is not on
 * the workspace is the case worth walking over for. Colour is never the only
 * channel — the badges say the same in words.
 */
function frameTone(row: MonitorParticipantRow, started: boolean): PixelFrameTone {
  if (!started) {
    switch (readinessStateOf(row)) {
      case "READY":
        return "accent";
      case "OFFLINE":
        return "danger";
      case "ELSEWHERE":
        return "info";
      default:
        return "muted";
    }
  }
  const phase = attemptPhase(row);
  if (phase === "SUBMITTED") return "success";
  if (phase === "WORKING" || phase === "PAUSED") {
    if (row.presence === "OFFLINE") return "danger";
    if (row.presence === "ELSEWHERE") return "warning";
    return "accent";
  }
  return "muted";
}

/**
 * Memoized on the row object: the feed replaces one participant at a time, so
 * every other card keeps its previous props and skips rendering entirely.
 *
 * `onPeek` is held by the grid and stable, so it does not defeat that.
 */
const ParticipantCard = memo(function ParticipantCard({
  row,
  started,
  readAtMs,
  flags,
  onPeek,
}: {
  row: MonitorParticipantRow;
  started: boolean;
  readAtMs: number;
  flags: number;
  onPeek: (attemptId: string, displayName: string) => void;
}) {
  const submission = row.submission;
  const summary = submission ? describeSubmission(submission.status, submission.score) : null;
  const phase = attemptPhase(row);
  // Nothing to open before the Coder has started: there is no attempt, so
  // there is no source and nothing the Architect could be shown.
  const attemptId = row.attempt?.id ?? null;

  return (
    <PixelFrame tone={frameTone(row, started)} height="100%">
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
          {started ? (
            <PresenceBadge presence={row.presence} />
          ) : (
            <ReadinessStateBadge state={readinessStateOf(row)} />
          )}
        </HStack>

        <HStack gap="2" wrap="wrap">
          {started ? <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge> : null}
          {row.attempt !== null && row.attempt.remainingMs !== null ? (
            <RemainingTime
              remainingMs={row.attempt.remainingMs}
              paused={row.attempt.paused}
              readAtMs={readAtMs}
            />
          ) : null}
          {row.attempt !== null && row.attempt.attemptNumber > 1 ? (
            <Badge tone="neutral">Attempt {row.attempt.attemptNumber}</Badge>
          ) : null}
          {summary ? <Badge tone={summary.tone}>{summary.label}</Badge> : null}
          {submission?.isAutoSubmitted ? <Badge tone="warning">Auto</Badge> : null}
          {flags > 0 ? (
            <Badge tone="warning" title="Anti-cheat events in this session">
              <ShieldAlert size={12} aria-hidden /> {flags}
            </Badge>
          ) : null}
        </HStack>
      </Stack>
    </PixelFrame>
  );
});

/**
 * The time left, counting down between re-reads.
 *
 * The snapshot gives the remainder at the moment it was read. Shown as read,
 * every timer on the grid stood still for ten seconds and then jumped, which
 * read as the monitor having frozen. A paused clock is shown as it stands.
 */
function RemainingTime({
  remainingMs,
  paused,
  readAtMs,
}: {
  remainingMs: number;
  paused: boolean;
  readAtMs: number;
}) {
  const [nowMs, setNowMs] = useState(readAtMs);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [paused]);

  const left = paused ? remainingMs : Math.max(0, remainingMs - Math.max(0, nowMs - readAtMs));
  return (
    <Text fontSize="xs" color={left < 60_000 ? "fg.warning" : "fg.muted"} textStyle="data">
      {formatRemaining(left)}
      {paused ? " · paused" : " left"}
    </Text>
  );
}
