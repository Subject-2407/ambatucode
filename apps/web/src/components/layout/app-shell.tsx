"use client";

import type { ReactNode } from "react";
import { Box, Container, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import type { AuthenticatedUser } from "@ambatucode/shared";
import { AchievementAnnouncer } from "@/components/gamification/achievement-announcer";
import { PixelBackdrop, type BackdropVariant } from "@/components/ornament/pixel-backdrop";
import { AssessmentModeProvider, useAssessmentMode } from "@/providers/assessment-mode";
import { SessionProvider } from "@/providers/session-provider";
import { ColorModeToggle } from "@/providers/color-mode";
import { navItemsForRole } from "./navigation";
import { InventoryRail } from "./inventory-rail";

/**
 * The one shell all three roles share. What differs between Root, Architect,
 * and Coder is the navigation and the pages inside it, not the chrome — so
 * there is a single component to keep consistent rather than three that drift.
 *
 * It also mounts SessionProvider, because the shell is the first point at which
 * an authenticated user is known.
 */
export function AppShell({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  return (
    <SessionProvider user={user}>
      <AssessmentModeProvider>
        <ShellFrame user={user}>{children}</ShellFrame>
      </AssessmentModeProvider>
    </SessionProvider>
  );
}

/**
 * The chrome, or the deliberate absence of it.
 *
 * While an attempt is in progress the shell steps out of the way entirely:
 * no sidebar, no navigation, nothing competing with the timer and the editor.
 * A Coder mid-assessment has one task, and every link out of it is either a
 * distraction or a mistake waiting to happen.
 */
function ShellFrame({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  const { active } = useAssessmentMode();

  // Mounted for a Coder in both branches: an award earned during an attempt is
  // held rather than dropped, and announced once the attempt ends. Architects
  // and Root earn no titles, so they listen for nothing.
  const announcer = user.role === "CODER" ? <AchievementAnnouncer /> : null;

  if (active) {
    return (
      <Box as="main" minHeight="100dvh" bg="bg.canvas">
        {announcer}
        {children}
      </Box>
    );
  }

  return (
    // `column-reverse` on a phone puts the rail along the bottom while leaving
    // it first in the document, so it stays the first stop for a keyboard or a
    // screen reader without occupying the top of a small screen.
    <Flex direction={{ base: "column-reverse", md: "row" }} minHeight="100dvh" bg="bg.canvas">
      {/* The footer is the theme switch and nothing else. The account tile
          that used to sit above it opened a panel repeating the name, username,
          and role that the Profile screen already shows in full — a control
          whose only job was to restate what one click away states better. */}
      <InventoryRail items={navItemsForRole(user.role)} footer={<ColorModeToggle />} />

      <Box as="main" flex="1" minWidth="0">
        {announcer}
        {children}
      </Box>
    </Flex>
  );
}

/**
 * The standard page frame inside the shell: one title, optional supporting
 * line, and at most one primary action to its right.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Flex
      align={{ base: "flex-start", sm: "center" }}
      justify="space-between"
      direction={{ base: "column", sm: "row" }}
      gap="3"
      mb="6"
    >
      {/* Without `minWidth: 0` a flex item refuses to shrink below its content,
          so a long title pushed the actions past the edge of the page instead
          of wrapping. The action side gets the opposite treatment: it is the
          one part of a header that must keep its full width, because a button
          squeezed to half its label is not a control any more. */}
      <Stack gap="1" minWidth="0">
        <Heading as="h1" textStyle="display" fontSize={{ base: "xl", md: "2xl" }} color="fg.default">
          {title}
        </Heading>
        {description ? (
          <Text color="fg.muted" fontSize="sm">
            {description}
          </Text>
        ) : null}
      </Stack>
      {action === undefined ? null : (
        <Box flexShrink="0" maxWidth="full">
          {action}
        </Box>
      )}
    </Flex>
  );
}

export function PageContainer({
  children,
  /**
   * The ornament layer behind the page.
   *
   * Opt-in per screen rather than global, and varied on purpose: a Coder
   * moving between the hub, their modules, and their submissions should not be
   * looking at identical wallpaper each time. Screens that are already dense —
   * the builder, a monitor, a grading table — take none, because a backdrop
   * under a wall of data is noise rather than atmosphere. It is quieter than
   * it was, too: at 0.22 the ornaments were competing with the first card on
   * the page rather than sitting behind it.
   */
  backdrop,
  fill = false,
}: {
  children: ReactNode;
  backdrop?: BackdropVariant;
  /**
   * Locks the page to the height of the window instead of letting it grow.
   *
   * For screens whose two halves are read side by side and scrolled
   * independently — the module overview and its leaderboard, where scrolling
   * the page to reach the board would mean losing sight of the sections it
   * ranks. The children then own the scrolling: give the scrolling child
   * `overflowY="auto"` and `minHeight="0"`, or it will refuse to shrink.
   *
   * Only from `md` up. On a phone two columns do not fit, the rail sits along
   * the bottom edge, and a locked page would put content under it.
   */
  fill?: boolean;
}) {
  return (
    <Box
      position="relative"
      minHeight="full"
      height={fill ? { base: "auto", md: "100dvh" } : undefined}
      overflow={fill ? { base: "visible", md: "hidden" } : undefined}
      display={fill ? "flex" : undefined}
      flexDirection={fill ? "column" : undefined}
    >
      {backdrop ? <PixelBackdrop variant={backdrop} opacity={0.16} /> : null}
      <Container
        position="relative"
        zIndex="1"
        // Full width, no cap. A page that stops at 72rem leaves the rest of a
        // wide window as dead margin and squeezes two-column screens until their
        // headers wrap; the gutters below are the only edge a page needs.
        maxWidth="full"
        px={{ base: "4", md: "8" }}
        py={{ base: "6", md: "8" }}
        flex={fill ? "1" : undefined}
        minHeight={fill ? "0" : undefined}
        display={fill ? "flex" : undefined}
        flexDirection={fill ? "column" : undefined}
      >
        {children}
      </Container>
    </Box>
  );
}
