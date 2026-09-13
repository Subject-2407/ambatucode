import { autoSubmitRequestSchema } from "@ambatucode/shared";
import { autoSubmitScope } from "@ambatucode/shared/auth/internal-token";
import { verifyInternalRequest } from "@/server/auth/internal-token";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { autoSubmitAttempt } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

/**
 * Called by apps/realtime when an attempt's deadline alarm fires or its
 * focus-loss action is AUTO_SUBMIT. Never reachable with a browser session:
 * the only credential accepted is a token scoped to this exact attempt.
 *
 * The caller's word is not the decision. For a deadline the database decides
 * whether the attempt is actually due, and answers NOT_DUE when it is not.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const { attemptId } = await context.params;
  verifyInternalRequest(request, autoSubmitScope(attemptId));
  const body = await parseJsonBody(request, autoSubmitRequestSchema);
  return ok(await autoSubmitAttempt(attemptId, { reason: body.reason }));
});
