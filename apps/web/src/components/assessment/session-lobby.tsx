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
 * The waiting room for a Live Assessment Session.
 *
 * The Coder declares themselves ready; the Architect watches the count and
 * decides when to start. When the session starts the global clock is already
 * running, so this screen takes the Coder straight into the workspace rather
 * than showing them a button that costs them seconds to find.
 */
export function SessionLobby({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  const onStarted = useCallback(() => {
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
  }, [router, sessionId]);

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
            : "Your Architect starts this session for everyone at once. Stay on this page."}
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
