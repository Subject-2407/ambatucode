import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { listModuleSessions } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

/** Every session in the Module, for filtering the grading records by one. */
export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  return ok(await listModuleSessions(actor, moduleId));
});
