"use client";

import { Box, Flex, HStack, RadioGroup, Stack, Text } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import type { GradeAttemptView, GradeRecordView, SubmissionStatus } from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";

/**
 * One Coder's work at one Assessment Session: every attempt, and which of them
 * supplies the official score.
 *
 * Attempts are shown expanded rather than behind a disclosure. A record with
 * more than one attempt is a record somebody reset, and the reason for the
 * reset plus the scores either side of it are precisely what an Architect
 * opened this screen to compare.
 */

const STATUS_TONE: Readonly<Record<SubmissionStatus, BadgeTone>> = {
  QUEUED: "neutral",
  RUNNING: "info",
  GRADED: "success",
  COMPILE_ERROR: "danger",
  RUNTIME_ERROR: "danger",
  TIME_LIMIT_EXCEEDED: "danger",
  MEMORY_LIMIT_EXCEEDED: "danger",
  SYSTEM_ERROR: "danger",
};

const STATUS_LABEL: Readonly<Record<SubmissionStatus, string>> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  GRADED: "Graded",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIME_LIMIT_EXCEEDED: "Time limit",
  MEMORY_LIMIT_EXCEEDED: "Memory limit",
  SYSTEM_ERROR: "System error",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A score of zero and no score at all are different facts; neither is the other. */
function ScoreText({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        —
      </Text>
    );
  }
  return (
    <Text fontWeight="semibold" fontVariantNumeric="tabular-nums">
      {score}
    </Text>
  );
}

function AttemptLine({
  attempt,
  canReset,
  onReset,
}: {
  attempt: GradeAttemptView;
  canReset: boolean;
  onReset: () => void;
}) {
  return (
    <Flex
      gap="3"
      align="center"
      justify="space-between"
      wrap="wrap"
      paddingY="1.5"
      borderTopWidth="1px"
      borderColor="border.default"
    >
      <HStack gap="3" minWidth="0" wrap="wrap">
        {/* The radio is the official-score choice; its group is on the record. */}
        <RadioGroup.Item value={attempt.id} disabled={attempt.submission === null}>
          <RadioGroup.ItemHiddenInput />
          <RadioGroup.ItemIndicator />
          <RadioGroup.ItemText>
            <Text fontSize="sm">Attempt {attempt.attemptNumber}</Text>
          </RadioGroup.ItemText>
        </RadioGroup.Item>

        {attempt.submission === null ? (
          <Badge tone="neutral" size="sm">
            {attempt.status === "NOT_STARTED" ? "Not started" : "No submission"}
          </Badge>
        ) : (
          <>
            <Badge tone={STATUS_TONE[attempt.submission.status]} size="sm">
              {STATUS_LABEL[attempt.submission.status]}
            </Badge>
            <ScoreText score={attempt.submission.score} />
            <Text fontSize="xs" color="fg.muted">
              {attempt.submission.language} · {formatDateTime(attempt.submission.submittedAt)}
              {attempt.submission.isAutoSubmitted ? " · auto-submitted" : ""}
            </Text>
          </>
        )}

        {attempt.status === "RESET" ? (
          <Text fontSize="xs" color="fg.muted" title={attempt.resetReason ?? undefined}>
            Reset{attempt.resetByDisplayName === null ? "" : ` by ${attempt.resetByDisplayName}`}
            {attempt.resetReason === null ? "" : `: ${attempt.resetReason}`}
          </Text>
        ) : null}
      </HStack>

      {canReset ? (
        <Button size="xs" variant="ghost" onClick={onReset}>
          <RotateCcw aria-hidden />
          Reset
        </Button>
      ) : null}
    </Flex>
  );
}

export function GradeRecordRow({
  record,
  busy,
  onReset,
  onSetOfficial,
}: {
  record: GradeRecordView;
  busy: boolean;
  onReset: (attempt: GradeAttemptView) => void;
  onSetOfficial: (attemptId: string) => void;
}) {
  return (
    <Table.Row>
      <Table.Cell verticalAlign="top">
        <Stack gap="0.5">
          <Text fontWeight="medium">{record.displayName}</Text>
          <Text fontSize="xs" color="fg.muted">
            {record.username}
          </Text>
        </Stack>
      </Table.Cell>

      <Table.Cell verticalAlign="top">
        <Stack gap="0.5">
          <Text fontSize="sm">{record.assessmentTitle}</Text>
          <Text fontSize="xs" color="fg.muted">
            {record.sectionTitle} · {record.sessionName}
          </Text>
        </Stack>
      </Table.Cell>

      <Table.Cell verticalAlign="top" textAlign="end">
        <Stack gap="0.5" align="end">
          <ScoreText score={record.officialScore} />
          {record.officialAttemptId === null ? (
            <Text fontSize="xs" color="warning.fg">
              Choose an attempt
            </Text>
          ) : null}
        </Stack>
      </Table.Cell>

      <Table.Cell verticalAlign="top">
        <RadioGroup.Root
          value={record.officialAttemptId ?? ""}
          disabled={busy}
          onValueChange={(details) => {
            if (details.value !== null && details.value !== record.officialAttemptId) {
              onSetOfficial(details.value);
            }
          }}
          aria-label={`Official attempt for ${record.displayName}`}
        >
          <Box>
            {record.attempts.map((attempt) => (
              <AttemptLine
                key={attempt.id}
                attempt={attempt}
                // A reset attempt is already closed; resetting it again is not
                // a thing, and the server refuses it.
                canReset={attempt.status !== "RESET"}
                onReset={() => onReset(attempt)}
              />
            ))}
          </Box>
        </RadioGroup.Root>
      </Table.Cell>
    </Table.Row>
  );
}
