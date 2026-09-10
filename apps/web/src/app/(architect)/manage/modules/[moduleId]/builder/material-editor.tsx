"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Checkbox, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { Pencil, Plus, Save, Terminal, Trash } from "lucide-react";
import type { MaterialDetail, PracticeActivityView, RichTextDocument } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { TextField } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useMaterial, useUpdateMaterial } from "@/hooks/use-materials";
import { useDeletePractice } from "@/hooks/use-practice";
import { isApiError } from "@/lib/api-client";
import { PracticeFormDialog } from "./practice-form-dialog";

/**
 * TipTap and its ProseMirror core are heavy and only an Architect ever loads
 * them, so the editor is split out of the page bundle and fetched when this
 * pane first renders.
 */
const RichTextEditor = dynamic(
  () => import("@/components/content/rich-text-editor").then((module) => module.RichTextEditor),
  { ssr: false, loading: () => <Skeleton height="20rem" borderRadius="md" /> },
);

/**
 * The third pane: one Material, its content, and the Practice Activities
 * embedded in it.
 *
 * Loading is separated from editing so the form can seed its fields once, at
 * mount, from the Material it is keyed to. Switching materials remounts it,
 * which is both simpler and safer than copying props into state on every
 * change — a background refetch can never overwrite what the Architect is
 * halfway through typing.
 */
export function MaterialEditor({
  moduleId,
  materialId,
}: {
  moduleId: string;
  materialId: string | null;
}) {
  const { data, isPending, isError, error, refetch } = useMaterial(materialId);

  if (materialId === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Select a material to edit it, or add one to the section.
      </Text>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isPending || !data) return <Skeleton height="24rem" borderRadius="md" />;

  return <MaterialForm key={data.id} moduleId={moduleId} material={data} />;
}

function MaterialForm({ moduleId, material }: { moduleId: string; material: MaterialDetail }) {
  const updateMaterial = useUpdateMaterial(moduleId);
  const deletePractice = useDeletePractice(moduleId, material.id);

  const [title, setTitle] = useState(material.title);
  const [content, setContent] = useState<RichTextDocument>(material.content);
  const [isPublished, setPublished] = useState(material.isPublished);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [editingPractice, setEditingPractice] = useState<PracticeActivityView | null>(null);
  const [creatingPractice, setCreatingPractice] = useState(false);
  const [deletingPractice, setDeletingPractice] = useState<PracticeActivityView | null>(null);

  /**
   * Saving is explicit. Autosave belongs to an attempt, where losing work costs
   * a Coder their exam; here an Architect editing a published Material should
   * decide when readers see the change.
   */
  async function save() {
    try {
      await updateMaterial.mutateAsync({
        materialId: material.id,
        changes: { title, content, isPublished },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (saveError) {
      toaster.error({
        title: "Could not save the material",
        description: isApiError(saveError) ? saveError.userMessage : undefined,
      });
    }
  }

  async function removePractice(activity: PracticeActivityView) {
    setDeletingPractice(null);
    try {
      await deletePractice.mutateAsync(activity.id);
      toaster.success({ title: `Deleted ${activity.title}` });
    } catch (deleteError) {
      toaster.error({
        title: "Could not delete the practice activity",
        description: isApiError(deleteError) ? deleteError.userMessage : undefined,
      });
    }
  }

  return (
    <Stack gap="5">
      <Flex gap="3" align="end" wrap="wrap">
        <Stack flex="1" minWidth="16rem">
          <TextField
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Stack>
        <Checkbox.Root
          checked={isPublished}
          onCheckedChange={(details) => setPublished(details.checked === true)}
          mb="2"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Published</Checkbox.Label>
        </Checkbox.Root>
        <Button onClick={() => void save()} loading={updateMaterial.isPending} mb="1">
          <Save aria-hidden />
          Save
        </Button>
      </Flex>

      {savedAt ? (
        <Text fontSize="xs" color="fg.muted" aria-live="polite">
          Saved {savedAt}
        </Text>
      ) : null}

      <RichTextEditor value={content} onChange={setContent} />

      <Stack gap="3">
        <Flex justify="space-between" align="center">
          <HStack gap="2">
            <Terminal size={16} aria-hidden />
            <Text fontWeight="semibold" fontSize="sm">
              Practice activities
            </Text>
          </HStack>
          <Button size="xs" variant="ghost" onClick={() => setCreatingPractice(true)}>
            <Plus aria-hidden />
            Add practice
          </Button>
        </Flex>

        {material.practiceActivities.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            None yet. A practice activity lets the Coder try what this material just explained.
          </Text>
        ) : (
          <Stack gap="2">
            {material.practiceActivities.map((activity) => (
              <Flex
                key={activity.id}
                align="center"
                gap="2"
                borderWidth="1px"
                borderColor="border.default"
                borderRadius="md"
                padding="3"
              >
                <Stack gap="1" flex="1" minWidth="0">
                  <Text fontSize="sm" truncate>
                    {activity.title}
                  </Text>
                  <HStack gap="2">
                    <Badge tone="accent">
                      {activity.testCases.length}{" "}
                      {activity.testCases.length === 1 ? "case" : "cases"}
                    </Badge>
                    <Text fontSize="xs" color="fg.muted">
                      {activity.allowedLanguages.join(", ")}
                    </Text>
                  </HStack>
                </Stack>
                <IconButton
                  aria-label={`Edit ${activity.title}`}
                  size="xs"
                  onClick={() => setEditingPractice(activity)}
                >
                  <Pencil size={14} aria-hidden />
                </IconButton>
                <IconButton
                  aria-label={`Delete ${activity.title}`}
                  size="xs"
                  onClick={() => setDeletingPractice(activity)}
                >
                  <Trash size={14} aria-hidden />
                </IconButton>
              </Flex>
            ))}
          </Stack>
        )}
      </Stack>

      {creatingPractice ? (
        <PracticeFormDialog
          moduleId={moduleId}
          materialId={material.id}
          onClose={() => setCreatingPractice(false)}
        />
      ) : null}
      {editingPractice ? (
        <PracticeFormDialog
          moduleId={moduleId}
          materialId={material.id}
          activity={editingPractice}
          onClose={() => setEditingPractice(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deletingPractice !== null}
        title="Delete practice activity"
        description={`"${deletingPractice?.title ?? ""}" will be removed from this material.`}
        confirmLabel="Delete"
        destructive
        loading={deletePractice.isPending}
        onConfirm={() => {
          if (deletingPractice) void removePractice(deletingPractice);
        }}
        onClose={() => setDeletingPractice(null)}
      />
    </Stack>
  );
}
