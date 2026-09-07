"use client";

import type { ReactNode } from "react";
import { Box, Container, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import type { AuthenticatedUser } from "@ambatucode/shared";
import { SessionProvider } from "@/providers/session-provider";
import { ColorModeToggle } from "@/providers/color-mode";
import { BrandMark } from "./brand-mark";
import { navItemsForRole } from "./navigation";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

const SIDEBAR_WIDTH = "16rem";

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
      <Flex direction={{ base: "column", md: "row" }} minHeight="100dvh" bg="bg.canvas">
        <Stack
          as="aside"
          width={{ base: "full", md: SIDEBAR_WIDTH }}
          flexShrink="0"
          gap="6"
          px="4"
          py={{ base: "3", md: "5" }}
          borderBottomWidth={{ base: "1px", md: "0" }}
          borderEndWidth={{ md: "1px" }}
          borderColor="border.default"
          bg="bg.surface"
          position={{ md: "sticky" }}
          top={{ md: "0" }}
          height={{ md: "100dvh" }}
        >
          <Flex align="center" justify="space-between" gap="2">
            <BrandMark />
            <Box display={{ md: "none" }}>
              <ColorModeToggle />
            </Box>
          </Flex>

          <SidebarNav items={navItemsForRole(user.role)} />

          <Flex gap="1" align="center" display={{ base: "none", md: "flex" }}>
            <Box flex="1" minWidth="0">
              <UserMenu />
            </Box>
            <ColorModeToggle />
          </Flex>
        </Stack>

        <Box as="main" flex="1" minWidth="0">
          <Box display={{ base: "block", md: "none" }} px="4" pt="3">
            <UserMenu />
          </Box>
          {children}
        </Box>
      </Flex>
    </SessionProvider>
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
        <Heading as="h1" size="lg" color="fg.default">
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

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Container maxWidth="6xl" px={{ base: "4", md: "8" }} py={{ base: "6", md: "8" }}>
      {children}
    </Container>
  );
}
