import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";
import { getAchievementShowcase } from "@/server/services/achievements";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

export const GET = route<RouteContext>(async (_request, context) => {
  const actor = await requireUser();
  const { userId } = await context.params;
  return ok(await getAchievementShowcase(actor, userId));
});
