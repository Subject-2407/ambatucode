import { updateSectionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { deleteSection, updateSection } from "@/server/services/sections";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sectionId: string }> };

export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { sectionId } = await context.params;
  const body = await parseJsonBody(request, updateSectionRequestSchema);
  return ok(await updateSection(actor, sectionId, body));
});

export const DELETE = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { sectionId } = await context.params;
  await deleteSection(actor, sectionId);
  return ok({ deleted: true });
});
