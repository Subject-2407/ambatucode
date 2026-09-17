import { listEnrollmentsQuerySchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseQuery, route } from "@/server/http/respond";
import { listEnrollments } from "@/server/services/enrollments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

export const GET = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const query = parseQuery(request, listEnrollmentsQuerySchema);
  return ok(await listEnrollments(actor, moduleId, query));
});
