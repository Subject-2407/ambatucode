"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Flex, Grid, HStack, InputGroup, Stack, Text, chakra } from "@chakra-ui/react";
import { Search, X } from "lucide-react";
import {
  SUBMISSION_STATUSES,
  type GradeAttemptView,
  type GradeRecordView,
  type GradeSort,
  type SubmissionStatus,
} from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ExportGradesButton } from "@/components/grades/export-grades-button";
import {
  assessmentChoices,
  clearGradeFilters,
  gradeFiltersToSearch,
  hasActiveGradeFilters,
  lastPageFor,
  nextGradeSort,
  pageToRecover,
  reconcileGradeFilters,
  rowNumber,
  sessionChoices,
  toGradeQuery,
  type GradeFilters,
} from "@/components/grades/grade-filters";
import { GradeRecordRow } from "@/components/grades/grade-record-row";
import { GradeSummaryStrip } from "@/components/grades/grade-summary-strip";
import { ResetAttemptDialog } from "@/components/grades/reset-attempt-dialog";
import { SortableColumnHeader } from "@/components/grades/sortable-column-header";
import { CodePeekDialog } from "@/components/monitor/code-peek";
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
import { useModuleSessions } from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 5;

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
type CodeTarget = { attemptId: string; displayName: string };

function sameRecord(left: GradeRecordView, right: GradeRecordView): boolean {
  return left.sessionId === right.sessionId && left.userId === right.userId;
}

/**
 * Grading records for one Module.
 *
 * The screen answers three questions in one place: what did each Coder score,
 * which attempt is that score coming from, and what happened to the attempts
 * that are no longer it. Everything else — the source code, the per-case
 * detail — lives on the submission page, because this is the view an Architect
 * reads across thirty Coders rather than down into one.
 *
 * The filters cascade from the Module down to one Session, each list narrowed
 * by the choice above it — see `grade-filters.ts` — and live in the URL, so a
 * filtered view can be linked and survives a reload.
 */
export function GradesScreen({ initialFilters }: { initialFilters: GradeFilters }) {
  const [filters, setFilters] = useState(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
  const search = useDebouncedValue(searchInput.trim(), 300);

  const modules = useModules({ page: 1, pageSize: 100, scope: "owned" });
  const owned = useMemo(() => modules.data?.items ?? [], [modules.data]);
  // A module named by a link is honoured only when it is one of the reader's
  // own. Anything else falls back to the first, rather than to a refusal.
  const selectedModuleId = owned.some((module) => module.id === filters.moduleId)
    ? filters.moduleId
    : (owned[0]?.id ?? "");

  const moduleDetail = useModule(selectedModuleId);
  const moduleSessions = useModuleSessions(selectedModuleId);
  // Null while loading, which the cascade reads as "cannot check yet" rather
  // than as "holds nothing" — a link's filters survive the first render.
  const sections = moduleDetail.data?.sections ?? null;
  const sessions = moduleSessions.data ?? null;

  const effective = useMemo(
    () =>
      reconcileGradeFilters({ ...filters, moduleId: selectedModuleId, search }, sections, sessions),
    [filters, selectedModuleId, search, sections, sessions],
  );
  const query = useMemo(() => toGradeQuery(effective, PAGE_SIZE), [effective]);
  const page = effective.page;

  const grades = useModuleGrades(selectedModuleId, query, selectedModuleId !== "");
  const reset = useResetAttempt();
  const setOfficial = useSetOfficialAttempt();

  const items = grades.data?.items ?? [];
  const total = grades.data?.total ?? 0;
  const lastPage = lastPageFor(total, PAGE_SIZE);

  // A page past the end — a stale link, or a set that shrank under the reader —
  // moves to the last page that has records instead of showing an empty table.
  // Adjusted during render, as React documents for state that follows what was
  // just learned. It cannot repeat: the page only ever moves down, and the
  // query it starts is a placeholder until it lands.
  const recoverTo =
    grades.data !== undefined && !grades.isPlaceholderData
      ? pageToRecover(page, grades.data)
      : null;
  if (recoverTo !== null) {
    setFilters((previous) => ({ ...previous, page: recoverTo }));
  }

  const urlSearch = gradeFiltersToSearch(effective);
  useEffect(() => {
    // Not before the module is known: writing the URL then would drop the
    // module a link named before the list that confirms it had arrived.
    if (selectedModuleId === "") return;
    const { pathname, search: current } = window.location;
    const next = urlSearch === "" ? pathname : `${pathname}?${urlSearch}`;
    if (next !== `${pathname}${current}`) {
      // The native call rather than the router: Next keeps its own view of the
      // URL in step with it, where a router navigation would render the page
      // on the server again for every keystroke in the search box.
      window.history.replaceState(null, "", next);
    }
  }, [selectedModuleId, urlSearch]);

  const filtersActive = hasActiveGradeFilters({ ...effective, search: searchInput.trim() });
  const officialPendingFor = setOfficial.isPending ? setOfficial.variables.attemptId : null;

  /** Any filter change goes back to page one, and drops whatever stopped fitting. */
  function update(patch: Partial<GradeFilters>) {
    setFilters((previous) =>
      reconcileGradeFilters({ ...previous, ...patch, page: 1 }, sections, sessions),
    );
  }

  function clearFilters() {
    setSearchInput("");
    setFilters((previous) => clearGradeFilters(previous));
  }

  function sortBy(column: GradeSort) {
    setFilters((previous) => ({ ...previous, ...nextGradeSort(previous, column), page: 1 }));
  }

  function goToPage(next: number) {
    setFilters((previous) => ({ ...previous, page: Math.min(Math.max(1, next), lastPage) }));
  }

  async function applyReset(reason: string) {
    if (resetTarget === null) return;
    try {
      const result = await reset.mutateAsync({ attemptId: resetTarget.attempt.id, reason });
      toaster.success({
        title: `Attempt ${result.newAttemptNumber} opened for ${resetTarget.record.displayName}`,
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
          sprite="clipboard"
          title="No modules yet"
          description="Grades appear here once you own a module with an assessment in it."
        />
      </PageContainer>
    );
  }

  const sortProps = { sort: effective.sort, order: effective.order, onSort: sortBy };
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE);

  return (
    <PageContainer>
      <PageHeader
        title="Grades"
        description="Every attempt, and which one counts."
        action={
          <ExportGradesButton
            moduleId={selectedModuleId}
            query={query}
            disabled={selectedModuleId === "" || total === 0}
          />
        }
      />

      <Stack gap="4">
        <Stack gap="3">
          {/* Left to right is the cascade: each list holds only what fits the
              choice before it. */}
          <Grid
            templateColumns={{
              base: "minmax(0, 1fr)",
              md: "repeat(2, minmax(0, 1fr))",
              xl: "repeat(4, minmax(0, 1fr))",
            }}
            gap="3"
          >
            <SelectField
              label="Module"
              value={selectedModuleId}
              options={owned.map((module) => ({ value: module.id, label: module.title }))}
              // Section, assessment, and session all belong to one module, so
              // keeping any of them would filter the new module down to nothing.
              onChange={(value) =>
                update({ moduleId: value, sectionId: "", assessmentId: "", sessionId: "" })
              }
            />

            <SelectField
              label="Section"
              value={effective.sectionId}
              options={[
                { value: "", label: "All sections" },
                ...(sections ?? []).map((section) => ({ value: section.id, label: section.title })),
              ]}
              onChange={(value) => update({ sectionId: value })}
            />

            <SelectField
              label="Assessment"
              value={effective.assessmentId}
              options={assessmentChoices(sections, effective.sectionId)}
              onChange={(value) => update({ assessmentId: value })}
            />

            <SelectField
              label="Session"
              value={effective.sessionId}
              options={sessionChoices(sessions, sections, effective)}
              onChange={(value) => update({ sessionId: value })}
            />
          </Grid>

          <Flex
            gap="3"
            direction={{ base: "column", md: "row" }}
            align={{ base: "stretch", md: "flex-end" }}
            wrap="wrap"
          >
            {/* Named for what it filters on: the official attempt's submission,
                not whichever attempt happened to error. */}
            <Box width={{ base: "full", md: "14rem" }}>
              <SelectField
                label="Official status"
                value={effective.status}
                options={[
                  { value: "", label: "Any status" },
                  ...SUBMISSION_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
                ]}
                onChange={(value) => update({ status: value as SubmissionStatus | "" })}
              />
            </Box>

            <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ md: "18rem" }}>
              <Input
                placeholder="Search by name"
                value={searchInput}
                aria-label="Search grading records"
                onChange={(event) => {
                  setSearchInput(event.currentTarget.value);
                  setFilters((previous) => ({ ...previous, page: 1 }));
                }}
              />
            </InputGroup>

            <Button
              variant={effective.resetOnly ? "solid" : "outline"}
              onClick={() => update({ resetOnly: !effective.resetOnly })}
              aria-pressed={effective.resetOnly}
            >
              Reset only
            </Button>

            {filtersActive ? (
              <Button variant="ghost" onClick={clearFilters}>
                <X aria-hidden />
                Clear filters
              </Button>
            ) : null}
          </Flex>
        </Stack>

        {grades.isError ? (
          <ErrorState error={grades.error} onRetry={() => void grades.refetch()} />
        ) : !grades.isPending && total === 0 ? (
          filtersActive ? (
            <EmptyState
              sprite="clipboard"
              title="No records match"
              description="Nothing in this module fits every filter at once. Loosen one, or clear them all."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              sprite="clipboard"
              title="No attempts yet"
              description="A Coder's record appears here as soon as they start one of this module's assessments."
            />
          )
        ) : (
          <>
            {grades.data === undefined ? null : <GradeSummaryStrip summary={grades.data.summary} />}

            <DataTable caption="Grading records">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader textAlign="end" width="1%">
                    <chakra.span aria-hidden>#</chakra.span>
                    <chakra.span srOnly>Row</chakra.span>
                  </Table.ColumnHeader>
                  <SortableColumnHeader column="name" label="Coder" {...sortProps} />
                  <SortableColumnHeader
                    column="assessment"
                    label="Assessment"
                    hint="in module order"
                    {...sortProps}
                  />
                  <SortableColumnHeader
                    column="score"
                    label="Official"
                    textAlign="end"
                    {...sortProps}
                  />
                  <SortableColumnHeader
                    column="submittedAt"
                    label="Attempts"
                    hint="by latest submission"
                    {...sortProps}
                  />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {/* An empty page with records behind it is one about to move
                    back to the last page; it reads as loading, not as empty. */}
                {grades.isPending || items.length === 0 ? (
                  <TableRowsSkeleton columns={COLUMN_COUNT} />
                ) : (
                  items.map((record, index) => (
                    <GradeRecordRow
                      key={`${record.sessionId}:${record.userId}`}
                      record={record}
                      number={rowNumber(page, PAGE_SIZE, index)}
                      // Only the record being changed waits; the other
                      // twenty-four stay usable.
                      busy={
                        (officialPendingFor !== null &&
                          record.attempts.some((attempt) => attempt.id === officialPendingFor)) ||
                        (reset.isPending &&
                          resetTarget !== null &&
                          sameRecord(resetTarget.record, record))
                      }
                      onReset={(attempt) => setResetTarget({ record, attempt })}
                      onSetOfficial={(attemptId) => void chooseOfficial(attemptId)}
                      onViewCode={(attempt) =>
                        setCodeTarget({
                          attemptId: attempt.id,
                          displayName: record.displayName,
                        })
                      }
                    />
                  ))
                )}
              </Table.Body>
            </DataTable>

            <Flex justify="space-between" align="center" gap="3" wrap="wrap">
              <Text fontSize="sm" color="fg.muted" aria-live="polite">
                {firstShown}–{lastShown} of {total} record{total === 1 ? "" : "s"} · page {page} of{" "}
                {lastPage}
              </Text>
              <HStack gap="2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= lastPage}
                  onClick={() => goToPage(page + 1)}
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

      {/* The same panel the monitor uses, so the submitted source reads the
          same way whether it is watched live or read back afterwards. */}
      {codeTarget === null ? null : (
        <CodePeekDialog
          attemptId={codeTarget.attemptId}
          displayName={codeTarget.displayName}
          live={false}
          onClose={() => setCodeTarget(null)}
        />
      )}
    </PageContainer>
  );
}
