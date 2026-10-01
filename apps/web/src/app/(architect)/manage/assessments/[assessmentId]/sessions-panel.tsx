"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight, DoorOpen, Plus } from "lucide-react";
import type { AssessmentArchitectView, SessionView } from "@ambatucode/shared";
import { SessionSettingsDialog } from "@/components/sessions/session-settings-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessions } from "@/hooks/use-sessions";
import { routes } from "@/lib/routes";
import {
  SESSION_STATUS_LABEL,
  SESSION_STATUS_TONE,
  describeSessionRules,
} from "@/lib/session-copy";
import { pixelSkin } from "@/theme/pixel";

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
  const router = useRouter();

  return (
    <Stack gap="3">
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Stack gap="0">
          <Text textStyle="display">Sessions</Text>
          <Text fontSize="xs" color="fg.muted">
            Each session runs this assessment for one group.
          </Text>
        </Stack>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          New session
        </Button>
      </HStack>

      {assessment.isOpenAccess && assessment.openAccessSessionId !== null ? (
        <OpenAccessRow sessionId={assessment.openAccessSessionId} />
      ) : null}

      {isPending ? (
        <Skeleton height="6rem" borderRadius="lg" />
      ) : isError || data === undefined ? (
        <Text fontSize="sm" color="fg.muted">
          Sessions could not be loaded.
        </Text>
      ) : data.length === 0 ? (
        <EmptyState
          sprite="calendar"
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
        <SessionSettingsDialog
          mode="create"
          assessment={assessment}
          onClose={() => setCreating(false)}
          // Straight to the new session: who takes part, the lobby and Start
          // all live there, and they are the next thing to do.
          onCreated={(session) => router.push(routes.manageSession(session.id))}
        />
      ) : null}
    </Stack>
  );
}

/**
 * The open-access session, which is not one of the sessions above.
 *
 * It has no Start, no End, and no participant list, so it gets no controls —
 * only the way in to its monitor, which is where the Coders sitting it right
 * now, and the code they are writing, actually are. It is switched off in the
 * assessment's Timing tab, where it was switched on.
 */
function OpenAccessRow({ sessionId }: { sessionId: string }) {
  return (
    <HStack
      asChild
      justify="space-between"
      gap="3"
      {...pixelSkin("var(--amb-colors-accent-solid)", "var(--amb-colors-bg-surface)", 2)}
      px="4"
      py="3"
      _hover={{ _before: { background: "var(--amb-colors-bg-subtle)" } }}
    >
      <NextLink href={routes.manageSessionMonitor(sessionId)}>
        <Stack gap="1" minWidth="0">
          <HStack gap="2">
            <DoorOpen size={14} aria-hidden />
            <Text truncate>Open access</Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Any enrolled Coder may start this at any time · monitor them here
          </Text>
        </Stack>
        <HStack gap="3">
          <Badge tone="success">OPEN</Badge>
          <ChevronRight size={16} aria-hidden />
        </HStack>
      </NextLink>
    </HStack>
  );
}

function SessionRow({ session }: { session: SessionView }) {
  return (
    <HStack
      asChild
      justify="space-between"
      gap="3"
      {...pixelSkin("var(--amb-colors-border-default)", "var(--amb-colors-bg-surface)", 2)}
      px="4"
      py="3"
      _hover={{
        background: "var(--amb-colors-accent-solid)",
        _before: { background: "var(--amb-colors-bg-subtle)" },
      }}
    >
      <NextLink href={routes.manageSession(session.id)}>
        <Stack gap="1" minWidth="0">
          <Text truncate>{session.name}</Text>
          <Text fontSize="xs" color="fg.muted">
            {describeSessionRules(session)}
          </Text>
        </Stack>
        <HStack gap="3" flexShrink="0">
          {session.submissionCount > 0 ? (
            <Text fontSize="xs" color="fg.muted" textStyle="data">
              {session.submissionCount} submitted
            </Text>
          ) : null}
          <Badge tone={SESSION_STATUS_TONE[session.status]}>
            {SESSION_STATUS_LABEL[session.status]}
          </Badge>
          <ChevronRight size={16} aria-hidden />
        </HStack>
      </NextLink>
    </HStack>
  );
}
