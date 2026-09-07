"use client";

import type { ReactNode } from "react";
import { EmptyState as ChakraEmptyState, VStack } from "@chakra-ui/react";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** The one action that resolves the emptiness, if there is one. */
  action?: ReactNode;
};

/**
 * An empty list is a normal state, not a failure. It says what would be here
 * and, where possible, offers the single action that fills it.
 */
export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <ChakraEmptyState.Root size="md" py="12">
      <ChakraEmptyState.Content>
        {icon ? (
          <ChakraEmptyState.Indicator color="fg.subtle">{icon}</ChakraEmptyState.Indicator>
        ) : null}
        <VStack textAlign="center" gap="1">
          <ChakraEmptyState.Title>{title}</ChakraEmptyState.Title>
          {description ? (
            <ChakraEmptyState.Description>{description}</ChakraEmptyState.Description>
          ) : null}
        </VStack>
        {action}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
}
