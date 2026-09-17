import { saveReferenceSolutionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { savePracticeReferenceSolution } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ practiceId: string }> };

/**
 * Saves the reference solution for one language; an empty source removes it.
 */
export const PUT = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  const body = await parseJsonBody(request, saveReferenceSolutionRequestSchema);
  return ok(await savePracticeReferenceSolution(actor, practiceId, body));
});
