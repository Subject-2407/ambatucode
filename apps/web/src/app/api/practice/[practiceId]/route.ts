import { updatePracticeRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import {
  deletePracticeActivity,
  getPracticeActivity,
  updatePracticeActivity,
} from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ practiceId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  return ok(await getPracticeActivity(actor, practiceId));
});

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  const body = await parseJsonBody(request, updatePracticeRequestSchema);
  return ok(await updatePracticeActivity(actor, practiceId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { practiceId } = await context.params;
  await deletePracticeActivity(actor, practiceId);
  return ok({ deleted: true });
});
