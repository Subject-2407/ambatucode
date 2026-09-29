"use client";

import type { ReactNode } from "react";
import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import { PIXEL } from "@/theme/pixel";
import { CloseButton } from "./close-button";

export type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  /** Controls that belong in the header row beside the title, such as a scope picker. */
  headerExtra?: ReactNode;
  size?: "sm" | "md" | "lg";
};

/**
 * A panel that slides in from the end edge, for something read alongside the
 * page rather than instead of it.
 *
 * Focus is trapped and returned to the trigger on close, the same guarantees
 * `Modal` gives, because it is the same Ark primitive underneath.
 *
 * No notch. A drawer runs the full height of the window, so the stair-step
 * would sit at the top and bottom of the screen where nobody reads it; the
 * heavy edge along the side it slides from is what marks it as a platform
 * surface.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  headerExtra,
  size = "md",
}: DrawerProps) {
  return (
    <ChakraDrawer.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      placement="end"
      size={size}
    >
      <Portal>
        <ChakraDrawer.Backdrop bg="blackAlpha.500" />
        <ChakraDrawer.Positioner>
          <ChakraDrawer.Content
            bg="bg.surface"
            borderRadius="0"
            borderStartWidth={`${PIXEL}px`}
            borderColor="border.emphasized"
          >
            <ChakraDrawer.Header display="flex" flexDirection="column" alignItems="stretch" gap="3">
              <ChakraDrawer.Title textStyle="display" fontSize="md" pe="10">
                {title}
              </ChakraDrawer.Title>
              {headerExtra}
            </ChakraDrawer.Header>
            <ChakraDrawer.CloseTrigger asChild>
              <CloseButton position="absolute" top="3" insetEnd="3" />
            </ChakraDrawer.CloseTrigger>
            <ChakraDrawer.Body>{children}</ChakraDrawer.Body>
          </ChakraDrawer.Content>
        </ChakraDrawer.Positioner>
      </Portal>
    </ChakraDrawer.Root>
  );
}
