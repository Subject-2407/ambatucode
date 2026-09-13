import { uploadTestScriptRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { uploadTestScript } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assessmentId: string }> };

/**
 * Uploads the script for one language, replacing any script that language already had.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  const body = await parseJsonBody(request, uploadTestScriptRequestSchema);
  return ok(await uploadTestScript(actor, assessmentId, body), 201);
});
