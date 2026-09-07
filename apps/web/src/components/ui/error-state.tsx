"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { EmptyState as ChakraEmptyState, VStack } from "@chakra-ui/react";
import { isApiError } from "@/lib/api-client";
import { Button } from "./button";

/**
 * Renders whatever a query threw as something a person can act on.
 *
 * Only `ApiError.userMessage` reaches the screen. A raw `Error` message could
 * carry internals — a stack, a query fragment, a hidden test case name — and
 * the SRS forbids any of that leaving the server, so an unrecognised error gets
 * generic copy instead.
 */
export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const description = isApiError(error)
    ? error.userMessage
    : "An unexpected error occurred. Please try again.";

  return (
    <ChakraEmptyState.Root size="md" py="12">
      <ChakraEmptyState.Content>
        <ChakraEmptyState.Indicator color="fg.error">
          <TriangleAlert aria-hidden />
        </ChakraEmptyState.Indicator>
        <VStack textAlign="center" gap="1">
          <ChakraEmptyState.Title>{title}</ChakraEmptyState.Title>
          <ChakraEmptyState.Description>{description}</ChakraEmptyState.Description>
        </VStack>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        ) : null}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
}
