import { resetAttemptSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { resetAttempt } from "@/server/services/grades";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  const body = await parseJsonBody(request, resetAttemptSchema);
  return ok(await resetAttempt(actor, attemptId, body));
});
