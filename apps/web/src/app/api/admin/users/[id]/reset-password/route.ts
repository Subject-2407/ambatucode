import { resetPasswordRequestSchema } from "@ambatucode/shared";
import { requireRoot } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { resetUserPassword } from "@/server/services/users";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireRoot();
  const { id } = await context.params;
  const body = await parseJsonBody(request, resetPasswordRequestSchema);

  // Resetting a password kills the account's live session, so the holder of an
  // old cookie cannot keep using it.
  await resetUserPassword(actor, id, body.password);

  return ok({ reset: true });
});
