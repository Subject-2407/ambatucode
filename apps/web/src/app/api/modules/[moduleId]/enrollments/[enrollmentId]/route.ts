import { decideEnrollmentRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { decideEnrollment } from "@/server/services/enrollments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string; enrollmentId: string }> };

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId, enrollmentId } = await context.params;
  const body = await parseJsonBody(request, decideEnrollmentRequestSchema);
  return ok(await decideEnrollment(actor, moduleId, enrollmentId, body));
});
