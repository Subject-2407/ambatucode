"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { Flex, HStack, InputGroup, Stack, Text } from "@chakra-ui/react";
import { LayoutList, Plus, Search, Trash, UserCheck } from "lucide-react";
import type { ModuleSummary } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { DataTable, Table } from "@/components/ui/table";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDeleteModule, useModules } from "@/hooks/use-modules";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { ModuleFormDialog } from "./module-form-dialog";

const PAGE_SIZE = 50;
const COLUMN_COUNT = 4;

/** The modules an Architect owns. Someone else's module never appears here. */
export function ArchitectModulesScreen() {
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ModuleSummary | null>(null);
  const [deleting, setDeleting] = useState<ModuleSummary | null>(null);
  const search = useDebouncedValue(searchInput.trim(), 300);

  const query = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, scope: "owned" as const, search: search || undefined }),
    [page, search],
  );
  const { data, isPending, isError, error, refetch } = useModules(query);
  const deleteModule = useDeleteModule();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Deleting the only module on the last page leaves that page empty, and an
  // empty page with modules still on the one before reads as "no modules".
  if (data && page > lastPage) setPage(lastPage);

  async function remove(module: ModuleSummary) {
    try {
      await deleteModule.mutateAsync(module.id);
      toaster.success({ title: `Deleted ${module.title}` });
    } catch (deleteError) {
      toaster.error({
        title: "Could not delete the module",
        description: isApiError(deleteError) ? deleteError.userMessage : undefined,
      });
    } finally {
      // Closed once the server has answered, so the dialog's loading state is
      // what the Architect watches rather than a row that lingers unexplained.
      setDeleting(null);
    }
  }

  return (
    <PageContainer backdrop="grid">
      <PageHeader
        title="Modules"
        description="Modules you own."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New module
          </Button>
        }
      />

      <Stack gap="4">
        <InputGroup startElement={<Search size={16} aria-hidden />} maxWidth={{ md: "22rem" }}>
          <Input
            placeholder="Search your modules"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.currentTarget.value);
              // A new search starts from its first page, not wherever the old one was.
              setPage(1);
            }}
            aria-label="Search your modules"
          />
        </InputGroup>

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !isPending && items.length === 0 ? (
          <EmptyState
            sprite="books"
            title={search ? "No modules match that search" : "No modules yet"}
            description={
              search
                ? "Try a different word."
                : "Create a module, then add sections, materials, and practice activities inside it."
            }
            action={
              search ? undefined : (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  New module
                </Button>
              )
            }
          />
        ) : (
          <>
            <DataTable caption="Modules you own">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Module</Table.ColumnHeader>
                  <Table.ColumnHeader>Visibility</Table.ColumnHeader>
                  <Table.ColumnHeader>Sections</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {isPending ? (
                  <TableRowsSkeleton columns={COLUMN_COUNT} />
                ) : (
                  items.map((module) => (
                    <Table.Row key={module.id}>
                      <Table.Cell>
                        <Stack gap="0.5">
                          <HStack gap="2">
                            <Text textStyle="display">{module.title}</Text>
                            <Badge tone={module.isPublished ? "success" : "neutral"}>
                              {module.isPublished ? "Published" : "Draft"}
                            </Badge>
                          </HStack>
                          <Text fontSize="xs" color="fg.muted">
                            /{module.slug}
                          </Text>
                        </Stack>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge tone={module.visibility === "CLOSED" ? "warning" : "neutral"}>
                          {module.visibility === "CLOSED" ? "Closed" : "Public"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{module.sectionCount}</Table.Cell>
                      <Table.Cell>
                        <Flex gap="1" justify="end">
                          <Button asChild size="xs" variant="outline">
                            <NextLink href={routes.moduleBuilder(module.id)}>
                              <LayoutList aria-hidden />
                              Builder
                            </NextLink>
                          </Button>
                          <Button asChild size="xs" variant="ghost">
                            <NextLink href={routes.moduleEnrollments(module.id)}>
                              <UserCheck aria-hidden />
                              Enrollments
                            </NextLink>
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditing(module)}>
                            Edit
                          </Button>
                          <IconButton
                            aria-label={`Delete ${module.title}`}
                            size="xs"
                            onClick={() => setDeleting(module)}
                          >
                            <Trash size={14} aria-hidden />
                          </IconButton>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </DataTable>

            <Flex justify="space-between" align="center" gap="3" wrap="wrap">
              <Text fontSize="sm" color="fg.muted" aria-live="polite">
                {total} {total === 1 ? "module" : "modules"}
                {lastPage > 1 ? ` · page ${String(page)} of ${String(lastPage)}` : ""}
              </Text>
              {/* Paging controls under a list that fits on one page would be
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

      {creating ? <ModuleFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <ModuleFormDialog module={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete module"
        description={`"${deleting?.title ?? ""}" and its sections and materials will be removed. A module with graded history cannot be deleted.`}
        confirmLabel="Delete"
        destructive
        loading={deleteModule.isPending}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageContainer>
  );
}
