"use client";

import { useState } from "react";
import { Box, Checkbox, Flex, HStack, Stack, Text, Textarea } from "@chakra-ui/react";
import { Plus, Trash } from "lucide-react";
import {
  EXECUTABLE_LANGUAGES,
  createPracticeRequestSchema,
  type Language,
  type PracticeActivityView,
  type PracticeTestCaseInput,
} from "@ambatucode/shared";
import { Button, IconButton } from "@/components/ui/button";
import { CodeEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toaster } from "@/components/ui/toaster";
import { useCreatePractice, useUpdatePractice } from "@/hooks/use-practice";
import { isApiError } from "@/lib/api-client";

/**
 * Authoring a Practice Activity, inline with the Material it belongs to.
 *
 * The language list offers only those with a sandbox image. The server would
 * refuse the rest anyway, and an Architect discovering that after writing three
 * test cases is a worse way to learn it.
 */
type DraftCase = PracticeTestCaseInput & { key: string };

function toDraftCases(cases: PracticeActivityView["testCases"] | undefined): DraftCase[] {
  if (!cases || cases.length === 0) {
    return [{ key: "new-0", name: "Case 1", input: "", expectedOutput: "", comparison: "TRIMMED" }];
  }
  return cases.map((testCase, index) => ({
    ...testCase,
    key: testCase.id || `existing-${String(index)}`,
  }));
}

export function PracticeFormDialog({
  moduleId,
  materialId,
  activity,
  onClose,
}: {
  moduleId: string;
  materialId: string;
  activity?: PracticeActivityView;
  onClose: () => void;
}) {
  const editing = activity !== undefined;
  const createPractice = useCreatePractice(moduleId, materialId);
  const updatePractice = useUpdatePractice(moduleId, materialId);

  const [title, setTitle] = useState(activity?.title ?? "");
  const [prompt, setPrompt] = useState(activity?.prompt ?? "");
  const [languages, setLanguages] = useState<Language[]>(
    activity?.allowedLanguages ?? [EXECUTABLE_LANGUAGES[0]],
  );
  const [starterCode, setStarterCode] = useState<Partial<Record<Language, string>>>(
    activity?.starterCode ?? {},
  );
  const [starterLanguage, setStarterLanguage] = useState<Language>(
    activity?.allowedLanguages[0] ?? EXECUTABLE_LANGUAGES[0],
  );
  const [cases, setCases] = useState<DraftCase[]>(() => toDraftCases(activity?.testCases));
  const [error, setError] = useState<string | null>(null);

  const pending = createPractice.isPending || updatePractice.isPending;

  function toggleLanguage(language: Language, checked: boolean) {
    setLanguages((current) => {
      const next = checked ? [...current, language] : current.filter((entry) => entry !== language);
      // Starter code for a language nobody may pick would be rejected by the
      // API, so it goes when the language does.
      if (!checked) {
        setStarterCode(({ [language]: _removed, ...rest }) => rest);
        if (starterLanguage === language && next[0]) setStarterLanguage(next[0]);
      }
      return next;
    });
  }

  function updateCase(key: string, patch: Partial<DraftCase>) {
    setCases((current) =>
      current.map((testCase) => (testCase.key === key ? { ...testCase, ...patch } : testCase)),
    );
  }

  async function save() {
    setError(null);

    const payload = {
      title,
      prompt,
      allowedLanguages: languages,
      starterCode,
      timeLimitMs: activity?.timeLimitMs ?? 5_000,
      memoryLimitMb: activity?.memoryLimitMb ?? 256,
      testCases: cases.map(({ key: _key, ...testCase }) => testCase),
    };

    const parsed = createPracticeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields above.");
      return;
    }

    try {
      if (editing) {
        await updatePractice.mutateAsync({ practiceId: activity.id, changes: parsed.data });
      } else {
        await createPractice.mutateAsync(parsed.data);
      }
      toaster.success({ title: editing ? "Practice activity saved" : "Practice activity added" });
      onClose();
    } catch (saveError) {
      toaster.error({
        title: "Could not save the practice activity",
        description: isApiError(saveError) ? saveError.userMessage : undefined,
      });
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={editing ? "Edit practice activity" : "New practice activity"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <Stack gap="5">
        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          required
          autoFocus
        />

        <Stack gap="1">
          <Text fontSize="sm" fontWeight="medium">
            Prompt
          </Text>
          <Textarea
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            rows={3}
            placeholder="What should the Coder write?"
          />
        </Stack>

        <Stack gap="2">
          <Text fontSize="sm" fontWeight="medium">
            Languages
          </Text>
          <HStack gap="4" wrap="wrap">
            {EXECUTABLE_LANGUAGES.map((language) => (
              <Checkbox.Root
                key={language}
                checked={languages.includes(language)}
                onCheckedChange={(details) => toggleLanguage(language, details.checked === true)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{LANGUAGE_LABEL[language]}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Only languages with a sandbox image can be offered.
          </Text>
        </Stack>

        {languages.length > 0 ? (
          <Stack gap="2">
            <Flex justify="space-between" align="center" gap="3">
              <Text fontSize="sm" fontWeight="medium">
                Starter code
              </Text>
              <HStack gap="1">
                {languages.map((language) => (
                  <Button
                    key={language}
                    size="xs"
                    variant={language === starterLanguage ? "subtle" : "ghost"}
                    onClick={() => setStarterLanguage(language)}
                  >
                    {LANGUAGE_LABEL[language]}
                  </Button>
                ))}
              </HStack>
            </Flex>
            <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
              <CodeEditor
                language={starterLanguage}
                value={starterCode[starterLanguage] ?? ""}
                onChange={(next) =>
                  setStarterCode((current) => ({ ...current, [starterLanguage]: next }))
                }
                height="12rem"
                ariaLabel={`Starter code for ${LANGUAGE_LABEL[starterLanguage]}`}
              />
            </Box>
          </Stack>
        ) : null}

        <Stack gap="3">
          <Flex justify="space-between" align="center">
            <Text fontSize="sm" fontWeight="medium">
              Test cases
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                setCases((current) => [
                  ...current,
                  {
                    key: `new-${String(current.length)}-${String(Date.now())}`,
                    name: `Case ${String(current.length + 1)}`,
                    input: "",
                    expectedOutput: "",
                    comparison: "TRIMMED",
                  },
                ])
              }
            >
              <Plus aria-hidden />
              Add case
            </Button>
          </Flex>

          <Text fontSize="xs" color="fg.muted">
            Every practice case is visible to the Coder. An exercise that needs a hidden case
            belongs in an Assessment.
          </Text>

          {cases.map((testCase) => (
            <Stack
              key={testCase.key}
              gap="2"
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="md"
              padding="3"
            >
              <Flex gap="2" align="end">
                <Box flex="1">
                  <TextField
                    label="Name"
                    size="sm"
                    value={testCase.name}
                    onChange={(event) =>
                      updateCase(testCase.key, { name: event.currentTarget.value })
                    }
                  />
                </Box>
                <IconButton
                  aria-label={`Remove ${testCase.name}`}
                  size="sm"
                  disabled={cases.length === 1}
                  onClick={() =>
                    setCases((current) => current.filter((entry) => entry.key !== testCase.key))
                  }
                >
                  <Trash size={14} aria-hidden />
                </IconButton>
              </Flex>

              <Flex gap="3" direction={{ base: "column", md: "row" }}>
                <Stack gap="1" flex="1">
                  <Text fontSize="xs" color="fg.muted">
                    Input (stdin)
                  </Text>
                  <Textarea
                    aria-label={`Input for ${testCase.name}`}
                    rows={3}
                    fontFamily="mono"
                    fontSize="sm"
                    value={testCase.input}
                    onChange={(event) =>
                      updateCase(testCase.key, { input: event.currentTarget.value })
                    }
                  />
                </Stack>
                <Stack gap="1" flex="1">
                  <Text fontSize="xs" color="fg.muted">
                    Expected output
                  </Text>
                  <Textarea
                    aria-label={`Expected output for ${testCase.name}`}
                    rows={3}
                    fontFamily="mono"
                    fontSize="sm"
                    value={testCase.expectedOutput}
                    onChange={(event) =>
                      updateCase(testCase.key, { expectedOutput: event.currentTarget.value })
                    }
                  />
                </Stack>
              </Flex>
            </Stack>
          ))}
        </Stack>

        {error ? (
          <Text fontSize="sm" color="fg.error">
            {error}
          </Text>
        ) : null}
      </Stack>
    </Modal>
  );
}
