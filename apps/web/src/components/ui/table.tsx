"use client";

import type { ReactNode } from "react";
import { Table as ChakraTable } from "@chakra-ui/react";

export { Table } from "@chakra-ui/react";

/**
 * A table on a surface, horizontally scrollable inside its own box so a wide
 * column set never makes the page itself scroll sideways.
 */
export function DataTable({
  children,
  caption,
  size = "sm",
}: {
  children: ReactNode;
  /** Announced to screen readers; visually hidden. */
  caption: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <ChakraTable.ScrollArea rounded="l3" bg="bg.surface" maxWidth="100%">
      <ChakraTable.Root variant="outline" size={size} interactive stickyHeader>
        <ChakraTable.Caption srOnly>{caption}</ChakraTable.Caption>
        {children}
      </ChakraTable.Root>
    </ChakraTable.ScrollArea>
  );
}
