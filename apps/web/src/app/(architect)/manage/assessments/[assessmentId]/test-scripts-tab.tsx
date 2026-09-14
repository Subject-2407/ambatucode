"use client";

import { useState } from "react";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { FileCode, Plus, Trash } from "lucide-react";
import {
  FRAMEWORK_LANGUAGE,
  MAX_TEST_SCRIPT_BYTES,
  TEST_SCRIPT_FRAMEWORKS,
  uploadTestScriptRequestSchema,
  type AssessmentArchitectView,
  type Language,
  type TestScriptFramework,
  type TestScriptView,
} from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { toaster } from "@/components/ui/toaster";
import { SourceEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL, MONACO_LANGUAGE_ID, TAB_SIZE } from "@/components/editor/language-labels";
import { describeScriptContract } from "@/components/assessment/test-script-guidance";
import { useDeleteTestScript, useUploadTestScript } from "@/hooks/use-assessments";
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
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<TestScriptView | null>(null);
  const remove = useDeleteTestScript(assessment.id);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toaster.success({ title: "Test script removed" });
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
        <Text fontSize="sm" color="fg.muted">
          Each script is one file, run in its own sandbox against the Coder&apos;s code. Uploading
          to a path a language already has replaces that script.
        </Text>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Upload script
        </Button>
      </HStack>

      {assessment.testScripts.length === 0 ? (
        <EmptyState
          icon={<FileCode aria-hidden />}
          title="No test scripts"
          description="Test cases alone are enough for input and output problems. Add a script when the structure of the code is what you are grading."
        />
      ) : (
        <Stack gap="3">
          {assessment.testScripts.map((script) => (
            <HStack
              key={script.id}
              justify="space-between"
              gap="3"
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="md"
              padding="3"
            >
              <Stack gap="1" minWidth="0">
                <HStack gap="2">
                  <Badge tone="accent">{script.framework}</Badge>
                  <Text fontSize="sm">{LANGUAGE_LABEL[script.language]}</Text>
                </HStack>
                <Text fontSize="xs" color="fg.muted" truncate>
                  {script.path} · weight {script.weight}
                </Text>
              </Stack>
              <IconButton
                aria-label={`Remove the ${script.framework} script`}
                size="sm"
                onClick={() => setDeleting(script)}
              >
                <Trash aria-hidden />
              </IconButton>
            </HStack>
          ))}
        </Stack>
      )}

      {adding ? (
        <TestScriptDialog assessment={assessment} onClose={() => setAdding(false)} />
      ) : null}

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

/**
 * One file at a time is enough for the frameworks in scope: a JUnit test
 * class, a Jest spec, a pytest module. Multi-file uploads are supported by the
 * contract and can be added when an assessment needs one, rather than built
 * speculatively now.
 */
function TestScriptDialog({
  assessment,
  onClose,
}: {
  assessment: AssessmentArchitectView;
  onClose: () => void;
}) {
  const upload = useUploadTestScript(assessment.id);

  const [framework, setFramework] = useState<TestScriptFramework>("JUNIT");
  const [language, setLanguage] = useState<Language>(
    () => FRAMEWORK_LANGUAGE.JUNIT ?? assessment.allowedLanguages[0] ?? "java",
  );
  const [path, setPath] = useState("SolutionTest.java");
  const [content, setContent] = useState("");
  const [weight, setWeight] = useState("1");
  const [error, setError] = useState<string | null>(null);

  /** A packaged framework only runs in one language; CUSTOM runs in any. */
  function changeFramework(next: TestScriptFramework) {
    setFramework(next);
    const fixed = FRAMEWORK_LANGUAGE[next];
    if (fixed !== null) setLanguage(fixed);
  }

  async function save() {
    setError(null);
    const parsed = uploadTestScriptRequestSchema.safeParse({
      language,
      framework,
      path,
      content,
      weight: Number.parseInt(weight, 10),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields above.");
      return;
    }

    try {
      await upload.mutateAsync(parsed.data);
      toaster.success({ title: "Test script uploaded" });
      onClose();
    } catch (saveError) {
      setError(isApiError(saveError) ? saveError.userMessage : "Could not upload the script.");
    }
  }

  const fixedLanguage = FRAMEWORK_LANGUAGE[framework];
  const guidance = describeScriptContract(framework, language);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title="Upload test script"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={upload.isPending}>
            Upload
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <HStack gap="4" align="start">
          <SelectField
            label="Framework"
            value={framework}
            onChange={(value) => changeFramework(value as TestScriptFramework)}
            options={TEST_SCRIPT_FRAMEWORKS.map((value) => ({ value, label: value }))}
          />
          <SelectField
            label="Language"
            value={language}
            onChange={(value) => setLanguage(value as Language)}
            disabled={fixedLanguage !== null}
            options={assessment.allowedLanguages.map((value) => ({
              value,
              label: LANGUAGE_LABEL[value],
            }))}
            helperText={
              fixedLanguage === null ? "A custom runner can target any language." : undefined
            }
          />
        </HStack>

        <Stack
          gap="1"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="md"
          bg="bg.subtle"
          padding="3"
        >
          <Text fontSize="sm">{guidance.submission}</Text>
          <Text fontSize="sm" color="fg.muted">
            {guidance.results} Each test counts as one case with this script&apos;s weight.
          </Text>
        </Stack>

        <HStack gap="4" align="start">
          <TextField
            label="File path"
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            helperText="Relative, plain segments only — this names a file inside the sandbox."
          />
          <TextField
            label="Weight"
            type="number"
            min={0}
            max={1_000}
            value={weight}
            onChange={(event) => setWeight(event.currentTarget.value)}
          />
        </HStack>

        <Stack gap="1">
          <Text fontSize="sm" fontWeight="medium">
            Script
          </Text>
          <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
            <SourceEditor
              monacoLanguage={MONACO_LANGUAGE_ID[language]}
              tabSize={TAB_SIZE[language]}
              value={content}
              onChange={setContent}
              height="20rem"
              ariaLabel="Test script source"
            />
          </Box>
          <Text fontSize="xs" color="fg.muted">
            Up to {MAX_TEST_SCRIPT_BYTES / 1024} KiB. Never shown to a Coder.
          </Text>
        </Stack>

        {error === null ? null : (
          <Text fontSize="sm" color="fg.error" aria-live="polite">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
