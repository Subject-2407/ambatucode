import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { deletePracticeTestScript } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ testScriptId: string }> };

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { testScriptId } = await context.params;
  await deletePracticeTestScript(actor, testScriptId);
  return ok({ deleted: true });
});
