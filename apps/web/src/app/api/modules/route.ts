import { createModuleRequestSchema, listModulesQuerySchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, parseQuery, route } from "@/server/http/respond";
import { createModule, listModules } from "@/server/services/modules";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const actor = await requireUser();
  const query = parseQuery(request, listModulesQuerySchema);
  return ok(await listModules(actor, query));
});

export const POST = route(async (request) => {
  const actor = await requireUser();
  const body = await parseJsonBody(request, createModuleRequestSchema);
  return ok(await createModule(actor, body), 201);
});
