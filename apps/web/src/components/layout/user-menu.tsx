"use client";

import { HStack, Menu, Portal, Stack, Text } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/providers/session-provider";
import { ROLE_LABEL } from "./navigation";

/**
 * Identity and the one account action that belongs on every screen. Signing out
 * is behind the menu rather than exposed as a button — a stray click during an
 * assessment would be expensive.
 */
export function UserMenu() {
  const { user, logout, isLoggingOut } = useSession();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm" px="2" width="full" justifyContent="flex-start">
          <Stack gap="0" align="flex-start" flex="1" minWidth="0">
            <Text fontSize="sm" fontWeight="medium" truncate maxWidth="full">
              {user.displayName}
            </Text>
            <Text fontSize="xs" color="fg.muted" truncate maxWidth="full">
              {user.username}
            </Text>
          </Stack>
          <Badge tone="accent" size="sm">
            {ROLE_LABEL[user.role]}
          </Badge>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content bg="bg.surface" boxShadow="overlay" minWidth="52">
            <Menu.Item
              value="logout"
              disabled={isLoggingOut}
              onSelect={() => void logout()}
              color="fg.error"
              _hover={{ bg: "danger.subtle" }}
            >
              <HStack gap="2">
                <LogOut size={16} aria-hidden />
                <Text>{isLoggingOut ? "Signing out…" : "Sign out"}</Text>
              </HStack>
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
