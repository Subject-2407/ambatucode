"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { CircleDot, Play, Send } from "lucide-react";
import type { AttemptView, Language } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import { toaster } from "@/components/ui/toaster";
import { CodeEditor } from "@/components/editor/code-editor";
import { LanguagePicker } from "@/components/editor/language-picker";
import { RunOutcome } from "@/components/editor/run-results";
import { switchLanguage } from "@/components/editor/starter-code";
import { AttemptTimer } from "@/components/assessment/attempt-timer";
import {
  AutoSubmittedModal,
  FocusWarningModal,
  SupersededModal,
} from "@/components/assessment/attempt-modals";
import { ConnectionBanner } from "@/components/assessment/connection-banner";
import { ProblemPanel } from "@/components/assessment/problem-panel";
import { SplitPane } from "@/components/assessment/split-pane";
import { SubmissionPanel } from "@/components/assessment/submission-panel";
import { SubmitDialog } from "@/components/assessment/submit-dialog";
import { useAntiCheat } from "@/hooks/use-anti-cheat";
import { useAttemptDraft, type DraftSaveState } from "@/hooks/use-attempt-draft";
import { useAttemptSocket } from "@/hooks/use-attempt-socket";
import { useAttemptSubmission } from "@/hooks/use-attempt-submission";
import { useRunJob } from "@/hooks/use-run-job";
import { apiClient, isApiError } from "@/lib/api-client";
import { describeAntiCheat } from "@/lib/anti-cheat";
import { chooseDraft, clearLocalDraft, readLocalDraft } from "@/lib/local-draft";
import { routes } from "@/lib/routes";
import { useEnterAssessmentMode } from "@/providers/assessment-mode";

/**
 * The assessment workspace: the highest-risk screen in the product.
 *
 * Three rules shape everything below.
 *
 * The client never decides anything. The deadline, whether the attempt is
 * still open, and what a submission scored all come from the server. When the
 * local countdown reaches zero this screen says "Finishing…" and waits.
 *
 * Submit sends the editor buffer. Not the draft, not the last autosave — the
 * exact characters in the editor at the moment the Coder confirmed. A pending
 * save that never landed cannot change what is graded.
 *
 * Nothing the Coder typed is ever silently discarded. Where the local copy and
 * the server's disagree, the local one wins and the Coder is told.
 */
export function AttemptWorkspace({
  attempt,
  moduleSlug,
}: {
  attempt: AttemptView;
  moduleSlug: string;
}) {
  useEnterAssessmentMode();
  const router = useRouter();

  const { assessment } = attempt;
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const [language, setLanguage] = useState<Language>(
    () => attempt.draft?.language ?? assessment.allowedLanguages[0] ?? "python",
  );
  const [source, setSource] = useState(
    () => attempt.draft?.sourceCode ?? assessment.starterCode[language] ?? "",
  );
  const [pendingLanguage, setPendingLanguage] = useState<Language | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [awaitingDeadline, setAwaitingDeadline] = useState(false);
  /**
   * The auto-submit explanation is read once. The attempt stays auto-submitted,
   * so without this the modal — which cannot be dismissed any other way — would
   * cover the very result it offers to show.
   */
  const [autoSubmitSeen, setAutoSubmitSeen] = useState(false);
  const [mobileTab, setMobileTab] = useState("problem");
  const mobilePanelId = useId();

  const socket = useAttemptSocket({
    attemptId: attempt.id,
    durationMinutes: attempt.durationMinutes,
    initialDeadlineMs: attempt.deadlineMs,
    initialServerTimeMs: attempt.serverTimeMs,
    initialPaused: attempt.paused,
  });

  const {
    state: submissionState,
    submit,
    adopt,
  } = useAttemptSubmission({ attemptId: attempt.id, initial: attempt.submission });
  const {
    state: runState,
    run: startRun,
    isRunning,
  } = useRunJob(`/api/attempts/${attempt.id}/run`);

  const status = socket.state?.status ?? attempt.status;
  const terminal = socket.terminal;
  /**
   * Locked covers every way the attempt stops accepting work, including the
   * optimistic one: the editor closes the instant Submit is confirmed, before
   * the server has answered, because a second submission attempted in that
   * window is a rejection the Coder would have to be talked out of.
   */
  const locked =
    status !== "IN_PROGRESS" ||
    terminal.kind !== "NONE" ||
    submissionState.phase !== "none" ||
    awaitingDeadline;

  const draft = useAttemptDraft({
    attemptId: attempt.id,
    language,
    sourceCode: source,
    enabled: !locked,
  });

  // --- Draft recovery -------------------------------------------------------

  /**
   * Reconciles this browser's copy with the server's.
   *
   * Runs on mount and again after every reconnect, because either side may
   * have moved on: the Coder may have typed through an outage, or another
   * device may have autosaved while this one was away. `chooseDraft` decides;
   * when the local copy wins it is pushed straight back so the server — which
   * is what auto-submit reads at the deadline — holds the newer work.
   */
  const reconcile = useCallback(
    async (serverDraft: AttemptView["draft"], skewMs: number) => {
      const local = await readLocalDraft(attempt.id);
      const choice = chooseDraft({
        local,
        server: serverDraft
          ? {
              language: serverDraft.language,
              sourceCode: serverDraft.sourceCode,
              savedAtMs: new Date(serverDraft.savedAt).getTime(),
            }
          : null,
        skewMs,
      });

      if (choice.source === "NONE") return;
      setLanguage(choice.language);
      setSource(choice.sourceCode);

      if (choice.source !== "LOCAL") return;
      toaster.info({
        title: "Restored your latest code",
        description: "This browser had newer work than the server. It has been saved.",
      });
      try {
        await apiClient.put(`/api/attempts/${attempt.id}/draft`, {
          language: choice.language,
          sourceCode: choice.sourceCode,
        });
      } catch {
        // The autosave loop will try again; the local copy is still intact.
      }
    },
    [attempt.id],
  );

  /**
   * Once, on mount. The guard is a ref rather than an empty dependency list
   * because `attempt` is a prop: a `router.refresh()` elsewhere in the page
   * would hand us a new object, and re-running recovery then would overwrite
   * whatever the Coder has typed since with the server's older draft.
   */
  const recovered = useRef(false);
  const initialDraft = attempt.draft;
  const initialServerTimeMs = attempt.serverTimeMs;
  useEffect(() => {
    if (recovered.current) return;
    recovered.current = true;
    void reconcile(initialDraft, initialServerTimeMs - Date.now());
  }, [initialDraft, initialServerTimeMs, reconcile]);

  /**
   * The reconnect path. `attempt:state` carries the server's draft but not
   * when it was saved, and the timestamps are what decide a conflict — so the
   * attempt is re-read over HTTP, where `savedAt` is part of the view.
   */
  const wasOffline = useRef(false);
  useEffect(() => {
    if (socket.connection === "OFFLINE") {
      wasOffline.current = true;
      return;
    }
    if (socket.connection !== "ONLINE" || !wasOffline.current) return;
    wasOffline.current = false;

    void apiClient
      .get<AttemptView>(`/api/attempts/${attempt.id}`)
      .then((fresh) => reconcile(fresh.draft, fresh.serverTimeMs - Date.now()))
      .catch(() => {
        // Still offline in practice. The banner already says so.
      });
  }, [attempt.id, reconcile, socket.connection]);

  // --- Terminal states ------------------------------------------------------

  useEffect(() => {
    if (terminal.kind !== "AUTO_SUBMITTED") return;
    void adopt(terminal.submissionId);
    // The server holds the submitted source now; a stale local copy on a
    // shared lab machine is only a way for the next Coder to find it.
    void clearLocalDraft(attempt.id);
  }, [adopt, attempt.id, terminal]);

  // --- Anti-cheat -----------------------------------------------------------

  useAntiCheat({
    enabled: !locked,
    config: assessment.antiCheat,
    rootRef,
    editorRef,
    onFocus: socket.reportFocus,
    onClipboard: (action) => {
      socket.reportClipboard(action);
      if (action === "PASTE") {
        toaster.warning({
          title: "Pasting is blocked",
          description: "This assessment does not allow pasting code in.",
        });
      }
    },
  });

  const antiCheatNotice = describeAntiCheat(assessment.antiCheat);

  // --- Actions --------------------------------------------------------------

  const run = useCallback(async () => {
    if (locked) return;
    try {
      await startRun({ language, sourceCode: source });
    } catch (error) {
      toaster.error({
        title: "Could not start the run",
        description: isApiError(error) ? error.userMessage : "Please try again.",
      });
    }
  }, [language, locked, source, startRun]);

  const confirmSubmit = useCallback(async () => {
    setSubmitOpen(false);
    try {
      // The buffer, read here and now. Never the draft.
      await submit({ language, sourceCode: source });
      void clearLocalDraft(attempt.id);
      toaster.success({ title: "Submitted", description: "Grading has started." });
    } catch (error) {
      if (isApiError(error) && error.code === "ATTEMPT_ALREADY_SUBMITTED") {
        // The editor stays closed: a submission exists, and reopening it would
        // invite a second one the server will refuse again.
        toaster.info({ title: "Already submitted", description: error.userMessage });
        router.refresh();
        return;
      }
      toaster.error({
        title: "Could not submit",
        description: isApiError(error) ? error.userMessage : "Please try again.",
      });
    }
  }, [attempt.id, language, router, source, submit]);

  function applyLanguage(next: Language) {
    const result = switchLanguage({
      current: source,
      currentLanguage: language,
      nextLanguage: next,
      starterCode: assessment.starterCode,
    });
    setLanguage(next);
    setSource(result.source);
  }

  function changeLanguage(next: Language) {
    const result = switchLanguage({
      current: source,
      currentLanguage: language,
      nextLanguage: next,
      starterCode: assessment.starterCode,
    });
    if (result.discardsEdits) {
      setPendingLanguage(next);
      return;
    }
    applyLanguage(next);
  }

  // Ctrl/Cmd+Enter runs; adding Shift opens the submit confirmation. Submit is
  // never sent by a chord alone — the dialog is the whole point.
  //
  // Captured, not bubbled. Monaco binds both chords to "insert line" and stops
  // the event there, so a bubbling listener never heard them from the one
  // place a Coder presses them: the editor. Stopping the event here also keeps
  // Monaco from adding a stray line to the buffer on the way.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (locked) return;
      if (event.shiftKey) setSubmitOpen(true);
      else if (!isRunning) void run();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isRunning, locked, run]);

  // --- Panels ---------------------------------------------------------------

  const problemPanel = (
    <Box height="100%" overflowY="auto" bg="bg.surface">
      <ProblemPanel
        title={assessment.title}
        problemStatement={assessment.problemStatement}
        sampleCases={assessment.sampleCases}
      />
    </Box>
  );

  const editorPanel = (
    <Stack gap="0" height="100%" minHeight="0" bg="bg.surface">
      <Flex
        align="center"
        justify="space-between"
        gap="3"
        px="4"
        py="2"
        borderBottomWidth="1px"
        borderColor="border.default"
      >
        <Box minWidth="12rem">
          <LanguagePicker
            languages={assessment.allowedLanguages}
            value={language}
            onChange={changeLanguage}
            disabled={locked}
          />
        </Box>
        <DraftIndicator state={draft.saveState} />
      </Flex>

      <Box ref={editorRef} flex="1" minHeight="0">
        <CodeEditor
          language={language}
          value={source}
          onChange={setSource}
          readOnly={locked}
          blockContextMenu={assessment.antiCheat.blockContextMenu}
          ariaLabel={`Code editor for ${assessment.title}`}
          height="100%"
        />
      </Box>
    </Stack>
  );

  const consolePanel = (
    <Box height="100%" overflowY="auto" bg="bg.surface" padding="4">
      <Stack gap="4">
        <SubmissionPanel state={submissionState} />
        {submissionState.phase === "none" ? (
          <RunOutcome
            state={runState}
            idle={
              <Text fontSize="sm" color="fg.muted">
                Run your code to check it against the sample cases. Runs are unlimited and never
                consume your submission.
              </Text>
            }
          />
        ) : null}
      </Stack>
    </Box>
  );

  return (
    <Flex ref={rootRef} direction="column" height="100dvh" minHeight="0" bg="bg.canvas">
      <ConnectionBanner connection={socket.connection} executionMode={attempt.executionMode} />

      <Flex
        align="center"
        justify="space-between"
        gap="4"
        wrap="wrap"
        px={{ base: "4", md: "6" }}
        py="3"
        borderBottomWidth="1px"
        borderColor="border.default"
        bg="bg.surface"
      >
        <HStack gap="3" minWidth="0">
          <Text textStyle="display" truncate>
            {assessment.title}
          </Text>
          <Badge tone="neutral">Attempt {attempt.attemptNumber}</Badge>
        </HStack>

        <HStack gap="4" wrap="wrap">
          <AttemptTimer
            timer={socket.timer}
            executionMode={attempt.executionMode}
            onExpire={() => setAwaitingDeadline(true)}
          />
          <ConnectionDot connection={socket.connection} />
          <HStack gap="2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run()}
              loading={isRunning}
              loadingText="Running"
              disabled={locked}
            >
              <Play aria-hidden />
              Run
            </Button>
            <Button size="sm" onClick={() => setSubmitOpen(true)} disabled={locked}>
              <Send aria-hidden />
              Submit
            </Button>
          </HStack>
        </HStack>
      </Flex>

      {awaitingDeadline && terminal.kind === "NONE" ? (
        <Box bg="bg.warning" px={{ base: "4", md: "6" }} py="2" role="status" aria-live="polite">
          <Text fontSize="sm" color="fg.warning">
            Finishing… the server is closing this attempt and submitting your saved work.
          </Text>
        </Box>
      ) : null}

      {antiCheatNotice === null ? null : (
        <Box
          px={{ base: "4", md: "6" }}
          py="1.5"
          bg="bg.subtle"
          borderBottomWidth="1px"
          borderColor="border.default"
        >
          <Text fontSize="xs" color="fg.muted">
            {antiCheatNotice}
          </Text>
        </Box>
      )}

      {/* Desktop: problem beside the editor and console. */}
      <Box flex="1" minHeight="0" display={{ base: "none", lg: "block" }}>
        <SplitPane
          direction="horizontal"
          storageKey="ambatucode:workspace:main"
          defaultRatio={0.4}
          label="Resize the problem panel"
          first={problemPanel}
          second={
            <SplitPane
              direction="vertical"
              storageKey="ambatucode:workspace:console"
              defaultRatio={0.62}
              label="Resize the editor"
              first={editorPanel}
              second={consolePanel}
            />
          }
        />
      </Box>

      {/* Narrow screens: the same three areas as tabs. */}
      <Stack flex="1" minHeight="0" gap="0" display={{ base: "flex", lg: "none" }}>
        <Box px="4" pt="2" bg="bg.surface">
          <TabBar
            aria-label="Workspace panels"
            value={mobileTab}
            onValueChange={setMobileTab}
            controls={mobilePanelId}
            items={[
              { value: "problem", label: "Problem" },
              { value: "code", label: "Code" },
              { value: "console", label: "Console" },
            ]}
          />
        </Box>
        <TabPanel id={mobilePanelId} value={mobileTab} flex="1" minHeight="0">
          {mobileTab === "problem" ? problemPanel : null}
          {mobileTab === "code" ? editorPanel : null}
          {mobileTab === "console" ? consolePanel : null}
        </TabPanel>
      </Stack>

      <SubmitDialog
        open={submitOpen}
        language={language}
        lineCount={source.split("\n").length}
        submitting={submissionState.phase === "submitting"}
        onConfirm={() => void confirmSubmit()}
        onClose={() => setSubmitOpen(false)}
      />

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

      <AutoSubmittedModal
        open={terminal.kind === "AUTO_SUBMITTED" && !autoSubmitSeen}
        submissionId={terminal.kind === "AUTO_SUBMITTED" ? terminal.submissionId : null}
        onView={() => {
          setAwaitingDeadline(false);
          setAutoSubmitSeen(true);
        }}
      />

      <SupersededModal
        open={terminal.kind === "SUPERSEDED"}
        moduleHref={routes.module(moduleSlug)}
      />

      <FocusWarningModal warning={socket.warning} onDismiss={socket.dismissWarning} />
    </Flex>
  );
}

/** "Saved 14:32:08" and nothing louder. An autosave is not news. */
function DraftIndicator({ state }: { state: DraftSaveState }) {
  if (state.phase === "saved") {
    return (
      <Text fontSize="xs" color="fg.muted">
        Saved {new Date(state.atMs).toLocaleTimeString()}
      </Text>
    );
  }
  if (state.phase === "saving") {
    return (
      <Text fontSize="xs" color="fg.muted">
        Saving…
      </Text>
    );
  }
  if (state.phase === "offline") {
    return (
      <Text fontSize="xs" color="fg.warning">
        Not saved to the server yet
      </Text>
    );
  }
  if (state.phase === "closed") {
    return (
      <Text fontSize="xs" color="fg.muted">
        {state.message}
      </Text>
    );
  }
  return null;
}

function ConnectionDot({ connection }: { connection: "CONNECTING" | "ONLINE" | "OFFLINE" }) {
  const tone =
    connection === "ONLINE" ? "fg.success" : connection === "OFFLINE" ? "fg.error" : "fg.muted";
  const label =
    connection === "ONLINE" ? "Connected" : connection === "OFFLINE" ? "Offline" : "Connecting";

  return (
    <HStack gap="1.5" color={tone}>
      <CircleDot size={12} aria-hidden />
      <Text fontSize="xs">{label}</Text>
    </HStack>
  );
}
