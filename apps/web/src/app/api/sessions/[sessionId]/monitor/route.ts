import { monitorSnapshotQuerySchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseQuery, route } from "@/server/http/respond";
import { getMonitorSnapshot } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const GET = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  const query = parseQuery(request, monitorSnapshotQuerySchema);
  return ok(await getMonitorSnapshot(actor, sessionId, { includeEvents: query.events === "true" }));
});
