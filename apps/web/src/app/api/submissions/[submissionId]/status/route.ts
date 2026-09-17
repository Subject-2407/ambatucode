import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getSubmissionStatus } from "@/server/services/submissions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ submissionId: string }> };

/**
 * Lightweight polling fallback for a client whose socket missed `submission:status`.
 */
export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { submissionId } = await context.params;
  return ok(await getSubmissionStatus(actor, submissionId));
});
