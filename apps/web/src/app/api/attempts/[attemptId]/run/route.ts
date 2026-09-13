import { runAttemptRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { runAttempt } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

/**
 * Enqueues a Run against the public cases. Results arrive over `submission:status`.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  const body = await parseJsonBody(request, runAttemptRequestSchema);
  return ok(await runAttempt(actor, attemptId, body), 202);
});
