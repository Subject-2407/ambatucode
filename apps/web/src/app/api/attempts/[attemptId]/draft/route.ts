import { saveDraftRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { saveDraft } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

/**
 * Autosave. Overwrites the single stored draft; never submission history.
 */
export const PUT = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  const body = await parseJsonBody(request, saveDraftRequestSchema);
  return ok(await saveDraft(actor, attemptId, body));
});
