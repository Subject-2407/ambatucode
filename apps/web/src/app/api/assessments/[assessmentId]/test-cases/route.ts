import { createTestCaseRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { createTestCase, listTestCases } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assessmentId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  return ok(await listTestCases(actor, assessmentId));
});

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  const body = await parseJsonBody(request, createTestCaseRequestSchema);
  return ok(await createTestCase(actor, assessmentId, body), 201);
});
