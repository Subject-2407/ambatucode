"use client";

import { HStack, Menu, Portal, Stack, Text, chakra } from "@chakra-ui/react";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/providers/session-provider";
import { pixelFocusRing, pixelNotch } from "@/theme/pixel";
import { ROLE_LABEL } from "./navigation";

/**
 * Who you are signed in as.
 *
 * In the rail there is no room for a name, so the trigger carries the initial
 * and the name, username, and role live in the panel it opens.
 *
 * Signing out is not here. It has its own slot in the rail, where the one
 * control that ends a session is visible rather than two levels deep.
 */
export function UserMenu() {
  const { user } = useSession();
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
          borderWidth="0"
          clipPath={pixelNotch(3)}
          boxShadow={pixelFocusRing("var(--amb-colors-border-muted)", 3)}
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
            borderWidth="0"
            clipPath={pixelNotch(3)}
            boxShadow={pixelFocusRing("var(--amb-colors-border-emphasized)", 3)}
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

          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
