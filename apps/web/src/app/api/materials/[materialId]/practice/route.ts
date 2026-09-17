import { createPracticeRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { createPracticeActivity, listPracticeActivities } from "@/server/services/practice";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ materialId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { materialId } = await context.params;
  return ok(await listPracticeActivities(actor, materialId));
});

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { materialId } = await context.params;
  const body = await parseJsonBody(request, createPracticeRequestSchema);
  return ok(await createPracticeActivity(actor, materialId, body), 201);
});
