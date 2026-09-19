"use client";

import type { ReactNode } from "react";
import { EmptyState as ChakraEmptyState, VStack } from "@chakra-ui/react";
import { PixelIcon } from "./pixel-icon";
import type { SpriteName } from "./pixel-sprites";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /**
   * The sprite that stands in for what would be here. Empty space is the one
   * place the product has room for ornament, so it gets a drawn one rather than
   * a shrugging line icon.
   */
  sprite?: SpriteName;
  /** The one action that resolves the emptiness, if there is one. */
  action?: ReactNode;
};

/**
 * An empty list is a normal state, not a failure. It says what would be here
 * and, where possible, offers the single action that fills it.
 */
export function EmptyState({ title, description, sprite, action }: EmptyStateProps) {
  return (
    <ChakraEmptyState.Root size="md" py="12">
      <ChakraEmptyState.Content>
        {sprite ? (
          <ChakraEmptyState.Indicator color="accent.fg">
            <PixelIcon name={sprite} size={48} />
          </ChakraEmptyState.Indicator>
        ) : null}
        <VStack textAlign="center" gap="1">
          <ChakraEmptyState.Title textStyle="display" fontSize="md">
            {title}
          </ChakraEmptyState.Title>
          {description ? (
            <ChakraEmptyState.Description>{description}</ChakraEmptyState.Description>
          ) : null}
        </VStack>
        {action}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
}
