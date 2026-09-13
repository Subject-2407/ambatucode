import { createAssessmentRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { createAssessment, listSectionAssessments } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sectionId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sectionId } = await context.params;
  return ok(await listSectionAssessments(actor, sectionId));
});

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sectionId } = await context.params;
  const body = await parseJsonBody(request, createAssessmentRequestSchema);
  return ok(await createAssessment(actor, sectionId, body), 201);
});
