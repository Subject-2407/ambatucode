"use client";

import { useState } from "react";
import { Stack } from "@chakra-ui/react";
import { passwordSchema, type AdminUser } from "@ambatucode/shared";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toaster } from "@/components/ui/toaster";
import { useResetUserPassword } from "@/hooks/use-admin-users";

/** Mounted only while open, so the typed password never survives a close. */
export function ResetPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const resetPassword = useResetUserPassword();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid password");
      return;
    }
    try {
      await resetPassword.mutateAsync({ id: user.id, password: parsed.data });
      toaster.success({
        title: `Password reset for ${user.username}`,
        description: "Their active session has ended.",
      });
      onClose();
    } catch (caught) {
      toaster.error({
        title: "Could not reset the password",
        description: isApiError(caught) ? caught.userMessage : undefined,
      });
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Reset password for ${user.username}`}
      description="The account is signed out everywhere as soon as the password changes, so tell the user their new password before you confirm."
      footer={
        <Stack direction="row" gap="3" justify="flex-end" width="full">
          <Button variant="ghost" onClick={onClose} disabled={resetPassword.isPending}>
            Cancel
          </Button>
          <Button
            colorPalette="danger"
            onClick={() => void handleSubmit()}
            loading={resetPassword.isPending}
          >
            Reset password
          </Button>
        </Stack>
      }
    >
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.currentTarget.value);
          setError(undefined);
        }}
        errorText={error}
      />
    </Modal>
  );
}
