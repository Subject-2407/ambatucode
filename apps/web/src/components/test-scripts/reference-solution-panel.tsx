"use client";

import { useState } from "react";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { FlaskConical, Save } from "lucide-react";
import type { Language, StarterCodeMap, TestScriptValidation } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import { CodeEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { isApiError } from "@/lib/api-client";

/**
 * The Architect's own solution, one per language, and the button that runs
 * that language's scripts against it.
 *
 * A script that fails against a correct solution is broken, and would fail
 * every Coder the same way. This is where the Architect finds that out first.
 * The solution never reaches a Coder.
 */
export function ReferenceSolutionPanel({
  languages,
  saved,
  scripts,
  savePending,
  validatePending,
  onSave,
  onValidate,
}: {
  languages: Language[];
  saved: StarterCodeMap;
  scripts: ReadonlyArray<{ language: Language; validation: TestScriptValidation }>;
  savePending: boolean;
  validatePending: boolean;
  onSave: (language: Language, sourceCode: string) => Promise<unknown>;
  onValidate: (language: Language) => Promise<unknown>;
}) {
  const [language, setLanguage] = useState<Language>(languages[0] ?? "python");
  /** Unsaved edits, per language, so switching tabs does not lose them. */
  const [drafts, setDrafts] = useState<StarterCodeMap>({});

  const source = drafts[language] ?? saved[language] ?? "";
  const dirty = source !== (saved[language] ?? "");
  const scriptCount = scripts.filter((script) => script.language === language).length;
  const validating = scripts.some(
    (script) => script.language === language && script.validation.status === "VALIDATING",
  );

  async function attempt(action: () => Promise<unknown>, failure: string, success?: string) {
    try {
      await action();
      if (success) toaster.success({ title: success });
    } catch (error) {
      toaster.error({
        title: failure,
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function save() {
    await attempt(
      async () => {
        await onSave(language, source);
        setDrafts(({ [language]: _saved, ...rest }) => rest);
      },
      "Could not save the reference solution",
      source.trim() === "" ? "Reference solution removed" : "Reference solution saved",
    );
  }

  return (
    <Stack gap="3" borderWidth="1px" borderColor="border.default" borderRadius="md" padding="4">
      <Flex justify="space-between" align="center" gap="3" wrap="wrap">
        <Stack gap="0">
          <Text fontWeight="semibold" fontSize="sm">
            Reference solution
          </Text>
          <Text fontSize="xs" color="fg.muted">
            A correct answer to check the scripts against. Never shown to a Coder.
          </Text>
        </Stack>
        {languages.length > 1 ? (
          <HStack gap="1">
            {languages.map((option) => (
              <Button
                key={option}
                size="xs"
                variant={option === language ? "subtle" : "ghost"}
                onClick={() => setLanguage(option)}
              >
                {LANGUAGE_LABEL[option]}
              </Button>
            ))}
          </HStack>
        ) : null}
      </Flex>

      <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
        <CodeEditor
          language={language}
          value={source}
          onChange={(next) => setDrafts((current) => ({ ...current, [language]: next }))}
          height="14rem"
          ariaLabel={`Reference solution for ${LANGUAGE_LABEL[language]}`}
        />
      </Box>

      <Flex justify="space-between" align="center" gap="3" wrap="wrap">
        <Text fontSize="xs" color="fg.muted">
          {dirty
            ? "Save before validating: scripts are checked against the saved solution."
            : `Checks the ${String(scriptCount)} ${LANGUAGE_LABEL[language]} ${scriptCount === 1 ? "script" : "scripts"}.`}
        </Text>
        <HStack gap="2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={!dirty}
            loading={savePending}
          >
            <Save aria-hidden />
            Save solution
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void attempt(() => onValidate(language), "Could not start the validation")
            }
            disabled={dirty || scriptCount === 0 || (saved[language] ?? "").trim() === ""}
            loading={validatePending || validating}
            loadingText="Validating"
          >
            <FlaskConical aria-hidden />
            Validate scripts
          </Button>
        </HStack>
      </Flex>
    </Stack>
  );
}
