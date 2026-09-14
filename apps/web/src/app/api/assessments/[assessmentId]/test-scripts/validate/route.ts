import { validateTestScriptsRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { validateTestScripts } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assessmentId: string }> };

/**
 * Runs one language's scripts against its reference solution. Results land on
 * the scripts themselves; the response only correlates the job.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  const body = await parseJsonBody(request, validateTestScriptsRequestSchema);
  return ok(await validateTestScripts(actor, assessmentId, body), 202);
});
