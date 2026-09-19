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
import { UserMenu } from "./user-menu";

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
      <InventoryRail
        items={navItemsForRole(user.role)}
        footer={
          <>
            <UserMenu />
            <ColorModeToggle />
          </>
        }
      />

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
      <Stack gap="1">
        <Heading as="h1" textStyle="display" fontSize={{ base: "xl", md: "2xl" }} color="fg.default">
          {title}
        </Heading>
        {description ? (
          <Text color="fg.muted" fontSize="sm">
            {description}
          </Text>
        ) : null}
      </Stack>
      {action}
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
   * under a wall of data is noise rather than atmosphere.
   */
  backdrop,
}: {
  children: ReactNode;
  backdrop?: BackdropVariant;
}) {
  return (
    <Box position="relative" minHeight="full">
      {backdrop ? <PixelBackdrop variant={backdrop} opacity={0.22} /> : null}
      <Container
        position="relative"
        zIndex="1"
        maxWidth="6xl"
        px={{ base: "4", md: "8" }}
        py={{ base: "6", md: "8" }}
      >
        {children}
      </Container>
    </Box>
  );
}
