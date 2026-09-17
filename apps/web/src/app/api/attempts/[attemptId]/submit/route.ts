import { submitAttemptRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { submitAttempt } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

/**
 * The one formal Submit. Grades the source in this request body — never the draft.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  const body = await parseJsonBody(request, submitAttemptRequestSchema);
  return ok(await submitAttempt(actor, attemptId, body), 202);
});
