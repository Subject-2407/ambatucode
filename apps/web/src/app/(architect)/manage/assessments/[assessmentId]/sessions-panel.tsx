"use client";

import { useState } from "react";
import NextLink from "next/link";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { CalendarClock, ChevronRight, Plus } from "lucide-react";
import {
  createSessionRequestSchema,
  type AssessmentArchitectView,
  type AssessmentSessionStatus,
  type ExecutionMode,
  type SessionView,
} from "@ambatucode/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useCreateSession, useSessions } from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The Assessment's sessions.
 *
 * A session is where an Assessment actually meets a group of Coders, so it
 * lives beside the editor rather than inside its tabs: editing the problem and
 * running an exam are different jobs, and a tab labelled "Sessions" would
 * suggest they are the same one.
 */
export function SessionsPanel({ assessment }: { assessment: AssessmentArchitectView }) {
  const { data, isPending, isError } = useSessions(assessment.id);
  const [creating, setCreating] = useState(false);

  return (
    <Stack gap="3">
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Stack gap="0">
          <Text fontWeight="semibold">Sessions</Text>
          <Text fontSize="xs" color="fg.muted">
            Each session runs this assessment for one group. Creating a new one never touches the
            results of an old one.
          </Text>
        </Stack>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          New session
        </Button>
      </HStack>

      {isPending ? (
        <Skeleton height="6rem" borderRadius="lg" />
      ) : isError || data === undefined ? (
        <Text fontSize="sm" color="fg.muted">
          Sessions could not be loaded.
        </Text>
      ) : data.length === 0 ? (
        <EmptyState
          icon={<CalendarClock aria-hidden />}
          title="No sessions yet"
          description="Create a session to choose participants and start this assessment."
        />
      ) : (
        <Stack gap="2">
          {data.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </Stack>
      )}

      {creating ? (
        <CreateSessionDialog assessment={assessment} onClose={() => setCreating(false)} />
      ) : null}
    </Stack>
  );
}

const STATUS_TONE: Readonly<Record<AssessmentSessionStatus, BadgeTone>> = {
  DRAFT: "neutral",
  READY: "info",
  RUNNING: "success",
  ENDED: "neutral",
  CANCELLED: "warning",
};

function SessionRow({ session }: { session: SessionView }) {
  return (
    <HStack
      asChild
      justify="space-between"
      gap="3"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="md"
      bg="bg.surface"
      px="4"
      py="3"
      _hover={{ borderColor: "accent.solid", bg: "bg.subtle" }}
    >
      <NextLink href={routes.manageSession(session.id)}>
        <Stack gap="1" minWidth="0">
          <Text truncate>{session.name}</Text>
          <Text fontSize="xs" color="fg.muted">
            {session.executionMode === null
              ? "Untimed"
              : `${session.executionMode === "LIVE" ? "Live" : "Individual"} · ${String(session.durationMinutes ?? 0)} min`}
            {session.isRestricted
              ? ` · ${String(session.listedParticipantCount)} listed`
              : " · open to everyone enrolled"}
          </Text>
        </Stack>
        <HStack gap="3">
          <Badge tone={STATUS_TONE[session.status]}>{session.status}</Badge>
          <ChevronRight size={16} aria-hidden />
        </HStack>
      </NextLink>
    </HStack>
  );
}

/**
 * Timing is inherited from the Assessment and may be overridden here, which is
 * what makes a session reusable: the same problem runs 30 minutes live for one
 * class and 45 minutes individual for another without either edit touching the
 * Assessment itself.
 */
function CreateSessionDialog({
  assessment,
  onClose,
}: {
  assessment: AssessmentArchitectView;
  onClose: () => void;
}) {
  const create = useCreateSession(assessment.id);
  const timed = assessment.timeMode === "TIMED";

  const [name, setName] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    assessment.executionMode ?? "INDIVIDUAL",
  );
  const [durationMinutes, setDurationMinutes] = useState(String(assessment.durationMinutes ?? 30));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const parsed = createSessionRequestSchema.safeParse({
      name,
      // An untimed Assessment only ever produces untimed sessions, and the
      // server refuses timing sent for one rather than ignoring it.
      ...(timed ? { executionMode, durationMinutes: Number.parseInt(durationMinutes, 10) } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields above.");
      return;
    }

    try {
      await create.mutateAsync(parsed.data);
      toaster.success({ title: "Session created" });
      onClose();
    } catch (saveError) {
      setError(isApiError(saveError) ? saveError.userMessage : "Could not create the session.");
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="New session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Class A — Tuesday lab"
          autoFocus
        />

        {timed ? (
          <>
            <SelectField
              label="Execution mode"
              value={executionMode}
              onChange={(value) => setExecutionMode(value as ExecutionMode)}
              options={[
                { value: "INDIVIDUAL", label: "Individual" },
                { value: "LIVE", label: "Live" },
              ]}
            />
            <TextField
              label="Duration (minutes)"
              type="number"
              min={1}
              max={600}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.currentTarget.value)}
              helperText="Defaults to the assessment's own duration."
            />
          </>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            This assessment is untimed, so the session has no timer.
          </Text>
        )}

        {error === null ? null : (
          <Text fontSize="sm" color="fg.error" aria-live="polite">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
