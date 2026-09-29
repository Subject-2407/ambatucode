import type { Metadata } from "next";
import NextLink from "next/link";
import { Box, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { CalendarClock, ChevronRight, ClipboardCheck } from "lucide-react";
import { requirePageSession } from "@/lib/require-page-session";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { TimingBadge } from "@/components/assessment/timing-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { formatDateTime } from "@/lib/format-date";
import { routes } from "@/lib/routes";
import { getCoderAgenda, type AgendaItem, type AgendaKind } from "@/server/services/coder-agenda";
import { listModules } from "@/server/services/modules";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * Where a Coder lands: what is waiting on them, then the modules they belong
 * to.
 *
 * The first half is the reason the page exists. The second is the same list
 * the catalog's "My modules" tab shows, kept here because it is the door into
 * everything else.
 */
export default async function CoderDashboardPage() {
  const session = await requirePageSession("CODER");
  const [agenda, enrolled] = await Promise.all([
    getCoderAgenda(session.user),
    listModules(session.user, { page: 1, pageSize: 12, scope: "enrolled" }),
  ]);

  return (
    <PageContainer width="wide" backdrop="circuit">
      <PageHeader
        title={`Welcome back, ${session.user.displayName}`}
        action={
          // With no modules yet, the empty state below offers the same link,
          // and two identical buttons on an otherwise empty page is one too many.
          enrolled.items.length === 0 ? undefined : (
            <Button asChild variant="outline">
              <NextLink href={routes.modules}>Browse modules</NextLink>
            </Button>
          )
        }
      />

      <Stack gap="8">
        {agenda.length === 0 ? null : (
          <Stack as="section" aria-labelledby="up-next" gap="3">
            <Text id="up-next" textStyle="display" fontSize="sm">
              Up next
            </Text>
            <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap="3">
              {agenda.map((item) => (
                <AgendaCard key={item.sessionId} item={item} />
              ))}
            </Grid>
          </Stack>
        )}

        <Stack as="section" aria-labelledby="your-modules" gap="3">
          <Text id="your-modules" textStyle="display" fontSize="sm">
            Your modules
          </Text>
          {enrolled.items.length === 0 ? (
            <EmptyState
              sprite="books"
              title="No modules yet"
              description="Enroll in a module and it appears here."
              action={
                <Button asChild>
                  <NextLink href={routes.modules}>Browse modules</NextLink>
                </Button>
              }
            />
          ) : (
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
              gap="4"
            >
              {enrolled.items.map((module) => (
                // Hovering recolours the frame's edge rather than adding a
                // shadow: the outer layer of a PixelFrame *is* the border.
                <PixelFrame key={module.id} _hover={{ bg: "accent.solid" }}>
                  <Stack asChild padding="4" gap="1.5" height="full">
                    <NextLink href={routes.module(module.slug)}>
                      <Flex justify="space-between" align="center" gap="3">
                        <HStack gap="2.5" minWidth="0">
                          <PixelIcon name="books" size={16} />
                          <Text textStyle="display" fontSize="sm" truncate>
                            {module.title}
                          </Text>
                        </HStack>
                        <ChevronRight size={16} aria-hidden />
                      </Flex>
                      {module.description ? (
                        <Text fontSize="sm" color="fg.muted" lineClamp={2}>
                          {module.description}
                        </Text>
                      ) : null}
                      <Text fontSize="xs" color="fg.muted">
                        {module.owner.displayName} · {module.sectionCount}{" "}
                        {module.sectionCount === 1 ? "section" : "sections"}
                      </Text>
                    </NextLink>
                  </Stack>
                </PixelFrame>
              ))}
            </Grid>
          )}
        </Stack>
      </Stack>
    </PageContainer>
  );
}

const KIND_COPY: Readonly<Record<AgendaKind, { kicker: string; action: string }>> = {
  CONTINUE: { kicker: "In progress", action: "Continue" },
  RETAKE: { kicker: "New attempt open", action: "Open" },
  OPEN: { kicker: "Open now", action: "Open" },
  WAITING: { kicker: "Starting soon", action: "Go to lobby" },
};

/**
 * One thing waiting on the Coder. Lagoon, like every Assessment on the module
 * page, so an exam reads as the same kind of object wherever it appears.
 *
 * Continue goes straight into the workspace — the Coder already chose to start
 * it. Everything else goes to the assessment page, where the rules and the
 * Start confirmation are, rather than skipping past them from here.
 */
function AgendaCard({ item }: { item: AgendaItem }) {
  const copy = KIND_COPY[item.kind];
  const href =
    item.kind === "CONTINUE" && item.attemptId
      ? routes.attempt(item.attemptId)
      : routes.assessment(item.moduleSlug, item.assessmentId);

  return (
    <PixelFrame tone="info" surface="bg.info" pad="4">
      <Flex gap="4" align="center" justify="space-between" wrap="wrap">
        <HStack gap="3" minWidth="0" align="start">
          <Box color="fg.info" pt="0.5">
            <ClipboardCheck size={18} aria-hidden />
          </Box>
          <Stack gap="1" minWidth="0">
            <Text textStyle="display" fontSize="3xs" color="fg.info">
              {copy.kicker}
            </Text>
            <Text fontWeight="medium" truncate>
              {item.assessmentTitle}
            </Text>
            <Text fontSize="xs" color="fg.muted" truncate>
              {item.moduleTitle} · {item.sessionName}
            </Text>
            <HStack gap="3" wrap="wrap">
              <TimingBadge
                durationMinutes={item.durationMinutes}
                executionMode={item.executionMode}
                size="sm"
              />
              {item.closesAt === null ? null : (
                <HStack gap="1.5" color="fg.muted">
                  <CalendarClock size={12} aria-hidden />
                  <Text fontSize="xs">Closes {formatDateTime(item.closesAt)}</Text>
                </HStack>
              )}
            </HStack>
          </Stack>
        </HStack>

        <Button asChild size="sm" flexShrink="0">
          <NextLink href={href}>
            {copy.action}
            <ChevronRight aria-hidden />
          </NextLink>
        </Button>
      </Flex>
    </PixelFrame>
  );
}
