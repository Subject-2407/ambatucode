"use client";

import { useState } from "react";
import { Checkbox, Stack } from "@chakra-ui/react";
import {
  MODULE_VISIBILITIES,
  createModuleRequestSchema,
  updateModuleRequestSchema,
  type ModuleSummary,
  type ModuleVisibility,
} from "@ambatucode/shared";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { toaster } from "@/components/ui/toaster";
import { useCreateModule, useUpdateModule } from "@/hooks/use-modules";

const VISIBILITY_OPTIONS = MODULE_VISIBILITIES.map((visibility) => ({
  value: visibility,
  label: visibility === "PUBLIC" ? "Public" : "Closed (approval required)",
}));

type FieldErrors = Partial<Record<"title" | "slug", string>>;

/** The first message for each field this form can point at. */
function fieldErrorsFrom(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "title" || field === "slug") errors[field] ??= issue.message;
  }
  return errors;
}

/**
 * One dialog for creating and editing a Module.
 *
 * The slug is optional on create and derived from the title, because an
 * Architect naming a module should not have to think about URLs. It becomes
 * editable afterwards, where changing it is a deliberate act with a visible
 * consequence: existing links stop working.
 */
export function ModuleFormDialog({
  module,
  onClose,
}: {
  module?: ModuleSummary;
  onClose: () => void;
}) {
  const editing = module !== undefined;
  const createModule = useCreateModule();
  const updateModule = useUpdateModule();

  const [title, setTitle] = useState(module?.title ?? "");
  const [slug, setSlug] = useState(module?.slug ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [visibility, setVisibility] = useState<ModuleVisibility>(module?.visibility ?? "PUBLIC");
  const [isPublished, setPublished] = useState(module?.isPublished ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = createModule.isPending || updateModule.isPending;

  async function save() {
    setErrors({});
    const trimmedSlug = slug.trim();

    if (!editing) {
      const parsed = createModuleRequestSchema.safeParse({
        title,
        slug: trimmedSlug === "" ? undefined : trimmedSlug,
        description: description.trim() === "" ? null : description,
        visibility,
        isPublished,
      });
      if (!parsed.success) {
        setErrors(fieldErrorsFrom(parsed.error.issues));
        return;
      }

      try {
        await createModule.mutateAsync(parsed.data);
        toaster.success({ title: `Created ${parsed.data.title}` });
        onClose();
      } catch (error) {
        toaster.error({
          title: "Could not create the module",
          description: isApiError(error) ? error.userMessage : undefined,
        });
      }
      return;
    }

    // The same check the server applies, run first so a bad slug is pointed at
    // under its field instead of arriving as a toast about the whole form.
    const parsed = updateModuleRequestSchema.safeParse({
      title,
      slug: trimmedSlug,
      description: description.trim() === "" ? null : description,
      visibility,
      isPublished,
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }

    try {
      await updateModule.mutateAsync({ moduleId: module.id, changes: parsed.data });
      toaster.success({ title: "Module updated" });
      onClose();
    } catch (error) {
      toaster.error({
        title: "Could not save the module",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={editing ? "Edit module" : "New module"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending}>
            {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          errorText={errors.title}
          required
          autoFocus
        />
        <TextField
          label="Slug"
          value={slug}
          onChange={(event) => setSlug(event.currentTarget.value)}
          errorText={errors.slug}
          helperText={
            editing
              ? "Part of the module's address. Changing it breaks existing links."
              : "Optional. Defaults to the title."
          }
          placeholder="python-foundations"
        />
        <TextField
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          helperText="One line shown in the catalog."
        />
        <SelectField
          label="Visibility"
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onChange={(next) => setVisibility(next as ModuleVisibility)}
        />
        <Checkbox.Root
          checked={isPublished}
          onCheckedChange={(details) => setPublished(details.checked === true)}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Published</Checkbox.Label>
        </Checkbox.Root>
      </Stack>
    </Modal>
  );
}
