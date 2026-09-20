"use client";

import type { ReactNode } from "react";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { Check, X } from "lucide-react";
import type { RunTestResultView } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import {
  describeCaseOutcome,
  describeRun,
  isFreeRunResult,
  shouldShowCompilerOutput,
  withoutRuntimeNotice,
} from "@/components/content/run-status";
import type { RunJobState } from "@/hooks/use-run-job";

/**
 * What a Run tells a Coder, rendered the same way wherever it is run.
 *
 * A Practice Activity and an assessment Run show identical information — every
 * case in either is public by construction — so the panel is shared. What
 * differs between the two is what surrounds it, not what a failing case looks
 * like.
 */

export function ConsoleFrame({ children }: { children: ReactNode }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="md"
      bg="bg.subtle"
      padding="4"
    >
      {children}
    </Box>
  );
}

/** Pass and fail carry an icon and a word, never colour alone. */
export function TestResultRow({ result }: { result: RunTestResultView }) {
  // Both streams are shown: a wrong answer is judged on stdout, so hiding it
  // behind stderr leaves the Coder nothing to compare against what was expected.
  const stdout = result.stdoutExcerpt;
  const stderr = withoutRuntimeNotice(result.stderrExcerpt);

  return (
    <Stack
      gap="1"
      borderTopWidth="1px"
      borderColor="border.default"
      pt="3"
      _first={{ borderTopWidth: 0, pt: 0 }}
    >
      <HStack justify="space-between" gap="3" align="center">
        <HStack gap="2" minWidth="0">
          <Box color={result.passed ? "fg.success" : "fg.error"} aria-hidden>
            {result.passed ? <Check size={16} /> : <X size={16} />}
          </Box>
          <Text fontSize="sm" truncate>
            {result.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {describeCaseOutcome(result)}
          </Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted" flexShrink="0">
          {result.executionTimeMs} ms
        </Text>
      </HStack>

      {isFreeRunResult(result) && stdout.trim() === "" && stderr.trim() === "" ? (
        <Text fontSize="xs" color="fg.muted">
          The program printed nothing.
        </Text>
      ) : null}

      {[stdout, stderr].map((output, index) =>
        output.trim() === "" ? null : (
          <Box
            key={index === 0 ? "stdout" : "stderr"}
            as="pre"
            textStyle="data"
            fontSize="xs"
            whiteSpace="pre-wrap"
            color={index === 0 ? "fg.muted" : "fg.error"}
            maxHeight="10rem"
            overflowY="auto"
          >
            {output}
          </Box>
        ),
      )}
    </Stack>
  );
}

/**
 * Everything the Coder learns from a run. Results arrive over the socket, so
 * this is also where a run that never comes back has to say so rather than
 * leaving a spinner turning.
 */
export function RunOutcome({ state, idle }: { state: RunJobState; idle?: ReactNode }) {
  if (state.phase === "idle")
    return idle === undefined ? null : <ConsoleFrame>{idle}</ConsoleFrame>;

  if (state.phase === "waiting") {
    return (
      <ConsoleFrame>
        <HStack gap="2">
          <Badge tone="info">{state.status === "RUNNING" ? "Running" : "Queued"}</Badge>
          <Text fontSize="sm" color="fg.muted" aria-live="polite">
            Waiting for the sandbox…
          </Text>
        </HStack>
      </ConsoleFrame>
    );
  }

  if (state.phase === "failed") {
    return (
      <ConsoleFrame>
        <HStack gap="2">
          <Badge tone="warning">No result</Badge>
          <Text fontSize="sm" color="fg.muted" aria-live="polite">
            {state.message}
          </Text>
        </HStack>
      </ConsoleFrame>
    );
  }

  const summary = describeRun(state.status, state.testResults);

  return (
    <ConsoleFrame>
      <Stack gap="3">
        <HStack gap="2" aria-live="polite">
          <Badge tone={summary.tone}>{summary.label}</Badge>
        </HStack>

        {shouldShowCompilerOutput(state.status, state.compilerOutput) ? (
          <Box
            as="pre"
            textStyle="data"
            fontSize="xs"
            whiteSpace="pre-wrap"
            color="fg.muted"
            maxHeight="12rem"
            overflowY="auto"
          >
            {withoutRuntimeNotice(state.compilerOutput ?? "")}
          </Box>
        ) : null}

        {state.testResults.map((result, index) => (
          <TestResultRow key={`${result.name}-${String(index)}`} result={result} />
        ))}
      </Stack>
    </ConsoleFrame>
  );
}
