"use client";

import { useId, useMemo, useState } from "react";
import NextLink from "next/link";
import { Checkbox, Flex, HStack, InputGroup, Stack, Text } from "@chakra-ui/react";
import { Check, CheckCheck, ChevronLeft, Search, X } from "lucide-react";
import type { EnrollmentDecision, EnrollmentStatus, EnrollmentView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { DataTable, Table } from "@/components/ui/table";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { useDecideEnrollment, useDecideEnrollments, useEnrollments } from "@/hooks/use-enrollments";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useModule } from "@/hooks/use-modules";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import {
  changedBy,
  clearPending,
  markPending,
  pageCheckState,
  pageToRecover,
  selectedRows,
  withSelection,
  type PendingDecisions,
} from "./enrollment-queue";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 5;
const ALL = "ALL";

const STATUS_TABS: readonly TabItem[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Declined" },
  { value: ALL, label: "All" },
];

const STATUS_TONE: Readonly<Record<EnrollmentStatus, BadgeTone>> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const STATUS_LABEL: Readonly<Record<EnrollmentStatus, string>> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Declined",
};

/** What each tab says when it is empty and nobody is searching. */
const EMPTY_COPY: Readonly<Record<string, { title: string; description: string }>> = {
  PENDING: { title: "Nothing waiting", description: "Requests appear here as Coders ask to join." },
  APPROVED: { title: "Nobody approved yet", description: "Approved Coders are listed here." },
  REJECTED: { title: "Nobody declined", description: "Declined requests are listed here." },
  [ALL]: { title: "No requests yet", description: "No Coder has asked to join this module." },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function coders(count: number): string {
  return `${count} Coder${count === 1 ? "" : "s"}`;
}

/**
 * The approval queue for one Module.
 *
 * It opens on Pending because that is the only tab with work in it. A decision
 * is reversible — an Architect who declines by mistake can approve the same row
 * afterwards — so neither the row actions nor a decision on ticked rows needs a
 * confirmation step. Approving the whole queue does: it reaches rows on pages
 * nobody has looked at, and undoing it is one row at a time.
 *
 * Each row waits on its own decision. One shared busy flag used to spin every
 * button in the table while a single request was out, which read as the whole
 * queue being locked.
 */
export function EnrollmentsScreen({ moduleId }: { moduleId: string }) {
  const [tab, setTab] = useState<string>("PENDING");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PendingDecisions>(() => new Map());
  const [confirmingAll, setConfirmingAll] = useState(false);
  const search = useDebouncedValue(searchInput.trim(), 300);
  const panelId = useId();

  // For the title only. Usually already cached by the builder this was opened from.
  const moduleDetail = useModule(moduleId);

  const query = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      status: tab === ALL ? undefined : (tab as EnrollmentStatus),
      search: search || undefined,
    }),
    [page, search, tab],
  );

  const enrollments = useEnrollments(moduleId, query);
  const decide = useDecideEnrollment(moduleId);
  const decideMany = useDecideEnrollments(moduleId);
  const items = useMemo(() => enrollments.data?.items ?? [], [enrollments.data]);
  const total = enrollments.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Deciding the last rows of the last page takes them off the Pending tab; the
  // page steps back rather than leaving an empty table with a queue behind it.
  const recoverTo =
    enrollments.data !== undefined && !enrollments.isPlaceholderData
      ? pageToRecover(page, enrollments.data)
      : null;
  if (recoverTo !== null) setPage(recoverTo);

  const ticked = selectedRows(selected, items);
  const toApprove = changedBy(ticked, "APPROVED");
  const toDecline = changedBy(ticked, "REJECTED");
  const searching = searchInput.trim() !== "";
  // The whole queue, so only where the table is the whole queue: on Pending,
  // unfiltered, where the count on the button is the count that will change.
  const canApproveAll = tab === "PENDING" && !searching && search === "" && total > 0;
  const approvingAll = decideMany.isPending && decideMany.variables.target === "ALL_PENDING";

  /** A new view is a new page of rows; a selection made on the old one does not carry over. */
  function changeView(apply: () => void) {
    apply();
    setPage(1);
    setSelected(new Set());
  }

  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), lastPage));
    setSelected(new Set());
  }

  async function decideOne(enrollment: EnrollmentView, status: EnrollmentDecision) {
    setPending((current) => markPending(current, [enrollment.id], status));
    try {
      await decide.mutateAsync({ enrollmentId: enrollment.id, status });
      toaster.success({
        title:
          status === "APPROVED"
            ? `${enrollment.coder.displayName} can now read this module`
            : `Declined ${enrollment.coder.displayName}`,
      });
    } catch (decideError) {
      toaster.error({
        title: "Could not save the decision",
        description: isApiError(decideError) ? decideError.userMessage : undefined,
      });
    } finally {
      setPending((current) => clearPending(current, [enrollment.id]));
    }
  }

  async function decideTicked(status: EnrollmentDecision) {
    const ids = status === "APPROVED" ? toApprove : toDecline;
    if (ids.length === 0) return;
    setPending((current) => markPending(current, ids, status));
    try {
      const result = await decideMany.mutateAsync({
        target: "SELECTED",
        status,
        enrollmentIds: ids,
      });
      toaster.success({
        title:
          status === "APPROVED"
            ? `Approved ${coders(result.updated)}`
            : `Declined ${coders(result.updated)}`,
      });
      setSelected(new Set());
    } catch (decideError) {
      toaster.error({
        title: "Could not save the decisions",
        description: isApiError(decideError) ? decideError.userMessage : undefined,
      });
    } finally {
      setPending((current) => clearPending(current, ids));
    }
  }

  async function approveAllPending() {
    try {
      const result = await decideMany.mutateAsync({ target: "ALL_PENDING", status: "APPROVED" });
      toaster.success({
        title:
          result.updated === 0
            ? "Nothing was waiting"
            : `Approved ${coders(result.updated)}. They can now read this module.`,
      });
      setSelected(new Set());
      setConfirmingAll(false);
    } catch (decideError) {
      toaster.error({
        title: "Could not approve the queue",
        description: isApiError(decideError) ? decideError.userMessage : undefined,
      });
    }
  }

  const emptyCopy = searching
    ? {
        title: `No Coders match “${searchInput.trim()}”`,
        description:
          tab === ALL
            ? "Check the spelling, or search by username instead."
            : "Check the spelling, or look under another tab.",
      }
    : (EMPTY_COPY[tab] ?? EMPTY_COPY[ALL]!);

  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.manageModules}>
          <ChevronLeft aria-hidden />
          Back to modules
        </NextLink>
      </Button>

      <PageHeader
        title="Enrollments"
        kicker={moduleDetail.data?.title}
        description="Coders who asked to join this module."
      />

      <Stack gap="4">
        <Flex gap="3" direction={{ base: "column", md: "row" }} justify="space-between">
          <TabBar
            items={STATUS_TABS}
            value={tab}
            onValueChange={(value) => changeView(() => setTab(value))}
            controls={panelId}
            aria-label="Enrollment status"
          />
          <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ md: "20rem" }}>
            <Input
              placeholder="Search by name"
              value={searchInput}
              onChange={(event) => {
                const value = event.currentTarget.value;
                changeView(() => setSearchInput(value));
              }}
              aria-label="Search enrollments"
            />
          </InputGroup>
        </Flex>

        <TabPanel id={panelId} value={tab}>
          {enrollments.isError ? (
            <ErrorState error={enrollments.error} onRetry={() => void enrollments.refetch()} />
          ) : !enrollments.isPending && total === 0 ? (
            <EmptyState
              sprite="check"
              title={emptyCopy.title}
              description={emptyCopy.description}
              action={
                searching ? (
                  <Button variant="outline" onClick={() => changeView(() => setSearchInput(""))}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Stack gap="3">
              <Flex justify="space-between" align="center" gap="3" wrap="wrap" minHeight="8">
                {ticked.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    Tick requests to decide on several at once.
                  </Text>
                ) : (
                  <HStack gap="2" wrap="wrap" aria-live="polite">
                    <Text fontSize="sm" fontWeight="medium">
                      {ticked.length} selected
                    </Text>
                    <Button
                      size="sm"
                      disabled={toApprove.length === 0 || decideMany.isPending}
                      loading={toApprove.some((id) => pending.get(id) === "APPROVED")}
                      onClick={() => void decideTicked("APPROVED")}
                    >
                      <Check aria-hidden />
                      Approve {toApprove.length}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={toDecline.length === 0 || decideMany.isPending}
                      loading={toDecline.some((id) => pending.get(id) === "REJECTED")}
                      onClick={() => void decideTicked("REJECTED")}
                    >
                      <X aria-hidden />
                      Decline {toDecline.length}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      Clear selection
                    </Button>
                  </HStack>
                )}

                {canApproveAll ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideMany.isPending}
                    onClick={() => setConfirmingAll(true)}
                  >
                    <CheckCheck aria-hidden />
                    Approve all {total} pending
                  </Button>
                ) : null}
              </Flex>

              <EnrollmentTable
                items={items}
                isPending={enrollments.isPending}
                selected={selected}
                pending={pending}
                approvingAll={approvingAll}
                onSelect={(ids, on) => setSelected((current) => withSelection(current, ids, on))}
                onDecide={(enrollment, status) => void decideOne(enrollment, status)}
              />

              <Flex justify="space-between" align="center" gap="3" wrap="wrap">
                <Text fontSize="sm" color="fg.muted" aria-live="polite">
                  {firstShown}–{lastShown} of {total} · page {page} of {lastPage}
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
            </Stack>
          )}
        </TabPanel>
      </Stack>

      <ConfirmDialog
        open={confirmingAll}
        title={`Approve all ${total} pending?`}
        description={
          <Text>
            Every request still waiting when you confirm is approved, on every page — not only the
            rows you can see. Those Coders can read this module straight away. Anyone can be
            declined again afterwards, one at a time.
          </Text>
        }
        confirmLabel="Approve all"
        loading={approvingAll}
        onConfirm={() => void approveAllPending()}
        onClose={() => setConfirmingAll(false)}
      />
    </PageContainer>
  );
}

function EnrollmentTable({
  items,
  isPending,
  selected,
  pending,
  approvingAll,
  onSelect,
  onDecide,
}: {
  items: EnrollmentView[];
  isPending: boolean;
  selected: ReadonlySet<string>;
  pending: PendingDecisions;
  approvingAll: boolean;
  onSelect: (ids: string[], on: boolean) => void;
  onDecide: (enrollment: EnrollmentView, status: EnrollmentDecision) => void;
}) {
  return (
    <DataTable caption="Enrollment requests">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader width="1%">
            <Checkbox.Root
              size="sm"
              colorPalette="accent"
              checked={pageCheckState(selected, items)}
              disabled={items.length === 0}
              onCheckedChange={(details) =>
                onSelect(
                  items.map((enrollment) => enrollment.id),
                  details.checked === true,
                )
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label srOnly>Select every request on this page</Checkbox.Label>
            </Checkbox.Root>
          </Table.ColumnHeader>
          <Table.ColumnHeader>Coder</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Requested</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Decision</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {isPending ? (
          <TableRowsSkeleton columns={COLUMN_COUNT} />
        ) : (
          items.map((enrollment) => {
            // Approving the whole queue reaches every pending row on screen too.
            const waitingOn =
              pending.get(enrollment.id) ??
              (approvingAll && enrollment.status === "PENDING" ? "APPROVED" : undefined);
            return (
              <Table.Row
                key={enrollment.id}
                bg={selected.has(enrollment.id) ? "accent.subtle" : undefined}
              >
                <Table.Cell>
                  <Checkbox.Root
                    size="sm"
                    colorPalette="accent"
                    checked={selected.has(enrollment.id)}
                    onCheckedChange={(details) =>
                      onSelect([enrollment.id], details.checked === true)
                    }
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label srOnly>Select {enrollment.coder.displayName}</Checkbox.Label>
                  </Checkbox.Root>
                </Table.Cell>
                <Table.Cell>
                  <Stack gap="0.5">
                    <Text fontWeight="medium">{enrollment.coder.displayName}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {enrollment.coder.username}
                    </Text>
                  </Stack>
                </Table.Cell>
                <Table.Cell>
                  <Badge tone={STATUS_TONE[enrollment.status]}>
                    {STATUS_LABEL[enrollment.status]}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm">{formatDate(enrollment.createdAt)}</Text>
                  {enrollment.decidedBy ? (
                    <Text fontSize="xs" color="fg.muted">
                      by {enrollment.decidedBy.displayName}
                    </Text>
                  ) : null}
                </Table.Cell>
                <Table.Cell>
                  <HStack gap="1" justify="end">
                    {enrollment.status === "APPROVED" ? null : (
                      <Button
                        size="xs"
                        loading={waitingOn === "APPROVED"}
                        disabled={waitingOn !== undefined}
                        onClick={() => onDecide(enrollment, "APPROVED")}
                      >
                        <Check aria-hidden />
                        Approve
                      </Button>
                    )}
                    {enrollment.status === "REJECTED" ? null : (
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={waitingOn === "REJECTED"}
                        disabled={waitingOn !== undefined}
                        onClick={() => onDecide(enrollment, "REJECTED")}
                      >
                        <X aria-hidden />
                        Decline
                      </Button>
                    )}
                  </HStack>
                </Table.Cell>
              </Table.Row>
            );
          })
        )}
      </Table.Body>
    </DataTable>
  );
}
