import { uploadPracticeTestScriptRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { listPracticeTestScripts, uploadPracticeTestScript } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ practiceId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  return ok(await listPracticeTestScripts(actor, practiceId));
});

/**
 * Adds one script file, replacing the script the language already has at that path.
 */
export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  const body = await parseJsonBody(request, uploadPracticeTestScriptRequestSchema);
  return ok(await uploadPracticeTestScript(actor, practiceId, body), 201);
});
