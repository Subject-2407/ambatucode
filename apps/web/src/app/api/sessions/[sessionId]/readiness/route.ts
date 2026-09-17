import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getReadiness } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  return ok(await getReadiness(actor, sessionId));
});
