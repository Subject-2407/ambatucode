"use client";

import NextLink from "next/link";
import { Box, Card, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { Check, ChevronLeft, X } from "lucide-react";
import type { SubmissionCoderView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { describeSubmission } from "@/components/assessment/submission-status";
import { describeCaseOutcome } from "@/components/content/run-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * One of the Coder's own submissions, in full.
 *
 * "In full" means everything the server was willing to send. The Coder-facing
 * serializer has already dropped hidden cases and the platform's own error
 * text, so nothing is filtered here — a value that arrives is a value the
 * Coder was always allowed to see. If a hidden case ever appeared in this
 * payload, that would be a server defect to report, not something to hide in
 * the component.
 */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm" fontVariantNumeric="tabular-nums">
        {value}
      </Text>
    </Stack>
  );
}

export function SubmissionDetail({
  submission,
  assessmentTitle,
}: {
  submission: SubmissionCoderView;
  assessmentTitle: string;
}) {
  const summary = describeSubmission(submission.status, submission.score);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.submissions}>
          <ChevronLeft aria-hidden />
          Back to submissions
        </NextLink>
      </Button>

      <PageHeader title={assessmentTitle} description={summary.detail} />

      <Stack gap="4">
        <Card.Root bg="bg.surface" borderColor="border.default">
          <Card.Body>
            <Stack gap="4">
              <HStack gap="2" wrap="wrap">
                <Badge tone={summary.tone}>{summary.label}</Badge>
                {submission.isAutoSubmitted ? (
                  <Badge tone="warning">Auto-submitted at the deadline</Badge>
                ) : null}
              </HStack>

              <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="4">
                <Stat label="Language" value={submission.language} />
                <Stat label="Submitted" value={formatDateTime(submission.submittedAt)} />
                <Stat
                  label="Execution time"
                  value={
                    submission.executionTimeMs === null
                      ? "—"
                      : `${submission.executionTimeMs} ms`
                  }
                />
                <Stat
                  label="Memory"
                  value={
                    submission.memoryUsedKb === null
                      ? "—"
                      : `${Math.round(submission.memoryUsedKb / 1024)} MB`
                  }
                />
              </Grid>
            </Stack>
          </Card.Body>
        </Card.Root>

        {submission.compilerOutput && submission.compilerOutput.trim() !== "" ? (
          <Card.Root bg="bg.surface" borderColor="border.default">
            <Card.Header>
              <Text textStyle="display">Compiler output</Text>
            </Card.Header>
            <Card.Body>
              <Box
                as="pre"
                textStyle="data"
                fontSize="xs"
                whiteSpace="pre-wrap"
                color="fg.muted"
                maxHeight="16rem"
                overflowY="auto"
              >
                {submission.compilerOutput}
              </Box>
            </Card.Body>
          </Card.Root>
        ) : null}

        <Card.Root bg="bg.surface" borderColor="border.default">
          <Card.Header>
            <Stack gap="1">
              <Text textStyle="display">Test results</Text>
              <Text fontSize="xs" color="fg.muted">
                Sample cases and any tests your Architect chose to show. Hidden grading cases stay
                hidden — your score already counts them.
              </Text>
            </Stack>
          </Card.Header>
          <Card.Body>
            {submission.testResults.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No individual results to show for this submission.
              </Text>
            ) : (
              <Stack gap="2">
                {submission.testResults.map((result, index) => {
                  const outcome = describeCaseOutcome(result);
                  return (
                    <Flex
                      key={`${result.name}-${String(index)}`}
                      gap="3"
                      align="center"
                      justify="space-between"
                      paddingY="2"
                      borderTopWidth={index === 0 ? "0" : "1px"}
                      borderColor="border.default"
                      wrap="wrap"
                    >
                      <HStack gap="2" minWidth="0">
                        {/* An icon and a word, never colour alone. */}
                        <Box color={result.passed ? "success.fg" : "danger.fg"}>
                          {result.passed ? (
                            <Check size={16} aria-hidden />
                          ) : (
                            <X size={16} aria-hidden />
                          )}
                        </Box>
                        <Text fontSize="sm" truncate>
                          {result.name}
                        </Text>
                      </HStack>
                      <HStack gap="3">
                        <Badge tone={result.passed ? "success" : "danger"} size="sm">
                          {outcome}
                        </Badge>
                        {result.executionTimeMs === null ? null : (
                          <Text fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
                            {result.executionTimeMs} ms
                          </Text>
                        )}
                      </HStack>
                    </Flex>
                  );
                })}
              </Stack>
            )}
          </Card.Body>
        </Card.Root>

        <Card.Root bg="bg.surface" borderColor="border.default">
          <Card.Header>
            <Text textStyle="display">What you submitted</Text>
          </Card.Header>
          <Card.Body>
            <Box
              as="pre"
              textStyle="data"
              fontSize="xs"
              whiteSpace="pre"
              overflowX="auto"
              maxHeight="28rem"
              overflowY="auto"
            >
              {submission.sourceCode}
            </Box>
          </Card.Body>
        </Card.Root>
      </Stack>
    </PageContainer>
  );
}
