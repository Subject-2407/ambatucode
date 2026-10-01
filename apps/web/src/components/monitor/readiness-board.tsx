"use client";

import { HStack, Stack, Text } from "@chakra-ui/react";
import {
  readinessStateOf,
  type ParticipantPresence,
  type ParticipantView,
  type ReadinessState,
  type RosterSource,
  type SessionCounts,
} from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * READY 28/30 — NOT READY 1 — OFFLINE 1.
 *
 * The three buckets are mutually exclusive and add up to the roster, which is
 * what makes the number an Architect can act on: a Coder who is marked ready
 * but is no longer connected counts as offline, because they are not sitting
 * there ready to start.
 */
export function ReadinessBoard({ counts }: { counts: SessionCounts }) {
  return (
    <HStack gap="3" wrap="wrap" aria-live="polite">
      <Badge tone="success">
        Ready {counts.ready}/{counts.total}
      </Badge>
      <Badge tone="neutral">Not ready {counts.notReady}</Badge>
      <Badge tone="warning">Offline {counts.offline}</Badge>
    </HStack>
  );
}

const STATE_TONE: Readonly<Record<ReadinessState, BadgeTone>> = {
  READY: "success",
  NOT_READY: "neutral",
  ELSEWHERE: "info",
  OFFLINE: "warning",
};

const STATE_LABEL: Readonly<Record<ReadinessState, string>> = {
  READY: "Ready",
  NOT_READY: "Here, not ready",
  // Said plainly, because it is the answer to "why is this one not ready":
  // they are signed in, just not on the assessment page.
  ELSEWHERE: "Online, not on the page",
  OFFLINE: "Offline",
};

export function ReadinessStateBadge({ state }: { state: ReadinessState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

const PRESENCE_TONE: Readonly<Record<ParticipantPresence, BadgeTone>> = {
  HERE: "success",
  ELSEWHERE: "info",
  OFFLINE: "warning",
};

const PRESENCE_LABEL: Readonly<Record<ParticipantPresence, string>> = {
  HERE: "On the page",
  ELSEWHERE: "Elsewhere in the app",
  OFFLINE: "Offline",
};

/** Once a session has started, readiness is history; where the Coder is is not. */
export function PresenceBadge({ presence }: { presence: ParticipantPresence }) {
  return <Badge tone={PRESENCE_TONE[presence]}>{PRESENCE_LABEL[presence]}</Badge>;
}

const STATE_ORDER: Readonly<Record<ReadinessState, number>> = {
  READY: 0,
  NOT_READY: 1,
  ELSEWHERE: 2,
  OFFLINE: 3,
};

/**
 * The roster, so an Architect can see who the numbers are about.
 *
 * Ready first and offline last: before an exam the useful reading is from the
 * bottom up — who is missing — and grouping them is what makes that a glance
 * rather than a scan of thirty names.
 */
export function ParticipantRoster({
  participants,
  rosterSource,
  started,
}: {
  participants: ParticipantView[];
  rosterSource: RosterSource;
  /** After the start, presence replaces readiness as the thing worth showing. */
  started: boolean;
}) {
  const expected = participants
    .filter((participant) => participant.onRoster)
    .map((participant) => ({ participant, state: readinessStateOf(participant) }))
    .sort(
      (a, b) =>
        (started ? 0 : STATE_ORDER[a.state] - STATE_ORDER[b.state]) ||
        a.participant.displayName.localeCompare(b.participant.displayName),
    );

  if (expected.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        {rosterSource === "NONE"
          ? "Nobody has been chosen yet. Choose participants below, or let everyone enrolled take part."
          : "Nobody is enrolled in this module yet."}
      </Text>
    );
  }

  return (
    <Stack gap="2" maxHeight="24rem" overflowY="auto">
      {expected.map(({ participant, state }) => (
        <HStack key={participant.userId} justify="space-between" gap="3">
          <Stack gap="0" minWidth="0">
            <Text fontSize="sm" truncate>
              {participant.displayName}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {participant.username}
            </Text>
          </Stack>
          {started ? (
            <PresenceBadge presence={participant.presence} />
          ) : (
            <ReadinessStateBadge state={state} />
          )}
        </HStack>
      ))}
    </Stack>
  );
}
