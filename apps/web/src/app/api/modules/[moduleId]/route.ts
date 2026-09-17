import { updateModuleRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteModule, getModule, updateModule } from "@/server/services/modules";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  return ok(await getModule(actor, { id: moduleId }));
});

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const body = await parseJsonBody(request, updateModuleRequestSchema);
  return ok(await updateModule(actor, moduleId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  await deleteModule(actor, moduleId);
  return ok({ deleted: true });
});
