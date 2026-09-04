import { updateUserRequestSchema } from "@ambatucode/shared";
import { requireRoot } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteUser, updateUser } from "@/server/services/users";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireRoot();
  const { id } = await context.params;
  const body = await parseJsonBody(request, updateUserRequestSchema);
  return ok(await updateUser(actor, id, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireRoot();
  const { id } = await context.params;
  await deleteUser(actor, id);
  return ok({ deleted: true });
});
