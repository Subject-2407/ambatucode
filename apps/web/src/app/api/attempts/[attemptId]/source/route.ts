import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getAttemptSource } from "@/server/services/attempts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attemptId: string }> };

/**
 * The source a Coder ran or submitted, for the Architect who owns the Module.
 *
 * Authorization is the service's, not this handler's: `getAttemptSource`
 * resolves the attempt to its Module and asserts write access there, which is
 * also what keeps Root out.
 */
export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { attemptId } = await context.params;
  return ok(await getAttemptSource(actor, attemptId));
});
