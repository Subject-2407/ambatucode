import { saveReferenceSolutionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { saveReferenceSolution } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assessmentId: string }> };

/**
 * Saves the reference solution for one language; an empty source removes it.
 */
export const PUT = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  const body = await parseJsonBody(request, saveReferenceSolutionRequestSchema);
  return ok(await saveReferenceSolution(actor, assessmentId, body));
});
