"use client";

import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import type { AttemptSourceOrigin, AttemptSourceSnapshot } from "@ambatucode/shared";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttemptSource } from "@/hooks/use-attempt-source";

/**
 * What a Coder is actually writing, while they are writing it.
 *
 * An Architect supervising a lab could previously see that a submission had
 * happened and what it scored, but not a line of the program — which made
 * "help me, it will not compile" a conversation conducted by description. A
 * Run now leaves its source behind, so the code is readable from the moment
 * the Coder first executes it rather than only after they hand it in.
 *
 * Read-only, and plainly so: a `pre`, not an editor. There is nothing here to
 * change, and a Monaco instance per participant card in a hundred-seat lab is
 * a cost paid for the appearance of one.
 */

const ORIGIN_LABEL: Readonly<Record<AttemptSourceOrigin, string>> = {
  RUN: "Last run",
  SUBMISSION: "Submitted",
};

const ORIGIN_TONE: Readonly<Record<AttemptSourceOrigin, BadgeTone>> = {
  RUN: "info",
  SUBMISSION: "success",
};

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function CodePeekDialog({
  attemptId,
  displayName,
  onClose,
}: {
  attemptId: string;
  displayName: string;
  onClose: () => void;
}) {
  const { data, isPending, isError, error, refetch } = useAttemptSource(attemptId);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={`${displayName} — code`}
    >
      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <Stack gap="3">
          <Skeleton height="2rem" />
          <Skeleton height="14rem" />
        </Stack>
      ) : data.snapshots.length === 0 ? (
        <EmptyState
          sprite="doc"
          title="Nothing to show yet"
          description="Code appears here the first time this Coder presses Run, and again when they submit."
        />
      ) : (
        <Stack gap="4">
          <Text fontSize="xs" color="fg.muted">
            {data.runCount === 0
              ? "No runs yet."
              : `${String(data.runCount)} ${data.runCount === 1 ? "run" : "runs"} on this attempt.`}
          </Text>
          {data.snapshots.map((snapshot) => (
            <SnapshotBlock key={`${snapshot.origin}-${snapshot.capturedAt}`} snapshot={snapshot} />
          ))}
        </Stack>
      )}
    </Modal>
  );
}

function SnapshotBlock({ snapshot }: { snapshot: AttemptSourceSnapshot }) {
  return (
    <Stack gap="2">
      <HStack gap="2" wrap="wrap">
        <Badge tone={ORIGIN_TONE[snapshot.origin]}>{ORIGIN_LABEL[snapshot.origin]}</Badge>
        <Badge tone="neutral" plain>
          {LANGUAGE_LABEL[snapshot.language]}
        </Badge>
        <Text fontSize="xs" color="fg.muted" textStyle="data">
          {formatMoment(snapshot.capturedAt)}
        </Text>
      </HStack>

      <PixelFrame weight={2} surface="bg.canvas">
        <Box
          as="pre"
          margin="0"
          padding="3"
          textStyle="data"
          fontSize="xs"
          lineHeight="1.6"
          maxHeight="22rem"
          overflow="auto"
          whiteSpace="pre"
        >
          {snapshot.sourceCode}
        </Box>
      </PixelFrame>
    </Stack>
  );
}
