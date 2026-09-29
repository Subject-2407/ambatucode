"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { Play, RotateCcw, Terminal } from "lucide-react";
import type { Language, PracticeActivityView } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { ShortcutKeys, ariaShortcut } from "@/components/ui/shortcut";
import { toaster } from "@/components/ui/toaster";
import { CodeEditor } from "@/components/editor/code-editor";
import { RunOutcome } from "@/components/editor/run-results";
import { LanguagePicker } from "@/components/editor/language-picker";
import { switchLanguage } from "@/components/editor/starter-code";
import { Prose } from "@/components/content/prose";
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
  /** Same reason: resetting throws away whatever was typed. */
  const [confirmingReset, setConfirmingReset] = useState(false);

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

  /**
   * Ctrl/Cmd+Enter runs, the same chord the assessment workspace uses, so it
   * is already familiar when an attempt is on the line.
   *
   * Scoped to this activity rather than the window. A Material can hold several
   * activities, and a window listener in each one meant a single press ran
   * every one of them at once. Captured, because Monaco binds the chord itself
   * and stops it before a bubbling handler hears it.
   */
  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!isRunning) void submit();
  }

  const starter = activity.starterCode[language] ?? "";

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
    // The pixel edge, like every other surface a Coder works in. This was the
    // one rounded 1px box left on the page.
    <PixelFrame pad="5" onKeyDownCapture={onKeyDownCapture}>
      <Stack gap="4">
        <Flex justify="space-between" align="start" gap="4" wrap="wrap">
          {/* No "Practice" badge: the heading above the activities already
              says so, and a badge repeating it on each one is noise. */}
          <HStack gap="2">
            <Terminal size={16} aria-hidden />
            <Text textStyle="display" fontSize="sm">
              {activity.title}
            </Text>
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

        <Prose source={activity.prompt} color="fg.muted" />

        <Box borderWidth="1px" borderColor="border.default" overflow="hidden">
          <CodeEditor
            language={language}
            value={source}
            onChange={setSource}
            height="22rem"
            ariaLabel={`Code editor for ${activity.title}`}
          />
        </Box>

        <Flex gap="3" align="center" wrap="wrap">
          <Button
            onClick={() => void submit()}
            loading={isRunning}
            loadingText="Running"
            aria-keyshortcuts={ariaShortcut(["mod", "enter"])}
          >
            <Play aria-hidden />
            Run
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              // Nothing to lose, nothing to ask.
              if (source === starter) return;
              setConfirmingReset(true);
            }}
            disabled={isRunning || source === starter}
          >
            <RotateCcw aria-hidden />
            Reset code
          </Button>
          <HStack gap="1.5" color="fg.muted" fontSize="xs" display={{ base: "none", md: "flex" }}>
            <ShortcutKeys keys={["mod", "enter"]} />
            <Text>to run</Text>
          </HStack>
        </Flex>

        <RunOutcome state={state} />
      </Stack>

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

      <ConfirmDialog
        open={confirmingReset}
        title="Reset your code?"
        description="Your code will be replaced with the starter code."
        confirmLabel="Reset"
        destructive
        onConfirm={() => {
          setSource(starter);
          setConfirmingReset(false);
        }}
        onClose={() => setConfirmingReset(false)}
      />
    </PixelFrame>
  );
}
