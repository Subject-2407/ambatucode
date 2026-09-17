import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getSubmission } from "@/server/services/submissions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ submissionId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { submissionId } = await context.params;
  return ok(await getSubmission(actor, submissionId));
});
