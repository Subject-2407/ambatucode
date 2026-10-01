"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, CircleDot, Search } from "lucide-react";
import type { AssessmentEventType, MonitorParticipantRow } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ActivityLog } from "@/components/monitor/activity-log";
import { ParticipantGrid } from "@/components/monitor/participant-grid";
import { ReadinessBoard } from "@/components/monitor/readiness-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel } from "@/components/ui/tabs";
import { useMonitorSocket } from "@/hooks/use-monitor-socket";
import { useMonitorBacklog, useMonitorSnapshot } from "@/hooks/use-sessions";
import { formatRemaining } from "@/lib/attempt-clock";
import { formatDateTime } from "@/lib/format-date";
import {
  flagCounts,
  mergeMonitorRows,
  selectRows,
  summarizeRows,
  type MonitorFilter,
  type MonitorSort,
} from "@/lib/monitor-rows";
import { routes } from "@/lib/routes";
import { SESSION_STATUS_LABEL, SESSION_STATUS_TONE } from "@/lib/session-copy";
import { pixelSkin } from "@/theme/pixel";

/**
 * Live monitoring of one Assessment Session.
 *
 * Two sources, each for what it knows. The socket feed carries connections,
 * readiness and events the moment they happen. The snapshot carries attempts —
 * started, paused, submitted, graded — which the feed does not, so it is
 * re-read on a schedule and at once whenever the feed reports that an attempt
 * changed. A participant delta is laid over the snapshot only when it is newer
 * than the read, so the two never argue about who is online.
 */

/** Events after which the attempts on screen are out of date. */
const ATTEMPT_CHANGES: ReadonlySet<AssessmentEventType> = new Set([
  "SESSION_STARTED",
  "SESSION_ENDED",
  "ATTEMPT_STARTED",
  "ATTEMPT_SUBMITTED",
  "ATTEMPT_AUTO_SUBMITTED",
  "ATTEMPT_EXPIRED",
  "ATTEMPT_RESET",
  "TIMER_PAUSED",
  "TIMER_RESUMED",
  "CONNECTED",
]);
const REFETCH_DEBOUNCE_MS = 800;

export function MonitorScreen({ sessionId }: { sessionId: string }) {
  const backlog = useMonitorBacklog(sessionId);
  const live = useMonitorSocket({ sessionId, initialEvents: backlog.data });
  const status = live.sessionState?.status ?? null;
  const snapshot = useMonitorSnapshot(sessionId, status !== "ENDED" && status !== "CANCELLED");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("ALL");
  const [sort, setSort] = useState<MonitorSort>("STATUS");
  /**
   * Participants and the log each get the full width of the page. Side by
   * side they were two cramped columns of half a screen each, and the one an
   * Architect is not reading is the one that does not need the room.
   */
  const [tab, setTab] = useState<"participants" | "activity">("participants");
  const [logUserId, setLogUserId] = useState<string | null>(null);
  const showActivity = useCallback((userId: string) => {
    setLogUserId(userId);
    setTab("activity");
  }, []);

  // A burst of attempt changes — a start, a deadline — is one re-read, not
  // a hundred.
  const refetch = snapshot.refetch;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestEvent = live.events[0];
  const baseRows = snapshot.data?.participants;
  const unknownDelta = useMemo(() => {
    if (baseRows === undefined) return false;
    const known = new Set(baseRows.map((row) => row.userId));
    return [...live.participants.keys()].some((userId) => !known.has(userId));
  }, [baseRows, live.participants]);
  useEffect(() => {
    const changed =
      (latestEvent !== undefined && ATTEMPT_CHANGES.has(latestEvent.type)) || unknownDelta;
    if (!changed) return;
    if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, REFETCH_DEBOUNCE_MS);
  }, [latestEvent, refetch, unknownDelta]);
  useEffect(() => {
    if (status !== null) void refetch();
  }, [refetch, status]);
  useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

  const readAtMs = snapshot.dataUpdatedAt;
  const rows: MonitorParticipantRow[] = useMemo(
    () => mergeMonitorRows(snapshot.data?.participants ?? [], live.participants, readAtMs),
    [live.participants, readAtMs, snapshot.data],
  );
  const flags = useMemo(() => flagCounts(live.events), [live.events]);
  const shown = useMemo(
    () => selectRows(rows, { search, filter, sort, flags }),
    [filter, flags, rows, search, sort],
  );

  const nameFor = useMemo(() => {
    const names = new Map(rows.map((row) => [row.userId, row.displayName]));
    return (userId: string | null) =>
      userId === null ? "Session" : (names.get(userId) ?? "Unknown participant");
  }, [rows]);
  const logParticipants = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((row) => ({ userId: row.userId, displayName: row.displayName })),
    [rows],
  );
  const flagged = useMemo(() => [...flags.values()].reduce((sum, n) => sum + n, 0), [flags]);

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

  const view = snapshot.data.session;
  const counts = live.sessionState?.counts ?? snapshot.data.counts;
  const currentStatus = status ?? view.status;
  const started = currentStatus === "RUNNING" || currentStatus === "ENDED";
  const endsAt =
    live.sessionState?.endsAt ?? (view.endsAt === null ? null : Date.parse(view.endsAt));
  const summary = summarizeRows(rows);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="2">
        <NextLink
          href={
            view.isOpenAccess
              ? routes.manageAssessment(view.assessmentId)
              : routes.manageSession(sessionId)
          }
        >
          <ChevronLeft aria-hidden />
          {view.isOpenAccess ? "Back to the assessment" : "Back to session control"}
        </NextLink>
      </Button>

      <PageHeader
        title={view.isOpenAccess ? "Open access" : view.name}
        description="Who is here, what they are doing, and what happened — as it happens."
        action={
          <HStack gap="3" wrap="wrap">
            {currentStatus === "RUNNING" && endsAt !== null ? (
              <SessionClock endsAtMs={endsAt} live={view.executionMode === "LIVE"} />
            ) : null}
            <Badge tone={SESSION_STATUS_TONE[currentStatus]}>
              {view.isOpenAccess ? "Open" : SESSION_STATUS_LABEL[currentStatus]}
            </Badge>
            <HStack gap="1.5" color={live.connected ? "fg.success" : "fg.error"}>
              <CircleDot size={12} aria-hidden />
              <Text fontSize="xs">{live.connected ? "Live" : "Reconnecting"}</Text>
            </HStack>
          </HStack>
        }
      />

      <Stack gap="5">
        {started ? (
          <HStack gap="3" wrap="wrap" aria-live="polite">
            <Badge tone="info">Working {summary.working}</Badge>
            <Badge tone="success">Submitted {summary.submitted}</Badge>
            <Badge tone="neutral">Not started {summary.notStarted}</Badge>
            {summary.away > 0 ? (
              <Badge tone="warning">Away mid-attempt {summary.away}</Badge>
            ) : null}
          </HStack>
        ) : (
          <ReadinessBoard counts={counts} />
        )}

        <Stack
          gap="4"
          {...pixelSkin("var(--amb-colors-border-default)", "var(--amb-colors-bg-surface)")}
          padding="4"
          minWidth="0"
        >
          <TabBar
            aria-label="Monitor views"
            controls="monitor-view"
            value={tab}
            onValueChange={(value) => setTab(value === "activity" ? "activity" : "participants")}
            items={[
              {
                value: "participants",
                label: "Participants",
                count: rows.length,
              },
              {
                value: "activity",
                label: flagged > 0 ? `Activity · ${String(flagged)} flagged` : "Activity",
                count: live.events.length,
              },
            ]}
          />
          <TabPanel id="monitor-view" value={tab} minWidth="0">
            {tab === "participants" ? (
              <Stack gap="3">
                <HStack gap="2" wrap="wrap" align="end">
                  <HStack gap="2" flex="1" minWidth="12rem">
                    <Box color="fg.muted" aria-hidden>
                      <Search size={16} />
                    </Box>
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      placeholder="Search by name"
                      size="sm"
                      aria-label="Search participants"
                    />
                  </HStack>
                  <Box minWidth="10rem">
                    <SelectField
                      label="Show"
                      value={filter}
                      onChange={(value) => setFilter(value as MonitorFilter)}
                      options={[
                        { value: "ALL", label: "Everyone" },
                        { value: "ATTENTION", label: "Needs attention" },
                        { value: "WORKING", label: "Working" },
                        { value: "NOT_STARTED", label: "Not started" },
                        { value: "SUBMITTED", label: "Finished" },
                      ]}
                    />
                  </Box>
                  <Box minWidth="9rem">
                    <SelectField
                      label="Sort by"
                      value={sort}
                      onChange={(value) => setSort(value as MonitorSort)}
                      options={[
                        { value: "STATUS", label: "Status" },
                        { value: "NAME", label: "Name" },
                        { value: "TIME_LEFT", label: "Time left" },
                        { value: "SCORE", label: "Score" },
                      ]}
                    />
                  </Box>
                </HStack>
                {shown.length === rows.length ? null : (
                  <Text fontSize="xs" color="fg.muted">
                    Showing {shown.length} of {rows.length}
                  </Text>
                )}
                <ParticipantGrid
                  rows={shown}
                  started={started}
                  readAtMs={readAtMs}
                  flags={flags}
                  emptyMessage={
                    rows.length === 0
                      ? "Nobody is expected in this session and nobody has joined it yet."
                      : "Nobody matches these filters."
                  }
                  onShowActivity={showActivity}
                />
              </Stack>
            ) : (
              <ActivityLog
                events={live.events}
                participants={logParticipants}
                nameFor={nameFor}
                userId={logUserId}
                onUserIdChange={setLogUserId}
              />
            )}
          </TabPanel>
        </Stack>

        <Text fontSize="xs" color="fg.muted">
          {view.executionMode === "LIVE"
            ? "Live mode: the shared clock keeps running for everyone, connected or not."
            : view.executionMode === "INDIVIDUAL"
              ? "Individual mode: a Coder's timer pauses while they are disconnected or away from the workspace."
              : "Untimed: there is no clock, only the closing time if one was set."}{" "}
          A disconnect is recorded, never penalised.
        </Text>
      </Stack>
    </PageContainer>
  );
}

/** The session's own deadline, counting down — the Live clock everyone shares. */
function SessionClock({ endsAtMs, live }: { endsAtMs: number; live: boolean }) {
  // Null until the first tick: the server render has no clock to agree with.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (nowMs === null) return null;

  const left = endsAtMs - nowMs;
  return (
    <Text fontSize="sm" textStyle="data" color={left < 5 * 60_000 ? "fg.warning" : "fg.muted"}>
      {live ? `${formatRemaining(left)} left` : `Closes ${formatDateTime(new Date(endsAtMs))}`}
    </Text>
  );
}
