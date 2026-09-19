"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { Play, Timer } from "lucide-react";
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
import { toaster } from "@/components/ui/toaster";
import { apiClient, isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The Assessment as a Coder meets it: what it is, how it is timed, and the
 * sessions they may take part in.
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

  return (
    <Stack gap="8">
      <Stack gap="3">
        <HStack gap="2" wrap="wrap">
          <TimingBadge
            timeMode={assessment.timeMode}
            durationMinutes={assessment.durationMinutes}
            executionMode={assessment.executionMode}
          />
          {assessment.allowedLanguages.map((language) => (
            <Badge key={language} tone="neutral">
              {LANGUAGE_LABEL[language]}
            </Badge>
          ))}
        </HStack>

        <Stack
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="lg"
          bg="bg.surface"
          gap="0"
        >
          <ProblemPanel
            title={assessment.title}
            problemStatement={assessment.problemStatement}
            sampleCases={assessment.sampleCases}
          />
        </Stack>
      </Stack>

      <Stack gap="3">
        <Text textStyle="display">Sessions</Text>
        {assessment.sessions.length === 0 ? (
          <EmptyState
            sprite="calendar"
            title="No session yet"
            description="Your Architect has not scheduled a session of this assessment for you."
          />
        ) : (
          assessment.sessions.map((session) => (
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
    <Stack
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
      padding="4"
      gap="3"
    >
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Stack gap="1" minWidth="0">
          <Text fontWeight="medium" truncate>
            {session.name}
          </Text>
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
