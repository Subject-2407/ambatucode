import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { endSession } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Ends the session and auto-submits every attempt still open in it.
 */
export const POST = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  return ok(await endSession(actor, sessionId));
});
