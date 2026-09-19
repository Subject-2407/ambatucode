import type { ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { PixelBackdrop } from "@/components/ornament/pixel-backdrop";
import { PixelHorizon } from "@/components/ornament/pixel-horizon";

/**
 * The title screen is the whole window, not a card floating in the middle of
 * one. Signing in is the first thing anybody sees of this product, and a form
 * boxed in the centre of an empty page says nothing about what they are
 * signing in to.
 *
 * The gradient runs from a lit horizon up into the dark, the backdrop fills
 * the sky with nodes, and the server rack closes the bottom edge. Content
 * stacks above all three.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Box
      position="relative"
      minHeight="100dvh"
      overflow="hidden"
      bgGradient="to-b"
      gradientFrom="bg.subtle"
      gradientTo="bg.canvas"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      px="4"
      py="10"
    >
      <PixelBackdrop variant="constellation" opacity={0.3} />
      <PixelHorizon />

      {/* Scanlines. Faint enough to read a phosphor screen through, and never
          over the text: the overlay sits under the content stack. */}
      <Box
        aria-hidden
        position="absolute"
        inset="0"
        pointerEvents="none"
        backgroundImage="repeating-linear-gradient(to bottom, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px)"
      />

      <Box position="relative" zIndex="1" width="full" display="flex" justifyContent="center">
        {children}
      </Box>
    </Box>
  );
}
