import { setOfficialAttemptSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { setAttemptOfficial } from "@/server/services/grades";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  const body = await parseJsonBody(request, setOfficialAttemptSchema);
  return ok(await setAttemptOfficial(actor, attemptId, body));
});
