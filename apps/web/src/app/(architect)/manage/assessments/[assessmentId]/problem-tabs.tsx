"use client";

import { useId, useState } from "react";
import { Checkbox, HStack, Stack, Text, Textarea } from "@chakra-ui/react";
import { EXECUTABLE_LANGUAGES, type Language } from "@ambatucode/shared";
import { SourceEditor } from "@/components/editor/code-editor";
import { LANGUAGE_LABEL, MONACO_LANGUAGE_ID, TAB_SIZE } from "@/components/editor/language-labels";
import { TextField } from "@/components/ui/input";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import type { AssessmentDraft } from "./draft";

export type TabProps = {
  draft: AssessmentDraft;
  onChange: (changes: Partial<AssessmentDraft>) => void;
};

/**
 * The problem statement and the languages it may be solved in.
 *
 * The statement is a plain textarea, not a rich text editor, and deliberately
 * so: Interactive Blocks belong to Materials alone, and a field that cannot
 * hold a document cannot hold one. The rule is enforced by the shape of the
 * data rather than by a toolbar that has to remember to withhold a button.
 */
export function ProblemTab({ draft, onChange }: TabProps) {
  return (
    <Stack gap="5">
      <TextField
        label="Title"
        value={draft.title}
        onChange={(event) => onChange({ title: event.currentTarget.value })}
        maxLength={160}
      />

      <Stack gap="1">
        <Text fontSize="sm" fontWeight="medium">
          Problem statement
        </Text>
        <Textarea
          value={draft.problemStatement}
          onChange={(event) => onChange({ problemStatement: event.currentTarget.value })}
          rows={16}
          fontFamily="body"
          placeholder="Describe the problem, the input, and the expected output."
        />
        <Text fontSize="xs" color="fg.muted">
          Plain text. Interactive blocks are available in Materials, not in an assessment a Coder
          reads under time.
        </Text>
      </Stack>

      <Stack gap="2">
        <Text fontSize="sm" fontWeight="medium">
          Allowed languages
        </Text>
        <HStack gap="4" wrap="wrap">
          {EXECUTABLE_LANGUAGES.map((language) => {
            const checked = draft.allowedLanguages.includes(language);
            return (
              <Checkbox.Root
                key={language}
                checked={checked}
                colorPalette="accent"
                onCheckedChange={(details) =>
                  onChange(toggleLanguage(draft, language, details.checked === true))
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{LANGUAGE_LABEL[language]}</Checkbox.Label>
              </Checkbox.Root>
            );
          })}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          Only languages with a sandbox image are offered. A language nothing can execute would fail
          as a system error at the worst possible moment.
        </Text>
      </Stack>
    </Stack>
  );
}

/**
 * Removing a language takes its starter code with it: the server refuses
 * starter code for a language nobody may choose, and leaving it behind would
 * turn an unrelated save into a validation failure.
 */
function toggleLanguage(
  draft: AssessmentDraft,
  language: Language,
  checked: boolean,
): Partial<AssessmentDraft> {
  if (checked) {
    return { allowedLanguages: [...draft.allowedLanguages, language] };
  }
  const { [language]: _removed, ...starterCode } = draft.starterCode;
  return {
    allowedLanguages: draft.allowedLanguages.filter((entry) => entry !== language),
    starterCode,
  };
}

/** The buffer each Coder starts from, per language. */
export function StarterCodeTab({ draft, onChange }: TabProps) {
  const languages = draft.allowedLanguages;
  const [selected, setSelected] = useState<Language | null>(languages[0] ?? null);
  const panelId = useId();
  const active =
    selected !== null && languages.includes(selected) ? selected : (languages[0] ?? null);

  if (active === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Choose at least one language on the Problem tab first.
      </Text>
    );
  }

  return (
    <Stack gap="4">
      <TabBar
        aria-label="Starter code language"
        value={active}
        onValueChange={(value) => setSelected(value as Language)}
        items={languages.map((language) => ({
          value: language,
          label: LANGUAGE_LABEL[language],
        }))}
        controls={panelId}
      />

      <TabPanel
        id={panelId}
        value={active}
        borderWidth="1px"
        borderColor="border.default"
        borderRadius="md"
        overflow="hidden"
      >
        <SourceEditor
          monacoLanguage={MONACO_LANGUAGE_ID[active]}
          tabSize={TAB_SIZE[active]}
          value={draft.starterCode[active] ?? ""}
          onChange={(value) => onChange({ starterCode: { ...draft.starterCode, [active]: value } })}
          height="24rem"
          ariaLabel={`Starter code for ${LANGUAGE_LABEL[active]}`}
        />
      </TabPanel>

      <Text fontSize="xs" color="fg.muted">
        Leave a language blank to open its editor empty.
      </Text>
    </Stack>
  );
}
