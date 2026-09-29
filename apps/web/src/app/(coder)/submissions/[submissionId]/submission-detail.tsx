"use client";

import { Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import type { SubmissionCoderView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { describeSubmission } from "@/components/assessment/submission-status";
import { CodeEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { TestResultRow } from "@/components/editor/run-results";
import { Badge } from "@/components/ui/badge";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { formatDateTime } from "@/lib/format-date";
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

/** Where the submission came from. Labels only; none of it is grading data. */
export type SubmissionContext = {
  assessmentId: string | null;
  assessmentTitle: string;
  moduleSlug: string | null;
  moduleTitle: string | null;
  sessionName: string | null;
  attemptNumber: number | null;
  isOfficial: boolean;
};

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

function SectionTitle({ children }: { children: string }) {
  return (
    <Text textStyle="display" fontSize="sm">
      {children}
    </Text>
  );
}

export function SubmissionDetail({
  submission,
  context,
}: {
  submission: SubmissionCoderView;
  context: SubmissionContext;
}) {
  const summary = describeSubmission(submission.status, submission.score);

  // The trail runs Submissions › Module › Assessment, so the way back to the
  // list and the way to the exam itself are both one click.
  const crumbs: Crumb[] = [{ label: "Submissions", href: routes.submissions }];
  if (context.moduleSlug && context.moduleTitle) {
    crumbs.push({ label: context.moduleTitle, href: routes.module(context.moduleSlug) });
    if (context.assessmentId) {
      crumbs.push({
        label: context.assessmentTitle,
        href: routes.assessment(context.moduleSlug, context.assessmentId),
      });
    }
  }

  const lineCount = submission.sourceCode.split("\n").length;

  return (
    <PageContainer>
      <Breadcrumbs items={crumbs} />

      <PageHeader
        title={context.assessmentTitle}
        description={[
          context.sessionName,
          context.attemptNumber === null ? null : `Attempt ${String(context.attemptNumber)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <Stack gap="4">
        <PixelFrame pad="5">
          <Stack gap="4">
            <Stack gap="2">
              <HStack gap="2" wrap="wrap">
                <Badge tone={summary.tone}>{summary.label}</Badge>
                {/* The one badge that answers "so what did I get" after a
                    reset. The list showed it; the page it links to did not. */}
                {context.isOfficial ? <Badge tone="accent">Official</Badge> : null}
                {submission.isAutoSubmitted ? (
                  <Badge tone="warning">Auto-submitted at the deadline</Badge>
                ) : null}
              </HStack>
              <Text fontSize="sm" color="fg.muted">
                {summary.detail}
              </Text>
            </Stack>

            <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="4">
              <Stat label="Language" value={LANGUAGE_LABEL[submission.language]} />
              <Stat label="Submitted" value={formatDateTime(submission.submittedAt)} />
              <Stat
                label="Execution time"
                value={
                  submission.executionTimeMs === null ? "—" : `${submission.executionTimeMs} ms`
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
        </PixelFrame>

        {submission.compilerOutput && submission.compilerOutput.trim() !== "" ? (
          <PixelFrame pad="5">
            <Stack gap="3">
              <SectionTitle>Compiler output</SectionTitle>
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
            </Stack>
          </PixelFrame>
        ) : null}

        <PixelFrame pad="5">
          <Stack gap="3">
            <Stack gap="1">
              <SectionTitle>Test results</SectionTitle>
              <Text fontSize="xs" color="fg.muted">
                Sample cases and any tests your Architect chose to show. Hidden grading cases stay
                hidden.
              </Text>
            </Stack>
            {submission.testResults.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No individual results to show for this submission.
              </Text>
            ) : (
              <Stack gap="3">
                {submission.testResults.map((result, index) => (
                  <TestResultRow key={`${result.name}-${String(index)}`} result={result} />
                ))}
              </Stack>
            )}
          </Stack>
        </PixelFrame>

        <PixelFrame pad="5">
          <Stack gap="3">
            <SectionTitle>What you submitted</SectionTitle>
            {/* The editor, read-only, rather than a plain block of text: line
                numbers are how a Coder matches a failing case to the line that
                caused it. Sized to the source up to a cap, so a ten-line
                answer does not sit in a mostly empty panel. */}
            <Box borderWidth="1px" borderColor="border.default" overflow="hidden">
              <CodeEditor
                language={submission.language}
                value={submission.sourceCode}
                onChange={() => undefined}
                readOnly
                height={`${String(Math.min(Math.max(lineCount, 12), 32) * 1.4 + 1)}rem`}
                ariaLabel={`Submitted source for ${context.assessmentTitle}`}
              />
            </Box>
          </Stack>
        </PixelFrame>
      </Stack>
    </PageContainer>
  );
}
