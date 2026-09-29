"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { Box, Flex, HStack, LinkOverlay, Stack, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type { SubmissionHistoryItem } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { describeSubmission } from "@/components/assessment/submission-status";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SelectField } from "@/components/ui/select";
import { DataTable, Table } from "@/components/ui/table";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { useOwnSubmissions } from "@/hooks/use-grades";
import { useModules } from "@/hooks/use-modules";
import { formatDateTime } from "@/lib/format-date";
import { routes } from "@/lib/routes";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 5;
const ALL = "";

/**
 * Everything this Coder has formally submitted.
 *
 * Every row is a submission the platform kept forever, which is the point:
 * after a reset a Coder can see both attempts and which one the Architect made
 * official. The `Official` badge is the whole answer to "so what did I get" —
 * without it a list of scores after a reset is ambiguous.
 */
export function SubmissionsScreen() {
  const [moduleId, setModuleId] = useState(ALL);
  const [page, setPage] = useState(1);

  const modules = useModules({ page: 1, pageSize: 100, scope: "enrolled" });
  const enrolled = modules.data?.items ?? [];

  const query = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      moduleId: moduleId === ALL ? undefined : moduleId,
    }),
    [page, moduleId],
  );

  const { data, isPending, isError, error, refetch } = useOwnSubmissions(query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer backdrop="waveform">
      <PageHeader title="Submissions" />

      <Stack gap="4">
        <Flex gap="3" wrap="wrap">
          <SelectField
            label="Module"
            value={moduleId}
            options={[
              { value: ALL, label: "All modules" },
              ...enrolled.map((module) => ({ value: module.id, label: module.title })),
            ]}
            onChange={(value) => {
              setModuleId(value);
              setPage(1);
            }}
          />
        </Flex>

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !isPending && items.length === 0 ? (
          <EmptyState
            sprite="doc"
            title="Nothing submitted yet"
            description="Your submissions appear here once you finish an assessment."
          />
        ) : (
          <>
            <DataTable caption="Your formal submissions">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Assessment</Table.ColumnHeader>
                  <Table.ColumnHeader>Result</Table.ColumnHeader>
                  <Table.ColumnHeader>Attempt</Table.ColumnHeader>
                  <Table.ColumnHeader>Submitted</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {isPending ? (
                  <TableRowsSkeleton columns={COLUMN_COUNT} />
                ) : (
                  items.map((item) => <SubmissionRow key={item.id} item={item} />)
                )}
              </Table.Body>
            </DataTable>

            <Flex justify="space-between" align="center" gap="3" wrap="wrap">
              <Text fontSize="sm" color="fg.muted" aria-live="polite">
                {total} submission{total === 1 ? "" : "s"}
                {lastPage > 1 ? ` · page ${String(page)} of ${String(lastPage)}` : ""}
              </Text>
              {/* Two dead buttons under a list that fits on one page were
                  controls for nothing. */}
              <HStack gap="2" display={lastPage > 1 ? "flex" : "none"}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= lastPage}
                  onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
                >
                  Next
                </Button>
              </HStack>
            </Flex>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}

/**
 * The whole row is the link. A small "View" at the far edge was the only
 * target on a row whose every cell described the same submission.
 *
 * The overlay rides on the assessment title, so the link's accessible name is
 * the thing a Coder is looking for rather than a column of identical "View"s.
 */
function SubmissionRow({ item }: { item: SubmissionHistoryItem }) {
  const summary = describeSubmission(item.status, item.score);
  return (
    <Table.Row position="relative" cursor="pointer" _hover={{ bg: "bg.subtle" }}>
      <Table.Cell>
        <Stack gap="0.5">
          <LinkOverlay asChild fontWeight="medium">
            <NextLink href={routes.submission(item.id)}>{item.assessmentTitle}</NextLink>
          </LinkOverlay>
          <Text fontSize="xs" color="fg.muted">
            {item.moduleTitle} · {item.sessionName}
          </Text>
        </Stack>
      </Table.Cell>
      <Table.Cell>
        <HStack gap="2" wrap="wrap">
          <Badge tone={summary.tone}>{summary.label}</Badge>
          {item.isAutoSubmitted ? (
            <Badge tone="warning" size="sm">
              Auto-submitted
            </Badge>
          ) : null}
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <HStack gap="2">
          <Text fontSize="sm">#{item.attemptNumber}</Text>
          {item.isOfficial ? (
            <Badge tone="accent" size="sm">
              Official
            </Badge>
          ) : null}
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm">{formatDateTime(item.submittedAt)}</Text>
        <Text fontSize="xs" color="fg.muted">
          {LANGUAGE_LABEL[item.language]}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end" color="fg.muted">
        <Box display="inline-flex" aria-hidden>
          <ChevronRight size={16} />
        </Box>
      </Table.Cell>
    </Table.Row>
  );
}
