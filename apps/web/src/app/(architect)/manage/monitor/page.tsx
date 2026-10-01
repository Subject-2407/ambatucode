import type { Metadata } from "next";
import NextLink from "next/link";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight, DoorOpen, Users } from "lucide-react";
import type { MonitorableSession } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { listMonitorableSessions } from "@/server/services/sessions";
import { pixelSkin } from "@/theme/pixel";

export const metadata: Metadata = { title: "Monitor" };
export const dynamic = "force-dynamic";

/**
 * Every session of this Architect's that is running right now, and every
 * lobby that is open and filling up.
 *
 * It exists because the monitor had no front door. Reaching one meant
 * remembering which module held which assessment and opening its sessions
 * panel — three screens, performed while a lab is in progress and something
 * has just gone wrong. The question "who is sitting an exam right now" is a
 * list, so this is the list.
 *
 * Fetched in the Server Component rather than through the API client: it is the
 * first paint, and a loopback request to our own route handler would add a trip
 * and a cookie to forward for a page that is already dynamic.
 */
export default async function MonitorIndexPage() {
  const session = await requirePageSession("ARCHITECT");
  const sessions = await listMonitorableSessions(session.user);
  const running = sessions.filter((entry) => entry.status === "RUNNING");
  const lobbies = sessions.filter((entry) => entry.status === "READY");

  return (
    <PageContainer backdrop="circuit">
      <PageHeader
        title="Monitor"
        description="Sessions running right now, and lobbies waiting to start, across every module you own."
      />

      {sessions.length === 0 ? (
        <EmptyState
          sprite="bars"
          title="Nothing is running"
          description="Open a session's lobby or start it, or switch an assessment to open access, and it appears here."
        />
      ) : (
        <Stack gap="6">
          {running.length === 0 ? null : (
            <Stack gap="2">
              <Text textStyle="display" fontSize="sm">
                Running now
              </Text>
              {running.map((entry) => (
                <MonitorRow key={entry.sessionId} entry={entry} />
              ))}
            </Stack>
          )}
          {lobbies.length === 0 ? null : (
            <Stack gap="2">
              <Text textStyle="display" fontSize="sm">
                Lobby open
              </Text>
              {lobbies.map((entry) => (
                <MonitorRow key={entry.sessionId} entry={entry} />
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </PageContainer>
  );
}

function MonitorRow({ entry }: { entry: MonitorableSession }) {
  // A lobby has nothing to monitor yet; its readiness lives on session control.
  const lobby = entry.status === "READY";
  return (
    <Box
      asChild
      {...pixelSkin(
        entry.isOpenAccess ? "var(--amb-colors-accent-solid)" : "var(--amb-colors-border-default)",
        "var(--amb-colors-bg-surface)",
        2,
      )}
      px="4"
      py="3"
      _hover={{ _before: { background: "var(--amb-colors-bg-subtle)" } }}
    >
      <NextLink
        href={
          lobby
            ? routes.manageSession(entry.sessionId)
            : routes.manageSessionMonitor(entry.sessionId)
        }
      >
        <Flex align="center" justify="space-between" gap="4" wrap="wrap">
          <Stack gap="1" minWidth="0" flex="1">
            <HStack gap="2" minWidth="0" wrap="wrap">
              {entry.isOpenAccess ? <DoorOpen size={14} aria-hidden /> : null}
              <Text truncate fontWeight="medium">
                {entry.assessmentTitle}
              </Text>
              {entry.isOpenAccess ? (
                <Badge tone="success" size="sm">
                  Open access
                </Badge>
              ) : (
                <Badge tone="info" size="sm">
                  {entry.name}
                </Badge>
              )}
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              {entry.moduleTitle}
              {entry.executionMode === null
                ? " · Untimed"
                : entry.executionMode === "LIVE"
                  ? " · Live"
                  : " · Individual"}
              {entry.endsAt === null ? "" : ` · closes ${new Date(entry.endsAt).toLocaleString()}`}
            </Text>
          </Stack>

          {/* The number that decides whether this row is worth opening: how
              many Coders are mid-attempt, not how many were invited. */}
          <HStack gap="3" flexShrink="0">
            {lobby ? (
              <Badge tone={entry.hereCount > 0 ? "info" : "neutral"}>
                {entry.hereCount} in the lobby
              </Badge>
            ) : (
              <Badge tone={entry.activeAttempts > 0 ? "warning" : "neutral"}>
                {entry.activeAttempts} working
              </Badge>
            )}
            <HStack gap="1" color="fg.muted">
              <Users size={14} aria-hidden />
              <Text fontSize="xs" textStyle="data">
                {entry.participantCount}
              </Text>
            </HStack>
            <ChevronRight size={16} aria-hidden />
          </HStack>
        </Flex>
      </NextLink>
    </Box>
  );
}
