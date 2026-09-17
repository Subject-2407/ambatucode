import { validateTestScriptsRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { validatePracticeTestScripts } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ practiceId: string }> };

/**
 * Runs one language's scripts against its reference solution. Results land on
 * the scripts themselves; the response only correlates the job.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  const body = await parseJsonBody(request, validateTestScriptsRequestSchema);
  return ok(await validatePracticeTestScripts(actor, practiceId, body), 202);
});
