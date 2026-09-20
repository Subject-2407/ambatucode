import { updateSessionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteSession, getSession, updateSession } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  return ok(await getSession(actor, sessionId));
});

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  const body = await parseJsonBody(request, updateSessionRequestSchema);
  return ok(await updateSession(actor, sessionId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sessionId } = await context.params;
  await deleteSession(actor, sessionId);
  return ok({ deleted: true });
});
