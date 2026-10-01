"use client";

import { useEffect, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Box, Checkbox, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { FileCode, Pencil, Plus, Save, Terminal, Trash } from "lucide-react";
import {
  materialTitleSchema,
  type MaterialDetail,
  type PracticeActivityView,
  type RichTextDocument,
} from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { TextField } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { useMaterial, useUpdateMaterial } from "@/hooks/use-materials";
import { useDeletePractice } from "@/hooks/use-practice";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { isApiError } from "@/lib/api-client";
import { hiddenFromCoders, materialIsDirty, type MaterialDraft } from "./material-draft";
import { MaterialPreview } from "./material-preview";
import { PracticeFormDialog } from "./practice-form-dialog";
import { PracticeTestScriptsDialog } from "./practice-test-scripts-dialog";

/**
 * TipTap and its ProseMirror core are heavy and only an Architect ever loads
 * them, so the editor is split out of the page bundle and fetched when this
 * pane first renders.
 */
const RichTextEditor = dynamic(
  () => import("@/components/content/rich-text-editor").then((module) => module.RichTextEditor),
  { ssr: false, loading: () => <Skeleton height="20rem" borderRadius="md" /> },
);

const MODES = [
  { value: "edit", label: "Edit" },
  { value: "preview", label: "Preview" },
] as const;

type Mode = (typeof MODES)[number]["value"];

export type MaterialEditorProps = {
  moduleId: string;
  materialId: string | null;
  /** The saved state of the Module, which decides whether Coders can reach anything in it. */
  modulePublished: boolean;
  /** How a Coder sees the Section named above the title, for the preview. */
  sectionLabel?: string;
  /**
   * Told whenever the form gains or loses unsaved edits, and told `false` when
   * it unmounts. The builder needs it to ask before a selection throws the
   * edits away; the form cannot see those selections from in here.
   */
  onDirtyChange?: (dirty: boolean) => void;
};

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
  modulePublished,
  sectionLabel,
  onDirtyChange,
}: MaterialEditorProps) {
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

  return (
    <MaterialForm
      key={data.id}
      moduleId={moduleId}
      material={data}
      modulePublished={modulePublished}
      sectionLabel={sectionLabel}
      onDirtyChange={onDirtyChange}
    />
  );
}

function MaterialForm({
  moduleId,
  material,
  modulePublished,
  sectionLabel,
  onDirtyChange,
}: Omit<MaterialEditorProps, "materialId"> & { material: MaterialDetail }) {
  const updateMaterial = useUpdateMaterial(moduleId);
  const deletePractice = useDeletePractice(moduleId, material.id);
  const panelId = useId();

  const [title, setTitle] = useState(material.title);
  const [content, setContent] = useState<RichTextDocument>(material.content);
  const [isPublished, setPublished] = useState(material.isPublished);
  /**
   * What the server last confirmed, and what the draft is measured against.
   *
   * Held here rather than read from `material`: the refetch after a save lands
   * a moment after the save itself, and in between the prop still describes
   * the old Material, so the form would claim edits it no longer has.
   */
  const [saved, setSaved] = useState<MaterialDraft>(() => ({
    title: material.title,
    content: material.content,
    isPublished: material.isPublished,
  }));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [editingPractice, setEditingPractice] = useState<PracticeActivityView | null>(null);
  const [creatingPractice, setCreatingPractice] = useState(false);
  const [deletingPractice, setDeletingPractice] = useState<PracticeActivityView | null>(null);
  const [scriptingPractice, setScriptingPractice] = useState<PracticeActivityView | null>(null);

  const dirty = useMemo(
    () => materialIsDirty(saved, { title, content, isPublished }),
    [saved, title, content, isPublished],
  );

  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  /** "Saved at" describes the version on screen, so the first edit retires it. */
  function edited() {
    setSavedAt(null);
  }

  /**
   * Saving is explicit. Autosave belongs to an attempt, where losing work costs
   * a Coder their exam; here an Architect editing a published Material should
   * decide when readers see the change.
   */
  async function save() {
    const parsedTitle = materialTitleSchema.safeParse(title);
    if (!parsedTitle.success) {
      setTitleError("Give the material a title.");
      return;
    }
    setTitleError(null);

    try {
      const result = await updateMaterial.mutateAsync({
        materialId: material.id,
        changes: { title: parsedTitle.data, content, isPublished },
      });
      // The server trims the title; adopting its version keeps a stray space
      // from reading as an edit straight after the save.
      setTitle(result.title);
      setSaved({ title: result.title, content, isPublished: result.isPublished });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (saveError) {
      toaster.error({
        title: "Could not save the material",
        description: isApiError(saveError) ? saveError.userMessage : undefined,
      });
    }
  }

  async function removePractice(activity: PracticeActivityView) {
    try {
      await deletePractice.mutateAsync(activity.id);
      toaster.success({ title: `Deleted ${activity.title}` });
    } catch (deleteError) {
      toaster.error({
        title: "Could not delete the practice activity",
        description: isApiError(deleteError) ? deleteError.userMessage : undefined,
      });
    } finally {
      setDeletingPractice(null);
    }
  }

  const hiddenReason = hiddenFromCoders({
    materialPublished: saved.isPublished,
    modulePublished,
  });

  return (
    <Stack gap="5">
      <Flex gap="3" align="end" wrap="wrap">
        <Stack flex="1" minWidth="16rem">
          <TextField
            label="Title"
            value={title}
            maxLength={160}
            errorText={titleError}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setTitleError(null);
              edited();
            }}
          />
        </Stack>
        <Checkbox.Root
          checked={isPublished}
          onCheckedChange={(details) => {
            setPublished(details.checked === true);
            edited();
          }}
          mb="2"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Published</Checkbox.Label>
        </Checkbox.Root>
        <Button
          onClick={() => void save()}
          disabled={!dirty}
          loading={updateMaterial.isPending}
          mb="1"
        >
          <Save aria-hidden />
          Save
        </Button>
      </Flex>

      <Stack gap="1">
        {/* Always rendered, so the live region exists before it has news. */}
        <Text fontSize="xs" color={dirty ? "fg.warning" : "fg.muted"} aria-live="polite">
          {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : null}
        </Text>
        {/* The checkbox says "Published", and on its own that is a promise
            the Module can break. */}
        {isPublished && !modulePublished ? (
          <Text fontSize="xs" color="fg.warning">
            The module is still a draft, so Coders cannot see this material until the module is
            published.
          </Text>
        ) : null}
      </Stack>

      <TabBar
        aria-label="Material view"
        items={MODES}
        value={mode}
        onValueChange={(value) => setMode(value as Mode)}
        controls={panelId}
      />

      <TabPanel id={panelId} value={mode}>
        {/* The editor stays mounted while previewing: remounting TipTap would
            throw away its undo history along with the cursor. */}
        <Box display={mode === "edit" ? "block" : "none"}>
          <Stack gap="5">
            {/* Materials are the only surface where Interactive Blocks are offered. */}
            <RichTextEditor
              value={content}
              onChange={(next) => {
                setContent(next);
                edited();
              }}
              allowInteractiveBlocks
            />

            <PracticeActivities
              activities={material.practiceActivities}
              onAdd={() => setCreatingPractice(true)}
              onScripts={setScriptingPractice}
              onEdit={setEditingPractice}
              onDelete={setDeletingPractice}
            />
          </Stack>
        </Box>

        {/* Mounted only while shown: each activity brings its own Monaco. */}
        {mode === "preview" ? (
          <MaterialPreview
            title={title}
            content={content}
            practiceActivities={material.practiceActivities}
            kicker={sectionLabel}
            hiddenReason={hiddenReason}
            unsaved={dirty}
          />
        ) : null}
      </TabPanel>

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

      {scriptingPractice ? (
        <PracticeTestScriptsDialog
          activity={scriptingPractice}
          onClose={() => setScriptingPractice(null)}
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

/**
 * The saved activities, managed through their own dialogs. They are never part
 * of the Material's draft: each one saves on its own endpoint.
 */
function PracticeActivities({
  activities,
  onAdd,
  onScripts,
  onEdit,
  onDelete,
}: {
  activities: PracticeActivityView[];
  onAdd: () => void;
  onScripts: (activity: PracticeActivityView) => void;
  onEdit: (activity: PracticeActivityView) => void;
  onDelete: (activity: PracticeActivityView) => void;
}) {
  return (
    <Stack gap="3">
      <Flex justify="space-between" align="center" gap="2" wrap="wrap">
        <HStack gap="2" minWidth="0">
          <Terminal size={16} aria-hidden />
          <Text textStyle="display" fontSize="sm">
            Practice activities
          </Text>
        </HStack>
        <Button size="xs" variant="ghost" onClick={onAdd}>
          <Plus aria-hidden />
          Add practice
        </Button>
      </Flex>

      {activities.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          None yet.
        </Text>
      ) : (
        <Stack gap="2">
          {activities.map((activity) => (
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
                    {activity.testCases.length} {activity.testCases.length === 1 ? "case" : "cases"}
                  </Badge>
                  <Text fontSize="xs" color="fg.muted">
                    {activity.allowedLanguages.join(", ")}
                  </Text>
                </HStack>
              </Stack>
              <IconButton
                aria-label={`Test scripts for ${activity.title}`}
                size="xs"
                onClick={() => onScripts(activity)}
              >
                <FileCode size={14} aria-hidden />
              </IconButton>
              <IconButton
                aria-label={`Edit ${activity.title}`}
                size="xs"
                onClick={() => onEdit(activity)}
              >
                <Pencil size={14} aria-hidden />
              </IconButton>
              <IconButton
                aria-label={`Delete ${activity.title}`}
                size="xs"
                onClick={() => onDelete(activity)}
              >
                <Trash size={14} aria-hidden />
              </IconButton>
            </Flex>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
