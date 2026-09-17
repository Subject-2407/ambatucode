import { submissionHistoryQuerySchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseQuery, route } from "@/server/http/respond";
import { listOwnSubmissions } from "@/server/services/grades";

export const dynamic = "force-dynamic";

/**
 * A Coder's own submission history. Scoped by the session, never by a user id
 * in the path — there is no version of this route that reads somebody else's
 * submissions, which is why it is addressed as `me` rather than by id.
 */
export const GET = route(async (request) => {
  const actor = await requireUser();
  const query = parseQuery(request, submissionHistoryQuerySchema);
  return ok(await listOwnSubmissions(actor, query));
});
