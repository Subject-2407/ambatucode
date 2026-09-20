"use client";

import { useCallback, useMemo, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, MonitorPlay, Play, Square, Trash2 } from "lucide-react";
import {
  everyoneReady,
  type ParticipantView,
  type SessionCounts,
  type SessionView,
} from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ParticipantPicker } from "@/components/monitor/participant-picker";
import {
  ParticipantRoster,
  ReadinessBoard,
  participantState,
} from "@/components/monitor/readiness-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useEnrollments } from "@/hooks/use-enrollments";
import { useMonitorSocket } from "@/hooks/use-monitor-socket";
import {
  useDeleteSession,
  useEndSession,
  useReadiness,
  useSession,
  useStartSession,
} from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * Session control: who takes part, who is ready, and starting.
 *
 * Start is never disabled. The SRS is explicit that an Architect may begin a
 * session with participants missing — a Coder who never turned up should not
 * hold up a lab of thirty — so the screen's job is the warning and the names,
 * not the block.
 */
export function SessionScreen({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const editable = session.data?.status === "DRAFT" || session.data?.status === "READY";
  /** A finished session's readiness cannot change, so stop asking about it. */
  const stillLive =
    session.data === undefined ||
    session.data.status === "DRAFT" ||
    session.data.status === "READY" ||
    session.data.status === "RUNNING";
  const readiness = useReadiness(sessionId, stillLive);
  const live = useMonitorSocket({ sessionId });

  // The module id arrives with the session, so this waits rather than asking
  // for an enrollment list under an empty id.
  const enrollments = useEnrollments(
    session.data?.moduleId ?? "",
    { page: 1, pageSize: 100, status: "APPROVED" },
    editable,
  );

  const [warning, setWarning] = useState<SessionCounts | null>(null);
  const start = useStartSession(sessionId);
  const end = useEndSession(sessionId);
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useDeleteSession(sessionId, session.data?.assessmentId ?? "");

  /** The socket is the fresher of the two; the poll is what covers a dropped one. */
  const counts = live.sessionState?.counts ?? readiness.data?.counts ?? null;
  const status = live.sessionState?.status ?? session.data?.status ?? null;

  const participants: ParticipantView[] = useMemo(
    () => readiness.data?.participants ?? [],
    [readiness.data],
  );

  const missing = useMemo(
    () => participants.filter((p) => p.isListed && participantState(p) !== "READY"),
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

  async function stopSession() {
    try {
      await end.mutateAsync();
      toaster.success({ title: "Session ended" });
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
      setConfirmingDelete(false);
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

  if (session.isPending || session.data === undefined) {
    return (
      <PageContainer>
        <Skeleton height="24rem" borderRadius="lg" />
      </PageContainer>
    );
  }

  const view = session.data;

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
        description={describeSession(view)}
        action={
          <HStack gap="2">
            <Badge tone={status === "RUNNING" ? "success" : "neutral"}>{status ?? "DRAFT"}</Badge>
            {status === "RUNNING" ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <NextLink href={routes.manageSessionMonitor(sessionId)}>
                    <MonitorPlay aria-hidden />
                    Monitor
                  </NextLink>
                </Button>
                <Button
                  size="sm"
                  colorPalette="danger"
                  onClick={() => void stopSession()}
                  loading={end.isPending}
                >
                  <Square aria-hidden />
                  End session
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  colorPalette="danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
                {editable ? (
                  <Button
                    size="sm"
                    onClick={() => void beginSession(false)}
                    loading={start.isPending}
                  >
                    <Play aria-hidden />
                    Start session
                  </Button>
                ) : null}
              </>
            )}
          </HStack>
        }
      />

      <Stack gap="6">
        <Panel title="Readiness">
          {counts === null ? (
            <Skeleton height="2rem" />
          ) : (
            <Stack gap="4">
              <ReadinessBoard counts={counts} />
              {counts.total > 0 && !everyoneReady(counts) && editable ? (
                <Text fontSize="sm" color="fg.muted">
                  You can start anyway. Anyone who joins later picks up the session where it is.
                </Text>
              ) : null}
              <ParticipantRoster participants={participants} />
            </Stack>
          )}
        </Panel>

        <Panel title="Participants">
          <ParticipantPicker
            sessionId={sessionId}
            enrolled={enrollments.data?.items ?? []}
            participants={participants}
            disabled={!editable}
          />
        </Panel>
      </Stack>

      {editable ? (
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this session?"
          description="The session and its participant list are removed. This cannot be undone."
          confirmLabel="Delete session"
          destructive
          loading={remove.isPending}
          onConfirm={() => void removeSession(view.assessmentId)}
          onClose={() => setConfirmingDelete(false)}
        />
      ) : confirmingDelete ? (
        <DeleteSessionDialog
          name={view.name}
          loading={remove.isPending}
          onConfirm={() => void removeSession(view.assessmentId)}
          onClose={() => setConfirmingDelete(false)}
        />
      ) : null}

      <StartAnywayDialog
        counts={warning}
        missing={missing}
        loading={start.isPending}
        onConfirm={() => void beginSession(true)}
        onClose={() => setWarning(null)}
      />
    </PageContainer>
  );
}

function describeSession(view: SessionView): string {
  const timing =
    view.executionMode === null
      ? "Untimed"
      : `${view.executionMode === "LIVE" ? "Live" : "Individual"} · ${String(view.durationMinutes ?? 0)} minutes`;
  const scope = view.isRestricted
    ? `${String(view.listedParticipantCount)} listed participants`
    : "open to every enrolled Coder";
  return `${timing} · ${scope}`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack
      gap="4"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
      padding="5"
    >
      <Text textStyle="display">{title}</Text>
      <Box>{children}</Box>
    </Stack>
  );
}

/**
 * Deleting a finished session takes its Submissions and grades with it, so the
 * Architect types the session's name: a stray double click cannot confirm it.
 *
 * Mounted only while open, so a cancelled dialog leaves no typed text behind.
 */
function DeleteSessionDialog({
  name,
  loading,
  onConfirm,
  onClose,
}: {
  name: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === name.trim();

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="Delete this session?"
      description="Every attempt, submission and grade recorded in this session is deleted with it, and it drops out of grades and leaderboards. This cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button colorPalette="danger" onClick={onConfirm} disabled={!matches} loading={loading}>
            Delete session
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !loading) onConfirm();
        }}
      >
        <TextField
          label={`Type "${name}" to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          autoFocus
        />
      </form>
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
  loading,
  onConfirm,
  onClose,
}: {
  counts: SessionCounts | null;
  missing: ParticipantView[];
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={counts !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="Not all selected participants are ready"
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
                    {participant.connectionState === "OFFLINE" ? "Offline" : "Not ready"}
                  </Text>
                </HStack>
              ))}
            </Stack>
          </Stack>
        )}

        <Text fontSize="sm" color="fg.muted">
          Starting begins the clock for everyone. Participants who connect afterwards get the time
          that is left.
        </Text>
      </Stack>
    </Modal>
  );
}
