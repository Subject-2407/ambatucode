import { updateAssessmentRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteAssessment, getAssessment, updateAssessment } from "@/server/services/assessments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assessmentId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  return ok(await getAssessment(actor, assessmentId));
});

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  const body = await parseJsonBody(request, updateAssessmentRequestSchema);
  return ok(await updateAssessment(actor, assessmentId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { assessmentId } = await context.params;
  await deleteAssessment(actor, assessmentId);
  return ok({ deleted: true });
});
