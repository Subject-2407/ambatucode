import { reorderSectionsRequestSchema } from "@ambatucode/shared";
import { requireUser } from "@/server/auth/guards";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { reorderSections } from "@/server/services/sections";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

/** Takes the whole ordered list, so the tree is never half-shuffled. */
export const PATCH = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const body = await parseJsonBody(request, reorderSectionsRequestSchema);
  return ok(await reorderSections(actor, moduleId, body));
});
