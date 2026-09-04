import { createUserRequestSchema, listUsersQuerySchema } from "@ambatucode/shared";
import { requireRoot } from "@/server/auth/guards";
import { ok, parseJsonBody, parseQuery, route } from "@/server/http/respond";
import { createUser, listUsers } from "@/server/services/users";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const actor = await requireRoot();
  const query = parseQuery(request, listUsersQuerySchema);
  return ok(await listUsers(actor, query));
});

export const POST = route(async (request) => {
  const actor = await requireRoot();
  const body = await parseJsonBody(request, createUserRequestSchema);
  return ok(await createUser(actor, body), 201);
});
