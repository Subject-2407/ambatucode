import { expireSessionScope } from "@ambatucode/shared/auth/internal-token";
import { verifyInternalRequest } from "@/server/auth/internal-token";
import { ok, route } from "@/server/http/respond";
import { expireSession } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Called by apps/realtime when a Live session's global deadline alarm fires.
 * Ends the session and closes every open attempt if `endsAt` has really
 * passed; answers NOT_DUE and reschedules otherwise.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const { sessionId } = await context.params;
  verifyInternalRequest(request, expireSessionScope(sessionId));
  return ok(await expireSession(sessionId));
});
