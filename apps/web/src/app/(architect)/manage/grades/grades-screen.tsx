"use client";

import { useMemo, useState } from "react";
import { Flex, HStack, InputGroup, Stack, Text } from "@chakra-ui/react";
import { ClipboardList, Search } from "lucide-react";
import {
  SUBMISSION_STATUSES,
  type GradeAttemptView,
  type GradeRecordQuery,
  type GradeRecordView,
  type SubmissionStatus,
} from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ExportGradesButton } from "@/components/grades/export-grades-button";
import { GradeRecordRow } from "@/components/grades/grade-record-row";
import { ResetAttemptDialog } from "@/components/grades/reset-attempt-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { DataTable, Table } from "@/components/ui/table";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useModuleGrades, useResetAttempt, useSetOfficialAttempt } from "@/hooks/use-grades";
import { useModule, useModules } from "@/hooks/use-modules";
import { isApiError } from "@/lib/api-client";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 4;
const ALL = "";

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

type ResetTarget = { record: GradeRecordView; attempt: GradeAttemptView };

/**
 * Grading records for one Module.
 *
 * The screen answers three questions in one place: what did each Coder score,
 * which attempt is that score coming from, and what happened to the attempts
 * that are no longer it. Everything else — the source code, the per-case
 * detail — lives on the submission page, because this is the view an Architect
 * reads across thirty Coders rather than down into one.
 */
export function GradesScreen() {
  const [moduleId, setModuleId] = useState("");
  const [sectionId, setSectionId] = useState(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [resetOnly, setResetOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const search = useDebouncedValue(searchInput.trim(), 300);

  const modules = useModules({ page: 1, pageSize: 100, scope: "owned" });
  const owned = useMemo(() => modules.data?.items ?? [], [modules.data]);
  const selectedModuleId = moduleId || (owned[0]?.id ?? "");

  const moduleDetail = useModule(selectedModuleId);
  const sections = moduleDetail.data?.sections ?? [];

  const query = useMemo<GradeRecordQuery>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      sectionId: sectionId === ALL ? undefined : sectionId,
      status: status === ALL ? undefined : (status as SubmissionStatus),
      resetOnly: resetOnly ? true : undefined,
    }),
    [page, search, sectionId, status, resetOnly],
  );

  const grades = useModuleGrades(selectedModuleId, query, selectedModuleId !== "");
  const reset = useResetAttempt();
  const setOfficial = useSetOfficialAttempt();

  const items = grades.data?.items ?? [];
  const total = grades.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Any filter change puts the reader back on the first page of the new set. */
  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  async function applyReset(reason: string) {
    if (resetTarget === null) return;
    try {
      const result = await reset.mutateAsync({ attemptId: resetTarget.attempt.id, reason });
      toaster.success({
        title: `Attempt ${result.newAttemptNumber} opened for ${resetTarget.record.displayName}`,
        description: "Every earlier submission is still in the history.",
      });
      setResetTarget(null);
    } catch (error) {
      toaster.error({
        title: "Could not reset the attempt",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function chooseOfficial(attemptId: string) {
    try {
      await setOfficial.mutateAsync({ attemptId, isOfficial: true });
      toaster.success({ title: "Official score updated" });
    } catch (error) {
      toaster.error({
        title: "Could not change the official score",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (!modules.isPending && owned.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Grades" description="Grading records for the modules you own." />
        <EmptyState
          icon={<ClipboardList aria-hidden />}
          title="No modules yet"
          description="Grades appear here once you own a module with an assessment in it."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Grades"
        description="Every attempt, and which one counts. Resetting never deletes a submission."
        action={
          <ExportGradesButton
            moduleId={selectedModuleId}
            query={query}
            disabled={selectedModuleId === "" || total === 0}
          />
        }
      />

      <Stack gap="4">
        <Flex gap="3" direction={{ base: "column", lg: "row" }} wrap="wrap">
          <SelectField
            label="Module"
            value={selectedModuleId}
            options={owned.map((module) => ({ value: module.id, label: module.title }))}
            onChange={(value) =>
              changeFilter(() => {
                setModuleId(value);
                setSectionId(ALL);
              })
            }
          />

          <SelectField
            label="Section"
            value={sectionId}
            options={[
              { value: ALL, label: "All sections" },
              ...sections.map((section) => ({ value: section.id, label: section.title })),
            ]}
            onChange={(value) => changeFilter(() => setSectionId(value))}
          />

          <SelectField
            label="Status"
            value={status}
            options={[
              { value: ALL, label: "Any status" },
              ...SUBMISSION_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
            ]}
            onChange={(value) => changeFilter(() => setStatus(value))}
          />

          <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ lg: "16rem" }}>
            <Input
              placeholder="Search by name"
              value={searchInput}
              aria-label="Search grading records"
              onChange={(event) => changeFilter(() => setSearchInput(event.currentTarget.value))}
            />
          </InputGroup>

          <Button
            variant={resetOnly ? "solid" : "outline"}
            onClick={() => changeFilter(() => setResetOnly((previous) => !previous))}
            aria-pressed={resetOnly}
          >
            Reset only
          </Button>
        </Flex>

        {grades.isError ? (
          <ErrorState error={grades.error} onRetry={() => void grades.refetch()} />
        ) : !grades.isPending && items.length === 0 ? (
          <EmptyState
            icon={<ClipboardList aria-hidden />}
            title="No records here"
            description="Nothing matches these filters yet. Records appear once a Coder submits."
          />
        ) : (
          <>
            <DataTable caption="Grading records">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Coder</Table.ColumnHeader>
                  <Table.ColumnHeader>Assessment</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Official</Table.ColumnHeader>
                  <Table.ColumnHeader>Attempts</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {grades.isPending ? (
                  <TableRowsSkeleton columns={COLUMN_COUNT} />
                ) : (
                  items.map((record) => (
                    <GradeRecordRow
                      key={`${record.sessionId}:${record.userId}`}
                      record={record}
                      busy={reset.isPending || setOfficial.isPending}
                      onReset={(attempt) => setResetTarget({ record, attempt })}
                      onSetOfficial={(attemptId) => void chooseOfficial(attemptId)}
                    />
                  ))
                )}
              </Table.Body>
            </DataTable>

            <Flex justify="space-between" align="center" gap="3" wrap="wrap">
              <Text fontSize="sm" color="fg.muted" aria-live="polite">
                {total} record{total === 1 ? "" : "s"} · page {page} of {lastPage}
              </Text>
              <HStack gap="2">
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

      <ResetAttemptDialog
        key={resetTarget?.attempt.id ?? "none"}
        open={resetTarget !== null}
        coderName={resetTarget?.record.displayName ?? ""}
        assessmentTitle={resetTarget?.record.assessmentTitle ?? ""}
        attemptNumber={resetTarget?.attempt.attemptNumber ?? 0}
        loading={reset.isPending}
        onConfirm={(reason) => void applyReset(reason)}
        onClose={() => setResetTarget(null)}
      />
    </PageContainer>
  );
}
