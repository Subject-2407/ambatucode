"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { Flex, HStack, InputGroup, Stack, Text } from "@chakra-ui/react";
import { Check, ChevronLeft, Search, UserCheck, X } from "lucide-react";
import type { EnrollmentStatus, EnrollmentView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { DataTable, Table } from "@/components/ui/table";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { TabBar, type TabItem } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { useDecideEnrollment, useEnrollments } from "@/hooks/use-enrollments";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

const PAGE_SIZE = 50;
const COLUMN_COUNT = 4;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The approval queue for one Module.
 *
 * It opens on Pending because that is the only tab with work in it. A decision
 * is reversible — an Architect who declines by mistake can approve the same row
 * afterwards — so neither action needs a confirmation step in front of it.
 */
export function EnrollmentsScreen({ moduleId }: { moduleId: string }) {
  const [tab, setTab] = useState<string>("PENDING");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);

  const query = useMemo(
    () => ({
      page: 1,
      pageSize: PAGE_SIZE,
      status: tab === ALL ? undefined : (tab as EnrollmentStatus),
      search: search || undefined,
    }),
    [search, tab],
  );

  const { data, isPending, isError, error, refetch } = useEnrollments(moduleId, query);
  const decide = useDecideEnrollment(moduleId);
  const items = data?.items ?? [];

  async function apply(enrollment: EnrollmentView, status: "APPROVED" | "REJECTED") {
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
    }
  }

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
        description="Coders who asked to join this module. A Public module approves itself; a Closed one waits for you."
      />

      <Stack gap="4">
        <Flex gap="3" direction={{ base: "column", md: "row" }} justify="space-between">
          <TabBar
            items={STATUS_TABS}
            value={tab}
            onValueChange={setTab}
            aria-label="Enrollment status"
          />
          <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ md: "20rem" }}>
            <Input
              placeholder="Search by name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              aria-label="Search enrollments"
            />
          </InputGroup>
        </Flex>

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !isPending && items.length === 0 ? (
          <EmptyState
            icon={<UserCheck aria-hidden />}
            title={tab === "PENDING" ? "Nothing waiting" : "No enrollments here"}
            description={
              tab === "PENDING"
                ? "Requests appear here as Coders ask to join."
                : "Try another tab or a different search."
            }
          />
        ) : (
          <EnrollmentTable
            items={items}
            isPending={isPending}
            busy={decide.isPending}
            onDecide={(enrollment, status) => void apply(enrollment, status)}
          />
        )}
      </Stack>
    </PageContainer>
  );
}

function EnrollmentTable({
  items,
  isPending,
  busy,
  onDecide,
}: {
  items: EnrollmentView[];
  isPending: boolean;
  busy: boolean;
  onDecide: (enrollment: EnrollmentView, status: "APPROVED" | "REJECTED") => void;
}) {
  return (
    <DataTable caption="Enrollment requests">
      <Table.Header>
        <Table.Row>
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
          items.map((enrollment) => (
            <Table.Row key={enrollment.id}>
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
                      loading={busy}
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
                      loading={busy}
                      onClick={() => onDecide(enrollment, "REJECTED")}
                    >
                      <X aria-hidden />
                      Decline
                    </Button>
                  )}
                </HStack>
              </Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </DataTable>
  );
}
