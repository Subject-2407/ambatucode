"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { HStack, Stack, Switch, Text } from "@chakra-ui/react";
import type { AttemptView } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { toaster } from "@/components/ui/toaster";
import { useSessionLobby } from "@/hooks/use-session-lobby";
import { apiClient, isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The waiting room for a scheduled Assessment Session.
 *
 * The Coder declares themselves ready; the Architect watches the count and
 * decides when to start. It was a Live-only screen, which left readiness
 * half-built: an Architect could set a session to wait for the room and the
 * Coders in an Individual session had no way to say they were in it.
 *
 * What happens when the Architect starts it depends on the mode, and the
 * difference matters. A Live session's global clock is already running by then,
 * so the Coder is taken straight into the workspace — a button to find would
 * cost them seconds of an exam that has begun without them. Every other mode
 * only reveals the Start button, because there the click is what starts that
 * Coder's own clock, and spending it for them is exactly the thing this product
 * promises not to do.
 */
export function SessionLobby({
  sessionId,
  /** Whether Start actually waits for the count, or only reports it. */
  requireAllReady = false,
  /** Live sessions enter on their own; the rest wait for the Coder's click. */
  autoEnter = false,
}: {
  sessionId: string;
  requireAllReady?: boolean;
  autoEnter?: boolean;
}) {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  const onStarted = useCallback(() => {
    if (!autoEnter) {
      // The card above re-renders with its Start button. Nothing is begun.
      router.refresh();
      return;
    }

    setEntering(true);
    void apiClient
      .post<AttemptView>(`/api/sessions/${sessionId}/attempt/start`)
      .then((attempt) => router.push(routes.attempt(attempt.id)))
      .catch((error: unknown) => {
        setEntering(false);
        toaster.error({
          title: "The session started, but we could not open it",
          description: isApiError(error)
            ? error.userMessage
            : "Reload the page to join the session.",
        });
        // The module page will show the running session; the Coder is not stuck.
        router.refresh();
      });
  }, [autoEnter, router, sessionId]);

  const lobby = useSessionLobby({ sessionId, enabled: true, onStarted });

  return (
    <Stack
      gap="3"
      borderTopWidth="1px"
      borderColor="border.default"
      pt="3"
      aria-busy={entering || undefined}
    >
      <HStack justify="space-between" gap="3" wrap="wrap">
        <Switch.Root
          checked={lobby.ready}
          onCheckedChange={(details) => lobby.setReady(details.checked)}
          colorPalette="accent"
          disabled={entering}
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Label>I am ready</Switch.Label>
        </Switch.Root>

        {lobby.counts === null ? null : (
          <HStack gap="2" aria-live="polite">
            <Badge tone="success">Ready {lobby.counts.ready}</Badge>
            <Badge tone="neutral">Not ready {lobby.counts.notReady}</Badge>
            <Badge tone="warning">Offline {lobby.counts.offline}</Badge>
          </HStack>
        )}
      </HStack>

      <Text fontSize="sm" color="fg.muted" aria-live="polite">
        {entering
          ? "The session has started — opening your workspace…"
          : lobby.problem !== null
            ? lobby.problem
            : requireAllReady
              ? autoEnter
                ? "This session waits until everyone is ready. Once it starts you go straight in, so mark yourself ready and stay on this page."
                : "This session waits until everyone is ready before it starts. Mark yourself ready, and a Start button appears here when it does."
              : autoEnter
                ? "Your Architect starts this session for everyone at once. Stay on this page."
                : "Your Architect opens this session when the group is settled. A Start button appears here when it does, and your own timer begins only when you press it."}
      </Text>

      {/*
        Readiness is per visit, not per account: it says "I am sitting here
        now", which a reloaded page cannot vouch for.
      */}
      <Text fontSize="xs" color="fg.subtle">
        If you reload this page you will need to mark yourself ready again.
      </Text>
    </Stack>
  );
}
