"use client";

import { Stack, Text } from "@chakra-ui/react";
import type { AdminUser } from "@ambatucode/shared";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toaster } from "@/components/ui/toaster";
import { useDeleteUser } from "@/hooks/use-admin-users";

/**
 * Deleting is refused by the server whenever the account owns historical
 * records — Submissions and graded attempts are immutable history. The copy
 * says so up front so a refusal reads as the rule it is, not as a failure.
 */
export function DeleteUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const deleteUser = useDeleteUser();

  async function handleConfirm() {
    try {
      await deleteUser.mutateAsync(user.id);
      toaster.success({ title: `Deleted ${user.username}` });
      onClose();
    } catch (error) {
      toaster.error({
        title: "Could not delete the account",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${user.username}?`}
      footer={
        <Stack direction="row" gap="3" justify="flex-end" width="full">
          <Button variant="ghost" onClick={onClose} disabled={deleteUser.isPending}>
            Cancel
          </Button>
          <Button
            colorPalette="danger"
            onClick={() => void handleConfirm()}
            loading={deleteUser.isPending}
          >
            Delete
          </Button>
        </Stack>
      }
    >
      <Text color="fg.muted" fontSize="sm">
        This cannot be undone. If the account owns Modules, Submissions, or graded attempts the
        deletion is refused — deactivate it instead so the history stays intact.
      </Text>
    </Modal>
  );
}
