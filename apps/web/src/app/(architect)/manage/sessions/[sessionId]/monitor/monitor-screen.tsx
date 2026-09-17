"use client";

import { useMemo } from "react";
import NextLink from "next/link";
import { Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, CircleDot } from "lucide-react";
import type { MonitorParticipantRow } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { EventStream } from "@/components/monitor/event-stream";
import { ParticipantGrid } from "@/components/monitor/participant-grid";
import { ReadinessBoard } from "@/components/monitor/readiness-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useMonitorSocket } from "@/hooks/use-monitor-socket";
import { useMonitorSnapshot } from "@/hooks/use-sessions";
import { routes } from "@/lib/routes";

/**
 * Live monitoring of one Assessment Session.
 *
 * The HTTP snapshot seeds the screen and the socket feed continues from it,
 * rather than the two competing: a monitor that refetched on a schedule would
 * keep overwriting deltas that arrived in between and make a disconnect appear
 * to flicker.
 */
export function MonitorScreen({ sessionId }: { sessionId: string }) {
  const snapshot = useMonitorSnapshot(sessionId);
  const live = useMonitorSocket({ sessionId, initialEvents: snapshot.data?.events });

  /**
   * The snapshot's rows carry attempt and submission state that the
   * participant feed does not; the feed carries readiness and connection that
   * the snapshot cannot keep current. Merged so each contributes what it knows.
   */
  const rows: MonitorParticipantRow[] = useMemo(() => {
    const base = snapshot.data?.participants ?? [];
    if (live.participants.size === 0) return base;

    return base.map((row) => {
      const delta = live.participants.get(row.userId);
      return delta
        ? {
            ...row,
            readyState: delta.readyState,
            connectionState: delta.connectionState,
            lastSeenAt: delta.lastSeenAt === null ? null : new Date(delta.lastSeenAt).toISOString(),
          }
        : row;
    });
  }, [live.participants, snapshot.data]);

  const nameFor = useMemo(() => {
    const names = new Map(rows.map((row) => [row.userId, row.displayName]));
    return (userId: string | null) =>
      userId === null ? "Session" : (names.get(userId) ?? "Unknown participant");
  }, [rows]);

  if (snapshot.isError) {
    return (
      <PageContainer>
        <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} />
      </PageContainer>
    );
  }

  if (snapshot.isPending || snapshot.data === undefined) {
    return (
      <PageContainer>
        <Skeleton height="32rem" borderRadius="lg" />
      </PageContainer>
    );
  }

  const counts = live.sessionState?.counts ?? snapshot.data.counts;
  const status = live.sessionState?.status ?? snapshot.data.session.status;

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink href={routes.manageSession(sessionId)}>
          <ChevronLeft aria-hidden />
          Back to session control
        </NextLink>
      </Button>

      <PageHeader
        title={snapshot.data.session.name}
        description="Connection and anti-cheat events as they happen."
        action={
          <HStack gap="3">
            <Badge tone={status === "RUNNING" ? "success" : "neutral"}>{status}</Badge>
            <HStack gap="1.5" color={live.connected ? "fg.success" : "fg.error"}>
              <CircleDot size={12} aria-hidden />
              <Text fontSize="xs">{live.connected ? "Live" : "Reconnecting"}</Text>
            </HStack>
          </HStack>
        }
      />

      <Stack gap="5">
        <ReadinessBoard counts={counts} />

        <Grid templateColumns={{ base: "1fr", xl: "1.4fr 1fr" }} gap="5" alignItems="start">
          <Panel title={`Participants (${String(rows.length)})`}>
            <ParticipantGrid rows={rows} />
          </Panel>

          <Panel title="Events">
            <EventStream events={live.events} nameFor={nameFor} />
          </Panel>
        </Grid>

        <Text fontSize="xs" color="fg.muted">
          A disconnect is a logged fact, not an accusation. In Individual mode the Coder&apos;s
          timer pauses and resumes; in Live mode the session clock keeps running.
        </Text>
      </Stack>
    </PageContainer>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack
      gap="3"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
      padding="4"
      minWidth="0"
    >
      <Text textStyle="display" fontSize="sm">
        {title}
      </Text>
      <Box minWidth="0">{children}</Box>
    </Stack>
  );
}
