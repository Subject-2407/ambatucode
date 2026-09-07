"use client";

import { useMemo, useState } from "react";
import { Flex, HStack, InputGroup, Menu, Portal, Stack, Text } from "@chakra-ui/react";
import { Ellipsis, KeyRound, Pencil, Search, Trash, UserPlus, Users } from "lucide-react";
import { USER_ROLES, type AdminUser, type UserRole } from "@ambatucode/shared";
import { ROLE_LABEL } from "@/components/layout/navigation";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { DataTable, Table as ChakraTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { TabBar, type TabItem } from "@/components/ui/tabs";
import { TableRowsSkeleton } from "@/components/ui/skeleton";
import { useAdminUsers } from "@/hooks/use-admin-users";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DeleteUserDialog } from "./delete-user-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserFormDialog } from "./user-form-dialog";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 5;
const ALL_ROLES = "ALL";

const ROLE_TABS: readonly TabItem[] = [
  { value: ALL_ROLES, label: "All" },
  ...USER_ROLES.map((role) => ({ value: role, label: `${ROLE_LABEL[role]}s` })),
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Account administration for Root. Root manages who exists and what they may
 * be; nothing here shows grading, submissions, or leaderboards, and the API
 * would refuse to return those anyway.
 */
export function UsersScreen({ currentUserId }: { currentUserId: string }) {
  const [roleTab, setRoleTab] = useState<string>(ALL_ROLES);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const search = useDebouncedValue(searchInput.trim(), 300);
  const role = roleTab === ALL_ROLES ? undefined : (roleTab as UserRole);

  const query = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, role, search: search || undefined }),
    [page, role, search],
  );
  const { data, isPending, isError, error, refetch } = useAdminUsers(query);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, total);
  const hasNextPage = page * PAGE_SIZE < total;

  function changeFilter(next: () => void) {
    next();
    setPage(1);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Global accounts. Creating, deactivating, or resetting an account applies system-wide."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus aria-hidden />
            New user
          </Button>
        }
      />

      <Stack gap="4">
        <Flex
          gap="3"
          direction={{ base: "column", md: "row" }}
          align={{ md: "center" }}
          justify="space-between"
        >
          <TabBar
            items={ROLE_TABS}
            value={roleTab}
            onValueChange={(value) => {
              changeFilter(() => setRoleTab(value));
            }}
            aria-label="Filter by role"
          />
          <InputGroup maxWidth={{ md: "xs" }} startElement={<Search size={16} aria-hidden />}>
            <Input
              placeholder="Search name or username"
              value={searchInput}
              onChange={(event) => {
                const next = event.currentTarget.value;
                changeFilter(() => setSearchInput(next));
              }}
              aria-label="Search users"
            />
          </InputGroup>
        </Flex>

        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} title="Could not load users" />
        ) : (
          <>
            <DataTable caption="Global user accounts">
              <ChakraTable.Header>
                <ChakraTable.Row>
                  <ChakraTable.ColumnHeader>Name</ChakraTable.ColumnHeader>
                  <ChakraTable.ColumnHeader>Role</ChakraTable.ColumnHeader>
                  <ChakraTable.ColumnHeader>Status</ChakraTable.ColumnHeader>
                  <ChakraTable.ColumnHeader>Created</ChakraTable.ColumnHeader>
                  <ChakraTable.ColumnHeader textAlign="end">Actions</ChakraTable.ColumnHeader>
                </ChakraTable.Row>
              </ChakraTable.Header>
              <ChakraTable.Body>
                {isPending ? (
                  <TableRowsSkeleton rows={6} columns={COLUMN_COUNT} />
                ) : items.length === 0 ? (
                  <ChakraTable.Row>
                    <ChakraTable.Cell colSpan={COLUMN_COUNT} border="none">
                      <EmptyState
                        icon={<Users size={28} aria-hidden />}
                        title="No accounts match"
                        description={
                          search || role
                            ? "Try a different search term or role filter."
                            : "Create the first account to get started."
                        }
                      />
                    </ChakraTable.Cell>
                  </ChakraTable.Row>
                ) : (
                  items.map((user) => (
                    <ChakraTable.Row key={user.id}>
                      <ChakraTable.Cell>
                        <Stack gap="0">
                          <Text fontWeight="medium">{user.displayName}</Text>
                          <Text fontSize="xs" color="fg.muted">
                            {user.username}
                          </Text>
                        </Stack>
                      </ChakraTable.Cell>
                      <ChakraTable.Cell>
                        <Badge tone={user.role === "ROOT" ? "accent" : "neutral"}>
                          {ROLE_LABEL[user.role]}
                        </Badge>
                      </ChakraTable.Cell>
                      <ChakraTable.Cell>
                        <Badge tone={user.isActive ? "success" : "danger"}>
                          {user.isActive ? "Active" : "Deactivated"}
                        </Badge>
                      </ChakraTable.Cell>
                      <ChakraTable.Cell color="fg.muted">
                        {formatDate(user.createdAt)}
                      </ChakraTable.Cell>
                      <ChakraTable.Cell textAlign="end">
                        <RowActions
                          user={user}
                          isSelf={user.id === currentUserId}
                          onEdit={() => setEditing(user)}
                          onResetPassword={() => setResetting(user)}
                          onDelete={() => setDeleting(user)}
                        />
                      </ChakraTable.Cell>
                    </ChakraTable.Row>
                  ))
                )}
              </ChakraTable.Body>
            </DataTable>

            <HStack justify="space-between">
              <Text fontSize="sm" color="fg.muted">
                {total === 0
                  ? "No accounts"
                  : `${String(firstOnPage)}-${String(lastOnPage)} of ${String(total)}`}
              </Text>
              <HStack gap="2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 1 || isPending}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasNextPage || isPending}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </HStack>
            </HStack>
          </>
        )}
      </Stack>

      {createOpen ? <UserFormDialog onClose={() => setCreateOpen(false)} /> : null}
      {editing ? <UserFormDialog user={editing} onClose={() => setEditing(null)} /> : null}
      {resetting ? (
        <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      ) : null}
      {deleting ? <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} /> : null}
    </PageContainer>
  );
}

function RowActions({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onDelete,
}: {
  user: AdminUser;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton size="sm" aria-label={`Actions for ${user.username}`}>
          <Ellipsis aria-hidden />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content bg="bg.surface" boxShadow="overlay" minWidth="48">
            <Menu.Item value="edit" onSelect={onEdit}>
              <HStack gap="2">
                <Pencil size={16} aria-hidden />
                <Text>Edit</Text>
              </HStack>
            </Menu.Item>
            <Menu.Item value="reset-password" onSelect={onResetPassword}>
              <HStack gap="2">
                <KeyRound size={16} aria-hidden />
                <Text>Reset password</Text>
              </HStack>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              value="delete"
              onSelect={onDelete}
              disabled={isSelf}
              color="fg.error"
              _hover={{ bg: "danger.subtle" }}
            >
              <HStack gap="2">
                <Trash size={16} aria-hidden />
                <Text>{isSelf ? "Delete (not your own account)" : "Delete"}</Text>
              </HStack>
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
