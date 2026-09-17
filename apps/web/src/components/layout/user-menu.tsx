"use client";

import { HStack, Menu, Portal, Stack, Text, chakra } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/providers/session-provider";
import { ROLE_LABEL } from "./navigation";

/**
 * Identity and the one account action that belongs on every screen.
 *
 * In the rail there is no room for a name, so the trigger is a slot like any
 * other, carrying the initial. The name, the username, and the role move into
 * the menu — which is also where signing out belongs: a stray click on an
 * always-visible sign-out button during an assessment would be expensive.
 */
export function UserMenu() {
  const { user, logout, isLoggingOut } = useSession();
  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <chakra.button
          type="button"
          aria-label={`Account: ${user.displayName}`}
          width="48px"
          height="48px"
          flexShrink="0"
          display="grid"
          placeItems="center"
          textStyle="display"
          fontSize="lg"
          borderRadius="0"
          borderWidth="3px"
          borderColor="border.muted"
          bg="bg.canvas"
          color="fg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.subtle", color: "fg.default", borderColor: "border.default" }}
        >
          {initial}
        </chakra.button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            bg="bg.surface"
            borderRadius="0"
            borderWidth="3px"
            borderColor="border.emphasized"
            boxShadow="overlay"
            minWidth="56"
          >
            <Stack gap="0.5" px="3" py="2" borderBottomWidth="1px" borderColor="border.muted">
              <Text fontSize="sm" fontWeight="medium" truncate>
                {user.displayName}
              </Text>
              <HStack gap="2" justify="space-between">
                <Text fontSize="xs" color="fg.muted" truncate>
                  {user.username}
                </Text>
                <Badge tone="accent" size="sm" plain>
                  {ROLE_LABEL[user.role]}
                </Badge>
              </HStack>
            </Stack>

            <Menu.Item
              value="logout"
              disabled={isLoggingOut}
              onSelect={() => void logout()}
              color="fg.error"
              borderRadius="0"
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
