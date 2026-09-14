"use client";

import { useState } from "react";
import { Alert, HStack, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { AssessmentArchitectView, TestScriptView } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { toaster } from "@/components/ui/toaster";
import { TestScriptForm, type TestScriptDraft } from "@/components/test-scripts/test-script-form";
import { ReferenceSolutionPanel } from "@/components/test-scripts/reference-solution-panel";
import { TestScriptList } from "@/components/test-scripts/test-script-list";
import { validationWarning } from "@/components/test-scripts/validation";
import {
  useDeleteTestScript,
  useSaveReferenceSolution,
  useUploadTestScript,
  useValidateTestScripts,
} from "@/hooks/use-assessments";
import { isApiError } from "@/lib/api-client";

/**
 * Custom test scripts — JUnit, Jest, pytest, or an Architect's own runner.
 *
 * They check what a plain input/output case cannot: class structure,
 * inheritance, access modifiers, and other properties of the program rather
 * than of its output. Every byte of one is Architect-only data and never
 * reaches a Coder, which is why there is no preview of them anywhere outside
 * this tab.
 */
export function TestScriptsTab({ assessment }: { assessment: AssessmentArchitectView }) {
  /** null closes the editor; "new" or a script opens it. */
  const [editing, setEditing] = useState<"new" | TestScriptView | null>(null);
  const [deleting, setDeleting] = useState<TestScriptView | null>(null);
  const upload = useUploadTestScript(assessment.id);
  const remove = useDeleteTestScript(assessment.id);
  const saveSolution = useSaveReferenceSolution(assessment.id);
  const validate = useValidateTestScripts(assessment.id);
  const warning = validationWarning(assessment.testScripts);

  async function save(draft: TestScriptDraft) {
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

  return (
    <Stack gap="4">
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Text fontSize="sm" color="fg.muted" flex="1" minWidth="16rem">
          Each script is one file, run in its own sandbox against the Coder&apos;s code after the
          test cases. A language can hold several; every one runs on each submission.
        </Text>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Add script
        </Button>
      </HStack>

      {warning === null ? null : (
        <Alert.Root status="warning" size="sm">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{warning}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <TestScriptList
        scripts={assessment.testScripts}
        emptyDescription="Test cases alone are enough for input and output problems. Add a script when the structure of the code is what you are grading."
        onEdit={setEditing}
        onDelete={setDeleting}
      />

      {assessment.testScripts.length === 0 ? null : (
        <ReferenceSolutionPanel
          languages={assessment.allowedLanguages}
          saved={assessment.referenceSolutions}
          scripts={assessment.testScripts}
          savePending={saveSolution.isPending}
          validatePending={validate.isPending}
          onSave={(language, sourceCode) => saveSolution.mutateAsync({ language, sourceCode })}
          onValidate={(language) => validate.mutateAsync({ language })}
        />
      )}

      {editing === null ? null : (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          size="lg"
          title={editing === "new" ? "Add test script" : `Edit ${editing.path}`}
        >
          <TestScriptForm
            languages={assessment.allowedLanguages}
            initial={editing === "new" ? undefined : editing}
            showWeight
            pending={upload.isPending}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this test script?"
        description="Submissions already graded keep their scores. New submissions will not run this script."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}
