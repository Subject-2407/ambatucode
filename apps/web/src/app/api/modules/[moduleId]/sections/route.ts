import { createSectionRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { createSection, listSections } from "@/server/services/sections";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  return ok(await listSections(actor, moduleId));
});

export const POST = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const body = await parseJsonBody(request, createSectionRequestSchema);
  return ok(await createSection(actor, moduleId, body), 201);
});
