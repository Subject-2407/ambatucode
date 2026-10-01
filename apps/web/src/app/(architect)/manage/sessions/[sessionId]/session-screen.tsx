"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Box, Checkbox, HStack, Stack, Text } from "@chakra-ui/react";
import {
  ChevronLeft,
  DoorClosed,
  DoorOpen,
  MonitorPlay,
  Play,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import {
  everyoneReady,
  readinessStateOf,
  type AssessmentSessionStatus,
  type ParticipantView,
  type SessionAccess,
  type SessionCounts,
  type SessionView,
} from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ParticipantPicker } from "@/components/monitor/participant-picker";
import { ParticipantRoster, ReadinessBoard } from "@/components/monitor/readiness-board";
import { AccessChoice, SessionSettingsDialog } from "@/components/sessions/session-settings-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useMonitorSocket } from "@/hooks/use-monitor-socket";
import {
  useDeleteSession,
  useEndSession,
  useReadiness,
  useSession,
  useStartSession,
  useUpdateSession,
} from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import {
  SESSION_STATUS_LABEL,
  SESSION_STATUS_TONE,
  describeSessionRules,
} from "@/lib/session-copy";
import { pixelSkin } from "@/theme/pixel";

/**
 * Session control: who takes part, who is ready, and starting.
 *
 * A session moves through four steps — set up, lobby, running, ended — and
 * this screen used to show the same panels at every one of them. The lobby
 * step had no button at all: sessions were created as drafts, Coders are never
 * shown drafts, and nothing moved a draft on, so no Coder ever saw a ready
 * button. Each step now names itself and offers the one action that moves it
 * forward.
 *
 * Start is never disabled. The SRS is explicit that an Architect may begin a
 * session with participants missing — a Coder who never turned up should not
 * hold up a lab of thirty — so the screen's job is the warning and the names,
 * not the block.
 */

/** Socket deltas arrive in bursts; one re-read per burst is plenty. */
const REFRESH_DEBOUNCE_MS = 400;

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const session = useSession(sessionId);
  const live = useMonitorSocket({ sessionId });

  /** The socket is the fresher of the two; the query is what covers a dropped one. */
  const status: AssessmentSessionStatus | null =
    live.sessionState?.status ?? session.data?.status ?? null;
  const editable = status === "DRAFT" || status === "READY";
  /** A finished session's readiness cannot change, so stop asking about it. */
  const stillLive = status === null || editable || status === "RUNNING";
  const readiness = useReadiness(sessionId, stillLive);

  // Every lobby change — someone ready, someone gone, someone on another page —
  // is a reason to re-read the board, which is the one place that knows names.
  const refetchReadiness = readiness.refetch;
  const refetchSession = session.refetch;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (live.sessionState === null && live.participants.size === 0) return;
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refetchReadiness();
    }, REFRESH_DEBOUNCE_MS);
  }, [live.participants, live.sessionState, refetchReadiness]);
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    },
    [],
  );
  const liveStatus = live.sessionState?.status;
  useEffect(() => {
    if (liveStatus !== undefined) void refetchSession();
  }, [liveStatus, refetchSession]);

  const [warning, setWarning] = useState<SessionCounts | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"END" | "DELETE" | null>(null);
  const start = useStartSession(sessionId);
  const end = useEndSession(sessionId);
  const update = useUpdateSession(sessionId);
  const remove = useDeleteSession(sessionId, session.data?.assessmentId ?? "");

  const counts = live.sessionState?.counts ?? readiness.data?.counts ?? null;
  const participants: ParticipantView[] = useMemo(
    () => readiness.data?.participants ?? [],
    [readiness.data],
  );
  const missing = useMemo(
    () =>
      participants.filter(
        (participant) => participant.onRoster && readinessStateOf(participant) !== "READY",
      ),
    [participants],
  );

  const beginSession = useCallback(
    async (force: boolean) => {
      try {
        const response = await start.mutateAsync({ force });
        if (response.started) {
          setWarning(null);
          toaster.success({ title: "Session started" });
          return;
        }
        // Not an error: the server declined and handed back the numbers so the
        // decision can be made with them in view.
        setWarning(response.warning.counts);
      } catch (error) {
        toaster.error({
          title: "Could not start the session",
          description: isApiError(error) ? error.userMessage : undefined,
        });
      }
    },
    [start],
  );

  async function setLobby(open: boolean) {
    try {
      await update.mutateAsync({ status: open ? "READY" : "DRAFT" });
      toaster.success({
        title: open ? "Lobby open" : "Lobby closed",
        description: open
          ? "Coders can now see this session and say they are ready."
          : "Coders can no longer see this session.",
      });
    } catch (error) {
      toaster.error({
        title: open ? "Could not open the lobby" : "Could not close the lobby",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function setAccess(access: SessionAccess) {
    try {
      await update.mutateAsync({ access });
    } catch (error) {
      toaster.error({
        title: "Could not change who takes part",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function stopSession() {
    try {
      await end.mutateAsync();
      setConfirming(null);
      toaster.success({
        title: "Session ended",
        description: "Open work was submitted and is being graded.",
      });
    } catch (error) {
      toaster.error({
        title: "Could not end the session",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function removeSession(assessmentId: string) {
    try {
      await remove.mutateAsync();
      toaster.success({ title: "Session deleted" });
      router.push(routes.manageAssessment(assessmentId));
    } catch (error) {
      setConfirming(null);
      toaster.error({
        title: "Could not delete the session",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (session.isError) {
    return (
      <PageContainer>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </PageContainer>
    );
  }

  if (session.isPending || session.data === undefined || status === null) {
    return (
      <PageContainer>
        <Skeleton height="24rem" borderRadius="lg" />
      </PageContainer>
    );
  }

  const view = session.data;
  const started = status === "RUNNING" || status === "ENDED";
  const rosterSource = readiness.data?.rosterSource ?? view.rosterSource;
  const cannotStart = rosterSource === "NONE";

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.manageAssessment(view.assessmentId)}>
          <ChevronLeft aria-hidden />
          Back to the assessment
        </NextLink>
      </Button>

      <PageHeader
        title={view.name}
        description={describeSessionRules(view)}
        action={
          // Several controls at their widest. On a narrow window they wrap
          // onto a second line rather than running off the edge of the page.
          <HStack gap="2" wrap="wrap" justify={{ base: "flex-start", sm: "flex-end" }}>
            <Badge tone={SESSION_STATUS_TONE[status]}>{SESSION_STATUS_LABEL[status]}</Badge>
            {editable ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Settings aria-hidden />
                Settings
              </Button>
            ) : null}
            {status === "RUNNING" || status === "ENDED" ? (
              <Button asChild variant="outline" size="sm">
                <NextLink href={routes.manageSessionMonitor(sessionId)}>
                  <MonitorPlay aria-hidden />
                  Monitor
                </NextLink>
              </Button>
            ) : null}
            {status === "RUNNING" ? (
              <Button size="sm" colorPalette="danger" onClick={() => setConfirming("END")}>
                <Square aria-hidden />
                End session
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                colorPalette="danger"
                onClick={() => setConfirming("DELETE")}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
            {status === "DRAFT" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void setLobby(true)}
                loading={update.isPending}
              >
                <DoorOpen aria-hidden />
                Open lobby
              </Button>
            ) : null}
            {status === "READY" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void setLobby(false)}
                loading={update.isPending}
              >
                <DoorClosed aria-hidden />
                Close lobby
              </Button>
            ) : null}
            {editable ? (
              <Button
                size="sm"
                onClick={() => void beginSession(false)}
                loading={start.isPending}
                disabled={cannotStart}
              >
                <Play aria-hidden />
                Start session
              </Button>
            ) : null}
          </HStack>
        }
      />

      <Stack gap="6">
        <LifecycleSteps status={status} />

        <StepNotice view={view} status={status} cannotStart={cannotStart} />

        {status === "ENDED" || status === "CANCELLED" ? null : (
          <Panel title={started ? "Who is here" : "Readiness"}>
            {counts === null || readiness.data === undefined ? (
              <Skeleton height="6rem" />
            ) : (
              <Stack gap="4">
                {started ? null : <ReadinessBoard counts={counts} />}
                {editable && counts.total > 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    {everyoneReady(counts)
                      ? "Everyone is ready."
                      : view.requireAllReady || view.executionMode === "LIVE"
                        ? "Start waits until everyone is ready. You can still start early."
                        : "Start does not wait for anyone. Readiness only shows who is here."}
                  </Text>
                ) : null}
                <ParticipantRoster
                  participants={participants}
                  rosterSource={rosterSource}
                  started={started}
                />
              </Stack>
            )}
          </Panel>
        )}

        {editable ? (
          <Panel title="Who takes part">
            <Stack gap="5">
              <AccessChoice
                value={view.access}
                onChange={(access) => void setAccess(access)}
                disabled={update.isPending}
              />
              {view.access === "LISTED" ? (
                readiness.data === undefined ? (
                  <Skeleton height="12rem" />
                ) : (
                  <ParticipantPicker
                    sessionId={sessionId}
                    moduleId={view.moduleId}
                    participants={participants}
                  />
                )
              ) : null}
            </Stack>
          </Panel>
        ) : null}
      </Stack>

      {editing ? (
        <SessionSettingsDialog mode="edit" session={view} onClose={() => setEditing(false)} />
      ) : null}

      <ConfirmDialog
        open={confirming === "END"}
        title="End this session?"
        description="Everyone still working is submitted from their last saved code and graded. Nobody can join or submit afterwards."
        confirmLabel="End session"
        destructive
        loading={end.isPending}
        onConfirm={() => void stopSession()}
        onClose={() => setConfirming(null)}
      />

      {confirming === "DELETE" ? (
        <DeleteSessionDialog
          view={view}
          loading={remove.isPending}
          onConfirm={() => void removeSession(view.assessmentId)}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      <StartAnywayDialog
        counts={warning}
        missing={missing}
        live={view.executionMode === "LIVE"}
        loading={start.isPending}
        onConfirm={() => void beginSession(true)}
        onClose={() => setWarning(null)}
      />
    </PageContainer>
  );
}

const STEPS: readonly { label: string; statuses: readonly AssessmentSessionStatus[] }[] = [
  { label: "Set up", statuses: ["DRAFT"] },
  { label: "Lobby open", statuses: ["READY"] },
  { label: "Running", statuses: ["RUNNING"] },
  { label: "Ended", statuses: ["ENDED", "CANCELLED"] },
];

/** Where in its life this session is, so the next step is never a guess. */
function LifecycleSteps({ status }: { status: AssessmentSessionStatus }) {
  const current = STEPS.findIndex((step) => step.statuses.includes(status));
  return (
    <HStack as="ol" gap="2" wrap="wrap" aria-label="Session progress">
      {STEPS.map((step, index) => (
        <HStack as="li" key={step.label} gap="2" listStyleType="none">
          <Badge
            tone={index === current ? "accent" : index < current ? "success" : "neutral"}
            plain={index !== current}
            aria-current={index === current ? "step" : undefined}
          >
            {String(index + 1)}. {step.label}
          </Badge>
          {index < STEPS.length - 1 ? (
            <Text fontSize="xs" color="fg.subtle" aria-hidden>
              →
            </Text>
          ) : null}
        </HStack>
      ))}
    </HStack>
  );
}

/** The one thing this step needs from the Architect, said once at the top. */
function StepNotice({
  view,
  status,
  cannotStart,
}: {
  view: SessionView;
  status: AssessmentSessionStatus;
  cannotStart: boolean;
}) {
  let tone: "info" | "warning" = "info";
  let message: string | null = null;
  if (cannotStart && (status === "DRAFT" || status === "READY")) {
    tone = "warning";
    message =
      "Nobody can take part yet. Choose participants below, or let everyone enrolled take part.";
  } else if (status === "DRAFT") {
    message =
      "Coders cannot see this session yet. Open the lobby so they can find it on the assessment page and say they are ready — or start it straight away.";
  } else if (status === "READY") {
    message =
      view.executionMode === "LIVE"
        ? "Coders waiting in the lobby are taken into the exam the moment you start."
        : "Coders in the lobby get a Start button the moment you start. Each one's own timer begins when they press it.";
  } else if (status === "RUNNING") {
    message = "This session is running. Follow attempts and events on the monitor.";
  } else if (status === "ENDED") {
    message =
      "This session has ended. The monitor keeps its history, and its scores are in the grading records.";
  }
  if (message === null) return null;

  return (
    <Alert.Root status={tone} size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack
      gap="4"
      {...pixelSkin("var(--amb-colors-border-default)", "var(--amb-colors-bg-surface)")}
      padding="5"
    >
      <Text textStyle="display">{title}</Text>
      <Box>{children}</Box>
    </Stack>
  );
}

/**
 * Deleting takes the session's Submissions and grades with it, so the dialog
 * says exactly how many, and asks for a deliberate tick when there are any.
 *
 * It used to ask for the session's name to be typed out. That failed on the
 * smallest difference — a doubled space the label rendered as one, a capital
 * letter — and left the Delete button greyed out with no reason given. A
 * checkbox beside the real numbers is just as hard to hit by accident, and
 * cannot be got wrong.
 */
function DeleteSessionDialog({
  view,
  loading,
  onConfirm,
  onClose,
}: {
  view: SessionView;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const hasWork = view.attemptCount > 0 || view.submissionCount > 0;
  const plural = (count: number, word: string) =>
    `${String(count)} ${word}${count === 1 ? "" : "s"}`;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="Delete this session?"
      description={
        hasWork
          ? `This deletes ${plural(view.attemptCount, "attempt")} and ${plural(view.submissionCount, "submission")}, with their grades. They drop out of the grading records and leaderboards. This cannot be undone.`
          : "Nobody has taken part yet, so only the session and its settings are removed."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            colorPalette="danger"
            onClick={onConfirm}
            disabled={hasWork && !understood}
            loading={loading}
            autoFocus={!hasWork}
          >
            Delete session
          </Button>
        </>
      }
    >
      {hasWork ? (
        <Checkbox.Root
          checked={understood}
          onCheckedChange={(details) => setUnderstood(details.checked === true)}
          colorPalette="danger"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>I understand this work is deleted for good</Checkbox.Label>
        </Checkbox.Root>
      ) : null}
    </Modal>
  );
}

/**
 * The warning, with the names rather than only the numbers.
 *
 * "2 not ready" is not enough to decide on: an Architect needs to know whether
 * the two are the Coders who are ill today or the two sitting in the front row
 * whose machines will not connect.
 */
function StartAnywayDialog({
  counts,
  missing,
  live,
  loading,
  onConfirm,
  onClose,
}: {
  counts: SessionCounts | null;
  missing: ParticipantView[];
  live: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const reason = (participant: ParticipantView) => {
    switch (readinessStateOf(participant)) {
      case "OFFLINE":
        return "Offline";
      case "ELSEWHERE":
        return "Online, not on the page";
      default:
        return "Not ready";
    }
  };

  return (
    <Modal
      open={counts !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="Not all participants are ready"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={loading} autoFocus>
            Start anyway
          </Button>
        </>
      }
    >
      <Stack gap="3">
        {counts === null ? null : <ReadinessBoard counts={counts} />}

        {missing.length === 0 ? null : (
          <Stack gap="1">
            <Text fontSize="sm" fontWeight="medium">
              Not ready
            </Text>
            <Stack gap="1" maxHeight="12rem" overflowY="auto">
              {missing.map((participant) => (
                <HStack key={participant.userId} justify="space-between" gap="3">
                  <Text fontSize="sm" truncate>
                    {participant.displayName}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {reason(participant)}
                  </Text>
                </HStack>
              ))}
            </Stack>
          </Stack>
        )}

        <Text fontSize="sm" color="fg.muted">
          {live
            ? "Starting begins the shared clock for everyone. Anyone who joins later gets only the time that is left."
            : "Anyone not ready can still join once it has started, and their own timer begins when they press Start."}
        </Text>
      </Stack>
    </Modal>
  );
}
