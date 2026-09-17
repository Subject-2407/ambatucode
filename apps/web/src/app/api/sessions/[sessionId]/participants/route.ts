import { replaceParticipantsRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { replaceParticipants } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Replaces the whole participant list; answers with the resulting readiness board.
 */
export const PUT = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  const body = await parseJsonBody(request, replaceParticipantsRequestSchema);
  return ok(await replaceParticipants(actor, sessionId, body));
});
