"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { DoorOpen, Play, Timer, Users } from "lucide-react";
import type {
  AssessmentCoderView,
  AttemptView,
  CoderSessionEntry,
  ExecutionMode,
  TimeMode,
} from "@ambatucode/shared";
import { LANGUAGE_LABEL } from "@/components/editor/language-labels";
import { ProblemPanel } from "@/components/assessment/problem-panel";
import { SessionLobby } from "@/components/assessment/session-lobby";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { toaster } from "@/components/ui/toaster";
import { apiClient, isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The Assessment as a Coder meets it: what it is, how it is timed, and the
 * ways in.
 *
 * There are two of those now. A scheduled session is still a session — it is
 * started by an Architect and a Coder waits for it. An open-access assessment
 * has no schedule at all: it is one button, always there, and the attempt
 * rules behind it are exactly the same as everywhere else.
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

  const openAccess = assessment.sessions.find((session) => session.isOpenAccess) ?? null;
  const scheduled = assessment.sessions.filter((session) => !session.isOpenAccess);

  return (
    <Stack gap="8">
      <Stack gap="3">
        <HStack gap="2" wrap="wrap">
          <TimingBadge
            timeMode={assessment.timeMode}
            durationMinutes={assessment.durationMinutes}
            executionMode={assessment.executionMode}
          />
          {openAccess ? (
            <Badge tone="success">
              <DoorOpen size={12} aria-hidden /> Open access
            </Badge>
          ) : null}
          {assessment.allowedLanguages.map((language) => (
            <Badge key={language} tone="neutral">
              {LANGUAGE_LABEL[language]}
            </Badge>
          ))}
        </HStack>

        <PixelFrame>
          <ProblemPanel
            title={assessment.title}
            problemStatement={assessment.problemStatement}
            sampleCases={assessment.sampleCases}
          />
        </PixelFrame>
      </Stack>

      {openAccess ? (
        <OpenAccessPanel
          session={openAccess}
          starting={starting === openAccess.id}
          onEnter={() => void enterSession(openAccess.id)}
        />
      ) : null}

      <Stack gap="3">
        <Text textStyle="display">Sessions</Text>
        {scheduled.length === 0 ? (
          <EmptyState
            sprite="calendar"
            title={openAccess ? "No scheduled session" : "No session yet"}
            description={
              openAccess
                ? "This assessment is open, so you do not need one. Start it above whenever you are ready."
                : "Your Architect has not scheduled a session of this assessment for you."
            }
          />
        ) : (
          scheduled.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              starting={starting === session.id}
              onEnter={() => void enterSession(session.id)}
            />
          ))
        )}
      </Stack>
    </Stack>
  );
}

function TimingBadge({
  timeMode,
  durationMinutes,
  executionMode,
}: {
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
}) {
  if (timeMode === "UNTIMED") return <Badge tone="neutral">Untimed</Badge>;
  return (
    <Badge tone="accent">
      <Timer size={12} aria-hidden /> {durationMinutes} min ·{" "}
      {executionMode === "LIVE" ? "Live" : "Individual"}
    </Badge>
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
        <HStack justify="space-between" gap="3" wrap="wrap" align="start">
          <Stack gap="1" minWidth="0">
            <Text textStyle="display" fontSize="md">
              Start whenever you are ready
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {session.durationMinutes === null
                ? "No deadline. You get one attempt and one formal submission."
                : `Your ${String(session.durationMinutes)}-minute timer starts the moment you begin, and pauses while you are disconnected. You get one attempt and one formal submission.`}
            </Text>
          </Stack>

          {session.canStart ? (
            <Button onClick={onEnter} loading={starting} loadingText="Opening">
              <Play aria-hidden />
              {inProgress ? "Continue" : "Start"}
            </Button>
          ) : (
            <SessionStatusBadge session={session} />
          )}
        </HStack>

        {submitted ? (
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
    <PixelFrame pad="4">
      <Stack gap="3">
        <HStack justify="space-between" gap="3" wrap="wrap">
          <Stack gap="1" minWidth="0">
            <HStack gap="2" minWidth="0">
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
            <Text fontSize="xs" color="fg.muted">
              {session.executionMode === "LIVE"
                ? "Live — everyone shares one timer"
                : session.executionMode === "INDIVIDUAL"
                  ? "Individual — your own timer, paused while you are disconnected"
                  : "Untimed"}
              {session.durationMinutes === null ? "" : ` · ${String(session.durationMinutes)} min`}
            </Text>
          </Stack>

          <HStack gap="3">
            <SessionStatusBadge session={session} />
            {session.canStart ? (
              <Button size="sm" onClick={onEnter} loading={starting} loadingText="Opening">
                <Play aria-hidden />
                {inProgress ? "Continue" : "Start"}
              </Button>
            ) : null}
          </HStack>
        </HStack>

        {finished ? (
          <Text fontSize="sm" color="fg.muted">
            {attempt?.status === "SUBMITTED"
              ? "You have submitted this attempt. Your Architect may reset it if a new attempt is needed."
              : "This attempt closed at its deadline."}
          </Text>
        ) : null}

        {waiting && session.executionMode === "LIVE" ? (
          <SessionLobby sessionId={session.id} />
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
  if (session.attempt?.status === "SUBMITTED") return <Badge tone="success">Submitted</Badge>;
  if (session.attempt?.status === "EXPIRED") return <Badge tone="warning">Closed</Badge>;

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
