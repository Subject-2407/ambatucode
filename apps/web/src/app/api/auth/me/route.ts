import type { MeResponse } from "@ambatucode/shared";
import { requireSession } from "@/server/auth/guards";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const session = await requireSession();

  return ok<MeResponse>({
    user: session.user,
    sessionExpiresAt: session.expiresAt.toISOString(),
    // The client computes clock skew once from this rather than trusting its
    // own clock for anything time-sensitive.
    serverTimeMs: Date.now(),
  });
});
