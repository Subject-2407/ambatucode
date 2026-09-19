"use client";

import { useCallback, useEffect, useState } from "react";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { Play, RotateCcw, Terminal } from "lucide-react";
import type { Language, PracticeActivityView } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toaster } from "@/components/ui/toaster";
import { CodeEditor } from "@/components/editor/code-editor";
import { RunOutcome } from "@/components/editor/run-results";
import { LanguagePicker } from "@/components/editor/language-picker";
import { switchLanguage } from "@/components/editor/starter-code";
import { usePracticeRun } from "@/hooks/use-practice-run";
import { isApiError } from "@/lib/api-client";

/**
 * A Practice Activity as a Coder works through it.
 *
 * Runs are unlimited and produce no grade — nothing here consumes an attempt,
 * and there is no Submit. That is the entire difference between this and the
 * assessment workspace, and it is why the controls are deliberately plain.
 */
export function PracticeActivity({ activity }: { activity: PracticeActivityView }) {
  const [language, setLanguage] = useState<Language>(activity.allowedLanguages[0] ?? "python");
  const [source, setSource] = useState(() => activity.starterCode[language] ?? "");
  const { state, run, isRunning } = usePracticeRun(activity.id);
  /** A switch waiting on the Coder's answer, because applying it loses work. */
  const [pendingLanguage, setPendingLanguage] = useState<Language | null>(null);

  const submit = useCallback(async () => {
    try {
      await run({ language, sourceCode: source });
    } catch (error) {
      toaster.error({
        title: "Could not start the run",
        description: isApiError(error) ? error.userMessage : "Please try again.",
      });
    }
  }, [language, run, source]);

  // Ctrl/Cmd+Enter runs, the same chord the assessment workspace uses. Learning
  // it here means it is already familiar when an attempt is on the line.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isRunning) void submit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning, submit]);

  function applyLanguage(next: Language) {
    const result = switchLanguage({
      current: source,
      currentLanguage: language,
      nextLanguage: next,
      starterCode: activity.starterCode,
    });
    setLanguage(next);
    setSource(result.source);
  }

  // Only ask when there is something to lose. Practice is meant to be
  // experimented with, but silently deleting what the Coder typed is not
  // experimentation.
  function changeLanguage(next: Language) {
    const result = switchLanguage({
      current: source,
      currentLanguage: language,
      nextLanguage: next,
      starterCode: activity.starterCode,
    });

    if (result.discardsEdits) {
      setPendingLanguage(next);
      return;
    }
    applyLanguage(next);
  }

  return (
    <Stack
      gap="4"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
      padding="5"
    >
      <Flex justify="space-between" align="start" gap="4" wrap="wrap">
        <HStack gap="2">
          <Terminal size={16} aria-hidden />
          <Text textStyle="display" fontSize="sm">
            {activity.title}
          </Text>
          <Badge tone="accent">Practice</Badge>
        </HStack>
        {activity.allowedLanguages.length > 1 ? (
          <Box minWidth="14rem">
            <LanguagePicker
              languages={activity.allowedLanguages}
              value={language}
              onChange={changeLanguage}
            />
          </Box>
        ) : null}
      </Flex>

      <Text color="fg.muted" fontSize="sm" whiteSpace="pre-wrap">
        {activity.prompt}
      </Text>

      <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
        <CodeEditor
          language={language}
          value={source}
          onChange={setSource}
          height="22rem"
          ariaLabel={`Code editor for ${activity.title}`}
        />
      </Box>

      <Flex gap="3" align="center" wrap="wrap">
        <Button onClick={() => void submit()} loading={isRunning} loadingText="Running">
          <Play aria-hidden />
          Run
        </Button>
        <Button
          variant="ghost"
          onClick={() => setSource(activity.starterCode[language] ?? "")}
          disabled={isRunning}
        >
          <RotateCcw aria-hidden />
          Reset code
        </Button>
        <Text fontSize="xs" color="fg.muted">
          Runs are unlimited and are never graded.
        </Text>
      </Flex>

      <RunOutcome state={state} />

      <ConfirmDialog
        open={pendingLanguage !== null}
        title="Switch language?"
        description="Your code will be replaced with the starter code for the new language."
        confirmLabel="Switch"
        destructive
        onConfirm={() => {
          if (pendingLanguage) applyLanguage(pendingLanguage);
          setPendingLanguage(null);
        }}
        onClose={() => setPendingLanguage(null)}
      />
    </Stack>
  );
}
