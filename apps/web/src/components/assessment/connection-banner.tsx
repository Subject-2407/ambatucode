"use client";

import { Box, HStack, Text } from "@chakra-ui/react";
import { WifiOff } from "lucide-react";
import type { ExecutionMode } from "@ambatucode/shared";
import type { AttemptConnection } from "@/hooks/use-attempt-socket";

/**
 * The sticky notice shown while the realtime connection is down.
 *
 * Non-dismissable on purpose: a Coder who does not know they are offline will
 * assume their work is being saved. It also has to say something different in
 * each execution mode, because the two modes make opposite promises about the
 * clock — and a Coder in a Live session who believes their timer paused has
 * been misled by the interface at the worst possible moment.
 */
export function ConnectionBanner({
  connection,
  executionMode,
}: {
  connection: AttemptConnection;
  executionMode: ExecutionMode | null;
}) {
  if (connection !== "OFFLINE") return null;

  const clockNote =
    executionMode === "LIVE"
      ? "The session clock keeps running while you are disconnected."
      : executionMode === "INDIVIDUAL"
        ? "Your timer is paused and resumes when you reconnect."
        : null;

  return (
    <Box
      role="status"
      aria-live="polite"
      position="sticky"
      top="0"
      zIndex="docked"
      bg="bg.warning"
      borderBottomWidth="1px"
      borderColor="border.warning"
      px={{ base: "4", md: "6" }}
      py="2"
    >
      <HStack gap="3" align="center">
        <Box color="fg.warning" aria-hidden>
          <WifiOff size={16} />
        </Box>
        <Text fontSize="sm" color="fg.warning" fontWeight="medium">
          Reconnecting…
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Your code is kept in this browser.
          {clockNote ? ` ${clockNote}` : ""}
        </Text>
      </HStack>
    </Box>
  );
}
