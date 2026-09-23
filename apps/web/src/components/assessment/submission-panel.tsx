"use client";

import { Box, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import { Badge } from "@/components/ui/badge";
import { describeCaseOutcome } from "@/components/content/run-status";
import { ConsoleFrame } from "@/components/editor/run-results";
import type { AttemptSubmissionState } from "@/hooks/use-attempt-submission";
import { describeSubmission } from "./submission-status";

/**
 * The formal Submission, from the moment it is queued to the moment it has a
 * score.
 *
 * Only the aggregate is shown. Per-case detail comes from the Coder-facing
 * serializer, which has already dropped every hidden row — so what appears
 * here is what the Coder was always allowed to see, and there is no filtering
 * left for this component to get wrong.
 */
export function SubmissionPanel({ state }: { state: AttemptSubmissionState }) {
  if (state.phase === "none") return null;

  if (state.phase === "submitting") {
    return (
      <ConsoleFrame>
        <HStack gap="3">
          <Spinner size="sm" color="accent.solid" />
          <Text fontSize="sm" color="fg.muted" aria-live="polite">
            Sending your submission…
          </Text>
        </HStack>
      </ConsoleFrame>
    );
  }

  const { submission } = state;
  const summary = describeSubmission(submission.status, submission.score);
  const detail = state.phase === "settled" ? state.detail : null;

  return (
    <ConsoleFrame>
      <Stack gap="3">
        <HStack gap="3" aria-live="polite">
          {summary.settled ? null : <Spinner size="xs" color="accent.solid" />}
          <Badge tone={summary.tone}>{summary.label}</Badge>
          {submission.isAutoSubmitted ? <Badge tone="warning">Auto-submitted</Badge> : null}
        </HStack>

        <Text fontSize="sm" color="fg.muted">
          {summary.detail}
        </Text>

        {detail?.compilerOutput && detail.compilerOutput.trim() !== "" ? (
          <Box
            as="pre"
            textStyle="data"
            fontSize="xs"
            whiteSpace="pre-wrap"
            color="fg.muted"
            maxHeight="12rem"
            overflowY="auto"
          >
            {detail.compilerOutput}
          </Box>
        ) : null}

        {detail && detail.testResults.length > 0 ? (
          <Stack gap="1">
            <Text fontSize="xs" color="fg.subtle">
              Public cases
            </Text>
            {detail.testResults.map((result, index) => (
              <HStack key={`${result.name}-${String(index)}`} gap="2" justify="space-between">
                <Text fontSize="sm" truncate>
                  {result.name}
                </Text>
                <Badge tone={result.passed ? "success" : "danger"}>
                  {describeCaseOutcome(result)}
                </Badge>
              </HStack>
            ))}
          </Stack>
        ) : null}

        {summary.settled ? (
          <Text fontSize="xs" color="fg.subtle">
            Hidden grading cases are not shown. Your score already includes them.
          </Text>
        ) : null}
      </Stack>
    </ConsoleFrame>
  );
}
