"use client";

import { HStack, Stack, Text } from "@chakra-ui/react";
import type { ParticipantView, SessionCounts } from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * READY 28/30 — OFFLINE 1 — NOT READY 1.
 *
 * The three buckets are mutually exclusive and add up to the list, which is
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
      <Badge tone="warning">Offline {counts.offline}</Badge>
      <Badge tone="neutral">Not ready {counts.notReady}</Badge>
    </HStack>
  );
}

const STATE_TONE: Readonly<Record<ParticipantState, BadgeTone>> = {
  READY: "success",
  NOT_READY: "neutral",
  OFFLINE: "warning",
};

export type ParticipantState = "READY" | "NOT_READY" | "OFFLINE";

/** Offline wins over a stale READY, the same rule the counts use. */
export function participantState(participant: {
  readyState: ParticipantView["readyState"];
  connectionState: ParticipantView["connectionState"];
}): ParticipantState {
  if (participant.connectionState === "OFFLINE") return "OFFLINE";
  return participant.readyState === "READY" ? "READY" : "NOT_READY";
}

const STATE_LABEL: Readonly<Record<ParticipantState, string>> = {
  READY: "Ready",
  NOT_READY: "Not ready",
  OFFLINE: "Offline",
};

export function ParticipantStateBadge({ state }: { state: ParticipantState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

/** The listed participants, so an Architect can see who the numbers are about. */
export function ParticipantRoster({ participants }: { participants: ParticipantView[] }) {
  const listed = participants.filter((participant) => participant.isListed);

  if (listed.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No participant list, so every enrolled Coder may take part.
      </Text>
    );
  }

  return (
    <Stack gap="2">
      {listed.map((participant) => (
        <HStack key={participant.userId} justify="space-between" gap="3">
          <Stack gap="0" minWidth="0">
            <Text fontSize="sm" truncate>
              {participant.displayName}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {participant.username}
            </Text>
          </Stack>
          <ParticipantStateBadge state={participantState(participant)} />
        </HStack>
      ))}
    </Stack>
  );
}
