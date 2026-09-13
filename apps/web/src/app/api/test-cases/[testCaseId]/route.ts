import { updateTestCaseRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteTestCase, updateTestCase } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ testCaseId: string }> };

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { testCaseId } = await context.params;
  const body = await parseJsonBody(request, updateTestCaseRequestSchema);
  return ok(await updateTestCase(actor, testCaseId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { testCaseId } = await context.params;
  await deleteTestCase(actor, testCaseId);
  return ok({ deleted: true });
});
