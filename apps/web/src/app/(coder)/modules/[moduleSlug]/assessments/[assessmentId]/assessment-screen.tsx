"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Grid, HStack, List, Stack, Text } from "@chakra-ui/react";
import { CalendarClock, DoorOpen, Play, RotateCcw, ShieldCheck, Users } from "lucide-react";
import type { AssessmentCoderView, AttemptView, CoderSessionEntry } from "@ambatucode/shared";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { ProblemPanel } from "@/components/assessment/problem-panel";
import { SessionLobby } from "@/components/assessment/session-lobby";
import { TimingBadge } from "@/components/assessment/timing-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { toaster } from "@/components/ui/toaster";
import { apiClient, isApiError } from "@/lib/api-client";
import { describeAttemptRules } from "@/lib/attempt-rules";
import { formatDateTime } from "@/lib/format-date";
import { routes } from "@/lib/routes";

/**
 * The Assessment as a Coder meets it: what it is, how it is timed, and the
 * ways in.
 *
 * Two columns, because they answer different questions. The left is what the
 * problem asks, which is read; the right is how to sit it, which is acted on.
 * Stacked, the ways in sat below however long the statement happened to be, so
 * the Start button on a two-page problem was somewhere off the bottom of the
 * screen.
 *
 * There are two kinds of way in. A scheduled session is started by an
 * Architect and a Coder waits for it. An open-access assessment has no
 * schedule at all: it is one button, always there, and the attempt rules behind
 * it are exactly the same as everywhere else.
 *
 * Starting is always an explicit act. For an Individual session the click is
 * what starts that Coder's clock, so nothing here begins an attempt on the
 * Coder's behalf — with the single exception of a Live session, where the
 * Architect's Start is the beginning and waiting for a second click would only
 * cost the Coder time from a clock that is already running.
 */
export function AssessmentScreen({ assessment }: { assessment: AssessmentCoderView }) {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);
  /** A timed start waiting on the Coder's confirmation. */
  const [confirming, setConfirming] = useState<CoderSessionEntry | null>(null);

  const enterSession = useCallback(
    async (sessionId: string) => {
      setStarting(sessionId);
      try {
        const attempt = await apiClient.post<AttemptView>(
          `/api/sessions/${sessionId}/attempt/start`,
        );
        router.push(routes.attempt(attempt.id));
      } catch (error) {
        setStarting(null);
        toaster.error({
          title: "Could not start",
          description: isApiError(error) ? error.userMessage : "Please try again.",
        });
      }
    },
    [router],
  );

  /**
   * Starting an Individual clock is the one click here that cannot be taken
   * back, so it is asked about. Continuing is not — that clock is already
   * running — and neither is a Live session, whose clock started when the
   * Architect pressed Start: a dialog there would only cost the Coder time.
   */
  const requestEnter = useCallback(
    (session: CoderSessionEntry) => {
      const resuming = session.attempt?.status === "IN_PROGRESS";
      const startsOwnClock = session.durationMinutes !== null && session.executionMode !== "LIVE";
      if (!resuming && startsOwnClock) {
        setConfirming(session);
        return;
      }
      void enterSession(session.id);
    },
    [enterSession],
  );

  const openAccess = assessment.sessions.find((session) => session.isOpenAccess) ?? null;
  const scheduled = assessment.sessions.filter((session) => !session.isOpenAccess);
  const rules = describeAttemptRules({
    executionMode: assessment.executionMode,
    exitPolicy: assessment.exitPolicy,
    antiCheat: assessment.antiCheat,
  });

  return (
    <Grid
      templateColumns={{ base: "1fr", lg: "minmax(0, 1.4fr) minmax(0, 1fr)" }}
      gap="6"
      alignItems="start"
    >
      <Stack gap="3" minWidth="0">
        <HStack gap="2" wrap="wrap">
          <TimingBadge
            durationMinutes={assessment.timeMode === "UNTIMED" ? null : assessment.durationMinutes}
            executionMode={assessment.executionMode}
          />
          {openAccess ? (
            <Badge tone="success">
              <DoorOpen size={12} aria-hidden /> Open access
            </Badge>
          ) : null}
          {/* One muted line rather than a badge per language: they are a
              fact to note, not four statuses to read. */}
          <Text fontSize="xs" color="fg.muted">
            {assessment.allowedLanguages.map((language) => LANGUAGE_LABEL[language]).join(" · ")}
          </Text>
        </HStack>

        <PixelFrame>
          <ProblemPanel
            title={assessment.title}
            problemStatement={assessment.problemStatement}
            sampleCases={assessment.sampleCases}
          />
        </PixelFrame>
      </Stack>

      <Stack gap="6" minWidth="0">
        {openAccess ? (
          <OpenAccessPanel
            session={openAccess}
            starting={starting === openAccess.id}
            onEnter={() => requestEnter(openAccess)}
          />
        ) : null}

        {/* Said before Start, not after. The workspace names these too, but
            by then a timed clock is already running. */}
        <RulesPanel rules={rules} />

        {/* An open-access Assessment with nothing scheduled has one way in,
            and it is the panel above. A "Sessions" heading over an empty
            state only announced an absence. */}
        {openAccess && scheduled.length === 0 ? null : (
          <Stack gap="3">
            <Text textStyle="display" fontSize="sm">
              Sessions
            </Text>
            {scheduled.length === 0 ? (
              <EmptyState
                sprite="calendar"
                title="No session yet"
                description="Your Architect has not scheduled a session of this assessment for you."
              />
            ) : (
              scheduled.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  starting={starting === session.id}
                  onEnter={() => requestEnter(session)}
                />
              ))
            )}
          </Stack>
        )}
      </Stack>

      <ConfirmDialog
        open={confirming !== null}
        title="Start the timer?"
        description={
          confirming?.durationMinutes == null
            ? null
            : `Your ${String(confirming.durationMinutes)}-minute timer starts as soon as the workspace opens. It pauses only if you disconnect.`
        }
        confirmLabel="Start"
        onConfirm={() => {
          const session = confirming;
          setConfirming(null);
          if (session) void enterSession(session.id);
        }}
        onClose={() => setConfirming(null)}
      />
    </Grid>
  );
}

function RulesPanel({ rules }: { rules: readonly string[] }) {
  return (
    <PixelFrame tone="muted" pad="4">
      <Stack gap="2">
        <HStack gap="2">
          <ShieldCheck size={16} aria-hidden />
          <Text textStyle="display" fontSize="xs">
            Before you start
          </Text>
        </HStack>
        <List.Root gap="1" ps="5" fontSize="sm" color="fg.muted">
          {rules.map((rule) => (
            <List.Item key={rule}>{rule}</List.Item>
          ))}
        </List.Root>
      </Stack>
    </PixelFrame>
  );
}

/** "Closes 21 Sept 2026, 17:00", or nothing when the session has no limit. */
function ClosingLine({ session }: { session: CoderSessionEntry }) {
  const closing = session.status === "RUNNING" ? session.endsAt : session.closesAt;
  if (closing === null) return null;

  return (
    <HStack gap="2" color="fg.warning">
      <CalendarClock size={14} aria-hidden />
      <Text fontSize="xs">
        Closes {formatDateTime(closing)}. Open work is submitted automatically then.
      </Text>
    </HStack>
  );
}

/**
 * The way in when there is no schedule.
 *
 * It is deliberately not a session card. A session card exists to answer "has
 * it started, am I on the list, how long do I wait" — none of which apply
 * here, and showing those answers greyed out would invent a wait that does not
 * exist. What a Coder needs to know is that the attempt is theirs to spend.
 */
function OpenAccessPanel({
  session,
  starting,
  onEnter,
}: {
  session: CoderSessionEntry;
  starting: boolean;
  onEnter: () => void;
}) {
  const attempt = session.attempt;
  const inProgress = attempt?.status === "IN_PROGRESS";
  const submitted = attempt?.status === "SUBMITTED";
  const expired = attempt?.status === "EXPIRED";

  return (
    <PixelFrame tone="accent" pad="5">
      <Stack gap="3">
        <Stack gap="1" minWidth="0">
          <Text textStyle="display" fontSize="md">
            Start whenever you are ready
          </Text>
          {/* Only when there is a clock to warn about. An untimed open
              assessment has nothing here a Coder has to read before pressing
              Start, and the sentence that used to sit here said so at length. */}
          {session.durationMinutes === null ? null : (
            <Text fontSize="sm" color="fg.muted">
              {`Your ${String(session.durationMinutes)}-minute timer starts the moment you begin.`}
            </Text>
          )}
        </Stack>

        {/* The action on its own row rather than beside the text. In a column
            this narrow a `justify="space-between"` pair collapsed into a button
            squeezed against the panel's edge. */}
        {session.canStart ? (
          <Button onClick={onEnter} loading={starting} loadingText="Opening" alignSelf="start">
            <Play aria-hidden />
            {inProgress ? "Continue" : session.isGrantedRetake ? "Start your new attempt" : "Start"}
          </Button>
        ) : (
          <HStack gap="2">
            <SessionStatusBadge session={session} />
          </HStack>
        )}

        {session.isGrantedRetake ? (
          <RetakeNote />
        ) : submitted ? (
          <Text fontSize="sm" color="fg.muted">
            You have submitted this attempt. Your Architect may reset it if a new attempt is needed.
          </Text>
        ) : expired ? (
          <Text fontSize="sm" color="fg.muted">
            This attempt closed at its deadline.
          </Text>
        ) : null}
      </Stack>
    </PixelFrame>
  );
}

/**
 * Why there is a Start button on an exam that is over.
 *
 * Without it the card contradicts itself — "Ended" beside "Start" — and a
 * Coder who has just been given a second chance is the last person who should
 * have to guess whether clicking it is allowed.
 */
function RetakeNote() {
  return (
    <HStack gap="2" align="start" color="fg.success">
      <RotateCcw size={14} aria-hidden />
      <Text fontSize="sm">Your Architect opened a new attempt for you.</Text>
    </HStack>
  );
}

/**
 * One session and the single action that applies to it.
 *
 * There is deliberately one button, never a row of them: a Coder looking at an
 * exam they are about to sit should not have to work out which of three
 * controls is the right one.
 */
function SessionCard({
  session,
  starting,
  onEnter,
}: {
  session: CoderSessionEntry;
  starting: boolean;
  onEnter: () => void;
}) {
  const attempt = session.attempt;
  const inProgress = attempt?.status === "IN_PROGRESS";
  const finished = attempt?.status === "SUBMITTED" || attempt?.status === "EXPIRED";
  const waiting = session.status === "DRAFT" || session.status === "READY";

  return (
    <PixelFrame tone={session.isGrantedRetake ? "success" : "default"} pad="4">
      <Stack gap="3">
        <Stack gap="1" minWidth="0">
          <HStack gap="2" minWidth="0" wrap="wrap">
            <Text fontWeight="medium" truncate>
              {session.name}
            </Text>
            {/* Worth saying out loud: it is the difference between "I may be
                able to join this" and "this one is mine to join". */}
            {session.openToModule ? (
              <Badge tone="info" size="sm">
                <Users size={12} aria-hidden /> Open to the module
              </Badge>
            ) : null}
          </HStack>
          <Box>
            <TimingBadge
              durationMinutes={session.durationMinutes}
              executionMode={session.executionMode}
              size="sm"
            />
          </Box>
        </Stack>

        <ClosingLine session={session} />

        <HStack gap="3" wrap="wrap">
          <SessionStatusBadge session={session} />
          {session.canStart ? (
            <Button size="sm" onClick={onEnter} loading={starting} loadingText="Opening">
              <Play aria-hidden />
              {inProgress
                ? "Continue"
                : session.isGrantedRetake
                  ? "Start your new attempt"
                  : "Start"}
            </Button>
          ) : null}
        </HStack>

        {session.isGrantedRetake ? (
          <RetakeNote />
        ) : finished ? (
          <Text fontSize="sm" color="fg.muted">
            {attempt?.status === "SUBMITTED"
              ? "You have submitted this attempt. Your Architect may reset it if a new attempt is needed."
              : "This attempt closed at its deadline."}
          </Text>
        ) : null}

        {/* The lobby is for whoever the Architect listed, in any mode. Readiness
            is counted over that list, so a Coder who walked into an open
            session would be flipping a switch nothing reads — they get the
            plain wait instead. */}
        {waiting && session.isListed ? (
          <SessionLobby
            sessionId={session.id}
            requireAllReady={session.requireAllReady}
            // Live only. Everywhere else the Coder's click is what starts
            // their own clock, and the lobby must not spend it for them.
            autoEnter={session.executionMode === "LIVE"}
          />
        ) : waiting ? (
          <Text fontSize="sm" color="fg.muted">
            This session has not been started by your Architect yet.
          </Text>
        ) : null}
      </Stack>
    </PixelFrame>
  );
}

function SessionStatusBadge({ session }: { session: CoderSessionEntry }) {
  // A granted retake outranks the session's own status: the Coder's answer to
  // "can I sit this" is yes, whatever the exam around it says.
  if (session.isGrantedRetake) return <Badge tone="success">New attempt open</Badge>;
  if (session.attempt?.status === "SUBMITTED") return <Badge tone="success">Submitted</Badge>;
  // "Expired", not "Closed": Closed already names a Module you have to ask to
  // join, and one word for two things made both harder to read.
  if (session.attempt?.status === "EXPIRED") return <Badge tone="warning">Expired</Badge>;

  switch (session.status) {
    case "RUNNING":
      return <Badge tone="info">Running</Badge>;
    case "ENDED":
      return <Badge tone="neutral">Ended</Badge>;
    case "CANCELLED":
      return <Badge tone="neutral">Cancelled</Badge>;
    default:
      return <Badge tone="neutral">Not started</Badge>;
  }
}
