import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { requestEnrollment } from "@/server/services/enrollments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

/**
 * No request body. Whether this grants access immediately or opens a pending
 * request is decided by the Module, never asserted by the client.
 */
export const POST = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  return ok(await requestEnrollment(actor, moduleId));
});
