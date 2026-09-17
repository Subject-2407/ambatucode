import { gradeRecordQuerySchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseQuery, route } from "@/server/http/respond";
import { listModuleGrades } from "@/server/services/grades";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

export const GET = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const query = parseQuery(request, gradeRecordQuerySchema);
  return ok(await listModuleGrades(actor, moduleId, query));
});
