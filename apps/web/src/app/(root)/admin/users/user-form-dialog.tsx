"use client";

import { useState } from "react";
import { Checkbox, Stack } from "@chakra-ui/react";
import {
  USER_ROLES,
  createUserRequestSchema,
  updateUserRequestSchema,
  type AdminUser,
  type UserRole,
} from "@ambatucode/shared";
import { isApiError } from "@/lib/api-client";
import { ROLE_LABEL } from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { toaster } from "@/components/ui/toaster";
import { useCreateUser, useUpdateUser } from "@/hooks/use-admin-users";

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }));

type FieldErrors = Partial<Record<"username" | "password" | "displayName", string>>;

type Props = {
  onClose: () => void;
  /** Absent means the dialog is creating rather than editing. */
  user?: AdminUser;
};

/**
 * One dialog for both create and edit. The two differ only in which fields are
 * writable — username and password are set once at creation and changed
 * afterwards through the dedicated password reset, which also terminates the
 * account's live session.
 *
 * The caller mounts this only while it is open, so every field seeds from
 * `user` on mount and a previous edit can never leak into the next one.
 */
export function UserFormDialog({ onClose, user }: Props) {
  const editing = user !== undefined;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "CODER");
  const [isActive, setActive] = useState(user?.isActive ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = createUser.isPending || updateUser.isPending;

  function collectIssues(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
    const next: FieldErrors = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (field === "username" || field === "password" || field === "displayName") {
        next[field] ??= issue.message;
      }
    }
    return next;
  }

  function reportFailure(error: unknown, fallback: string) {
    toaster.error({
      title: fallback,
      description: isApiError(error) ? error.userMessage : undefined,
    });
  }

  async function handleSubmit() {
    if (editing) {
      const parsed = updateUserRequestSchema.safeParse({ displayName, role, isActive });
      if (!parsed.success) {
        setErrors(collectIssues(parsed.error.issues));
        return;
      }
      try {
        await updateUser.mutateAsync({ id: user.id, changes: parsed.data });
        toaster.success({ title: `Updated ${user.username}` });
        onClose();
      } catch (error) {
        reportFailure(error, "Could not update the account");
      }
      return;
    }

    const parsed = createUserRequestSchema.safeParse({
      username,
      password,
      displayName,
      role,
      isActive,
    });
    if (!parsed.success) {
      setErrors(collectIssues(parsed.error.issues));
      return;
    }
    try {
      const created = await createUser.mutateAsync(parsed.data);
      toaster.success({ title: `Created ${created.username}` });
      onClose();
    } catch (error) {
      reportFailure(error, "Could not create the account");
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={editing ? `Edit ${user.username}` : "New user"}
      footer={
        <Stack direction="row" gap="3" justify="flex-end" width="full">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={pending}>
            {editing ? "Save changes" : "Create user"}
          </Button>
        </Stack>
      }
    >
      <Stack gap="4">
        {editing ? null : (
          <>
            <TextField
              label="Username"
              value={username}
              autoComplete="off"
              required
              onChange={(event) => setUsername(event.currentTarget.value)}
              errorText={errors.username}
              helperText="Letters, digits, dot, underscore, hyphen."
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              autoComplete="new-password"
              required
              onChange={(event) => setPassword(event.currentTarget.value)}
              errorText={errors.password}
              helperText="At least 8 characters. The user cannot change it themselves."
            />
          </>
        )}

        <TextField
          label="Display name"
          value={displayName}
          required
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          errorText={errors.displayName}
        />

        <SelectField
          label="Role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(value) => setRole(value as UserRole)}
        />

        <Checkbox.Root
          checked={isActive}
          onCheckedChange={(details) => setActive(details.checked === true)}
          colorPalette="accent"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>
            Active — a deactivated account cannot sign in and loses its live session immediately.
          </Checkbox.Label>
        </Checkbox.Root>
      </Stack>
    </Modal>
  );
}
