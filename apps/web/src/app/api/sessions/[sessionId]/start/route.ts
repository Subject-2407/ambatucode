import { startSessionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { startSession } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Answers `started: false` with the readiness counts, rather than starting, when a Live
 * session is not fully ready and `force` was not sent.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  const body = await parseJsonBody(request, startSessionRequestSchema);
  return ok(await startSession(actor, sessionId, body));
});
