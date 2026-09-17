import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getAttempt } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  return ok(await getAttempt(actor, attemptId));
});
