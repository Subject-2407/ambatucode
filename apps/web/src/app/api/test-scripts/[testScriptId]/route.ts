import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { deleteTestScript } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ testScriptId: string }> };

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { testScriptId } = await context.params;
  await deleteTestScript(actor, testScriptId);
  return ok({ deleted: true });
});
