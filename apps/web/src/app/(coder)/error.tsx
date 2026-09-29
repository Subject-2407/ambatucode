"use client";

import { PageContainer } from "@/components/layout/app-shell";
import { ErrorState } from "@/components/ui/error-state";

/**
 * An unexpected failure on a Coder page, shown inside the shell with a way to
 * try again.
 *
 * The error itself is never rendered. What reaches a client error boundary is
 * a server exception, and its message may name internals the SRS keeps off the
 * page — `ErrorState` shows generic copy for anything that is not an ApiError,
 * which a server render never throws here.
 */
export default function CoderError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageContainer width="reading">
      <ErrorState error={null} title="This page could not load" onRetry={reset} />
    </PageContainer>
  );
}
