import { updateMaterialRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteMaterial, getMaterial, updateMaterial } from "@/server/services/materials";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ materialId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { materialId } = await context.params;
  return ok(await getMaterial(actor, materialId));
});

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { materialId } = await context.params;
  const body = await parseJsonBody(request, updateMaterialRequestSchema);
  return ok(await updateMaterial(actor, materialId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { materialId } = await context.params;
  await deleteMaterial(actor, materialId);
  return ok({ deleted: true });
});
