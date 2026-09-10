import { runPracticeRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { runPracticeActivity } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ practiceId: string }> };

/**
 * Enqueues a Run and answers with its job id. Nothing is graded and nothing is
 * written — the per-case results reach the Coder over `submission:status`.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  const body = await parseJsonBody(request, runPracticeRequestSchema);
  return ok(await runPracticeActivity(actor, practiceId, body), 202);
});
