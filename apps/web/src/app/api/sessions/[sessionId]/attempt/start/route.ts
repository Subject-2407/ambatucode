import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { startAttempt } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Starts the caller's attempt, or returns the one they already have.
 */
export const POST = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  return ok(await startAttempt(actor, sessionId));
});
