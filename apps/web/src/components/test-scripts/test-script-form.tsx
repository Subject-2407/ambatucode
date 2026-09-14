"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { Upload } from "lucide-react";
import {
  MAX_TEST_SCRIPT_BYTES,
  TEST_SCRIPT_EXTENSIONS,
  uploadTestScriptRequestSchema,
  type Language,
  type TestScriptFramework,
} from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { SourceEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL, MONACO_LANGUAGE_ID, TAB_SIZE } from "@/components/editor/language-labels";
import { isApiError } from "@/lib/api-client";
import {
  defaultFramework,
  defaultScriptPath,
  frameworksFor,
  readPickedScriptFile,
} from "./script-file";
import { describeScriptContract } from "./test-script-guidance";

export type TestScriptDraft = {
  language: Language;
  framework: TestScriptFramework;
  path: string;
  content: string;
  weight: number;
};

/**
 * Writing or uploading one test script file, for an Assessment or a Practice
 * Activity alike.
 *
 * A file can be picked from disk or typed in; either way it lands in the
 * editor, so what is saved is always something the Architect has seen. When
 * editing, the language and path are fixed: they are what identifies the
 * script, and changing them would add a second one instead.
 */
export function TestScriptForm({
  languages,
  initial,
  showWeight,
  pending,
  onSave,
  onCancel,
}: {
  languages: Language[];
  initial?: TestScriptDraft;
  /** Practice produces no grade, so its scripts have no weight to set. */
  showWeight: boolean;
  pending: boolean;
  onSave: (draft: TestScriptDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = initial !== undefined;
  const firstLanguage = initial?.language ?? languages[0] ?? "python";
  const firstFramework = initial?.framework ?? defaultFramework(firstLanguage);

  const [language, setLanguage] = useState<Language>(firstLanguage);
  const [framework, setFramework] = useState<TestScriptFramework>(firstFramework);
  const [path, setPath] = useState(
    initial?.path ?? defaultScriptPath(firstFramework, firstLanguage),
  );
  const [content, setContent] = useState(initial?.content ?? "");
  const [weight, setWeight] = useState(String(initial?.weight ?? 1));
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Keeps a path the Architect typed; replaces one that was only a suggestion. */
  function suggestPath(nextFramework: TestScriptFramework, nextLanguage: Language) {
    if (path === defaultScriptPath(framework, language)) {
      setPath(defaultScriptPath(nextFramework, nextLanguage));
    }
  }

  function changeLanguage(next: Language) {
    const nextFramework = frameworksFor(next).includes(framework)
      ? framework
      : defaultFramework(next);
    suggestPath(nextFramework, next);
    setLanguage(next);
    setFramework(nextFramework);
  }

  function changeFramework(next: TestScriptFramework) {
    suggestPath(next, language);
    setFramework(next);
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Cleared so picking the same file again after editing still fires.
    event.currentTarget.value = "";
    if (!file) return;

    setError(null);
    const picked = await readPickedScriptFile(file, language);
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    if (!editing) setPath(picked.path);
    setContent(picked.content);
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
      await onSave(parsed.data);
    } catch (saveError) {
      setError(isApiError(saveError) ? saveError.userMessage : "Could not save the script.");
    }
  }

  const guidance = describeScriptContract(framework, language);

  return (
    <Stack gap="4">
      <HStack gap="4" align="start" wrap="wrap">
        <SelectField
          label="Language"
          value={language}
          onChange={(value) => changeLanguage(value as Language)}
          disabled={editing}
          options={languages.map((value) => ({ value, label: LANGUAGE_LABEL[value] }))}
        />
        <SelectField
          label="Framework"
          value={framework}
          onChange={(value) => changeFramework(value as TestScriptFramework)}
          options={frameworksFor(language).map((value) => ({ value, label: value }))}
          helperText={framework === "CUSTOM" ? "Your own runner, reporting as JSON." : undefined}
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
          {guidance.results}
          {showWeight ? " Each test counts as one case with this script's weight." : null}
        </Text>
      </Stack>

      <Flex gap="4" align="start" wrap="wrap">
        <Box flex="1" minWidth="14rem">
          <TextField
            label="File path"
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            disabled={editing}
            helperText={
              editing
                ? "Upload to a new path to add another script instead."
                : "Relative, plain segments only. Uploading to an existing path replaces that script."
            }
          />
        </Box>
        {showWeight ? (
          <Box width="7rem">
            <TextField
              label="Weight"
              type="number"
              min={0}
              max={1_000}
              value={weight}
              onChange={(event) => setWeight(event.currentTarget.value)}
            />
          </Box>
        ) : null}
      </Flex>

      <Stack gap="1">
        <Flex justify="space-between" align="center" gap="3">
          <Text fontSize="sm" fontWeight="medium">
            Script
          </Text>
          <Button size="xs" variant="ghost" onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden />
            Choose file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={TEST_SCRIPT_EXTENSIONS[language].join(",")}
            hidden
            aria-label="Choose a test script file"
            onChange={(event) => void pickFile(event)}
          />
        </Flex>
        <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
          <SourceEditor
            monacoLanguage={MONACO_LANGUAGE_ID[language]}
            tabSize={TAB_SIZE[language]}
            value={content}
            onChange={setContent}
            height="18rem"
            ariaLabel="Test script source"
          />
        </Box>
        <Text fontSize="xs" color="fg.muted">
          One file, up to {MAX_TEST_SCRIPT_BYTES / 1024} KiB. Never shown to a Coder.
        </Text>
      </Stack>

      {error === null ? null : (
        <Text fontSize="sm" color="fg.error" aria-live="polite">
          {error}
        </Text>
      )}

      <HStack justify="end" gap="2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={pending}>
          {editing ? "Save script" : "Add script"}
        </Button>
      </HStack>
    </Stack>
  );
}
