"use client";

import { useState } from "react";
import { Alert, Flex, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { PracticeActivityView, PracticeTestScriptView } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { TestScriptForm, type TestScriptDraft } from "@/components/test-scripts/test-script-form";
import { ReferenceSolutionPanel } from "@/components/test-scripts/reference-solution-panel";
import { TestScriptList } from "@/components/test-scripts/test-script-list";
import { validationWarning } from "@/components/test-scripts/validation";
import {
  useDeletePracticeTestScript,
  usePracticeTestScripts,
  useSavePracticeReferenceSolution,
  useUploadPracticeTestScript,
  useValidatePracticeTestScripts,
} from "@/hooks/use-practice-test-scripts";
import { isApiError } from "@/lib/api-client";

/**
 * A Practice Activity's unit and structural tests.
 *
 * The list and the editor share one dialog, switching between them, rather
 * than stacking a second dialog over the first. A Coder who runs the activity
 * sees each test's name and whether it passed — never the script.
 */
export function PracticeTestScriptsDialog({
  activity,
  onClose,
}: {
  activity: PracticeActivityView;
  onClose: () => void;
}) {
  const scripts = usePracticeTestScripts(activity.id);
  const upload = useUploadPracticeTestScript(activity.id);
  const remove = useDeletePracticeTestScript(activity.id);
  const saveSolution = useSavePracticeReferenceSolution(activity.id);
  const validate = useValidatePracticeTestScripts(activity.id);

  /** null lists the scripts; "new" or a script opens the editor. */
  const [editing, setEditing] = useState<"new" | PracticeTestScriptView | null>(null);
  const [deleting, setDeleting] = useState<PracticeTestScriptView | null>(null);

  async function save({ weight: _weight, ...draft }: TestScriptDraft) {
    await upload.mutateAsync(draft);
    toaster.success({ title: `Saved ${draft.path}` });
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toaster.success({ title: `Removed ${deleting.path}` });
    } catch (error) {
      toaster.error({
        title: "Could not remove the test script",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    } finally {
      setDeleting(null);
    }
  }

  function body() {
    if (editing !== null) {
      return (
        <TestScriptForm
          languages={activity.allowedLanguages}
          initial={editing === "new" ? undefined : { ...editing, weight: 1 }}
          showWeight={false}
          pending={upload.isPending}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      );
    }
    if (scripts.isError) {
      return <ErrorState error={scripts.error} onRetry={() => void scripts.refetch()} />;
    }
    if (scripts.isPending) return <Skeleton height="8rem" borderRadius="md" />;

    const { scripts: listed, referenceSolutions } = scripts.data;
    const warning = validationWarning(listed);

    return (
      <Stack gap="4">
        <Flex justify="space-between" align="center" gap="3" wrap="wrap">
          <Text fontSize="sm" color="fg.muted" flex="1" minWidth="14rem">
            Scripts check what a stdin/stdout case cannot, such as a class&apos;s structure. They
            run on every Run, after the cases. The Coder sees each test&apos;s name and whether it
            passed.
          </Text>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            Add script
          </Button>
        </Flex>
        {warning === null ? null : (
          <Alert.Root status="warning" size="sm">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{warning}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
        <TestScriptList
          scripts={listed}
          emptyDescription="Add a script when what matters is how the code is built, not only what it prints."
          onEdit={setEditing}
          onDelete={setDeleting}
        />
        {listed.length === 0 ? null : (
          <ReferenceSolutionPanel
            languages={activity.allowedLanguages}
            saved={referenceSolutions}
            scripts={listed}
            savePending={saveSolution.isPending}
            validatePending={validate.isPending}
            onSave={(language, sourceCode) => saveSolution.mutateAsync({ language, sourceCode })}
            onValidate={(language) => validate.mutateAsync({ language })}
          />
        )}
      </Stack>
    );
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        size="lg"
        title={`Test scripts · ${activity.title}`}
      >
        {body()}
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title="Remove this test script?"
        description="Runs will no longer include its tests."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
