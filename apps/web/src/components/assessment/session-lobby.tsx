"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { Check, Hand } from "lucide-react";
import type { AttemptView } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import { useSessionLobby } from "@/hooks/use-session-lobby";
import { apiClient, isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The waiting room for a scheduled Assessment Session.
 *
 * The Coder declares themselves ready; the Architect watches the count and
 * decides when to start. Readiness is a button, not a switch: it is the one
 * thing this card asks the Coder to do, and a small toggle at the edge of a
 * card was easy to read past as decoration.
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

  // The Architect closed the lobby again, or deleted the session, while this
  // Coder was waiting in it. Saying so beats a button that the server refuses.
  if (lobby.status === "DRAFT" || lobby.status === "CANCELLED") {
    return (
      <Text fontSize="sm" color="fg.muted" borderTopWidth="1px" borderColor="border.default" pt="3">
        {lobby.status === "DRAFT"
          ? "Your Architect closed the lobby for now. It reopens here when they are ready."
          : "This session was withdrawn by your Architect."}
      </Text>
    );
  }

  return (
    <Stack
      gap="3"
      borderTopWidth="1px"
      borderColor="border.default"
      pt="3"
      aria-busy={entering || undefined}
    >
      <HStack justify="space-between" gap="3" wrap="wrap">
        {lobby.ready ? (
          <HStack gap="2" wrap="wrap">
            <Badge tone="success" aria-live="polite">
              <Check size={12} aria-hidden /> You are ready
            </Badge>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => lobby.setReady(false)}
              disabled={entering}
            >
              Not ready yet
            </Button>
          </HStack>
        ) : (
          <Button
            size="sm"
            onClick={() => lobby.setReady(true)}
            loading={lobby.saving}
            disabled={entering}
          >
            <Hand aria-hidden />
            I&apos;m ready
          </Button>
        )}

        {lobby.counts === null ? null : (
          // One count, not three. Who is offline versus merely not ready is
          // the Architect's question; a Coder waiting in the room only wants
          // to know how full it is.
          <Badge
            tone={lobby.counts.ready === lobby.counts.total ? "success" : "neutral"}
            aria-live="polite"
          >
            {lobby.counts.ready} of {lobby.counts.total} ready
          </Badge>
        )}
      </HStack>

      <Text
        fontSize="sm"
        color={lobby.problem === null ? "fg.muted" : "fg.error"}
        aria-live="polite"
      >
        {entering
          ? "Opening your workspace…"
          : lobby.problem !== null
            ? lobby.problem
            : lobby.ready
              ? autoEnter
                ? "Stay on this page. Your workspace opens by itself when the session starts."
                : "Stay on this page. A Start button appears here when the session opens."
              : requireAllReady || autoEnter
                ? "Press I'm ready once you are at your machine. The session waits for everyone."
                : "Press I'm ready once you are at your machine, so your Architect knows you are here."}
      </Text>

      {/*
        Readiness is per visit, not per account: it says "I am sitting here
        now", which a reloaded or abandoned page cannot vouch for.
      */}
      <Text fontSize="xs" color="fg.subtle">
        Leaving or reloading this page takes your ready back.
      </Text>
    </Stack>
  );
}
