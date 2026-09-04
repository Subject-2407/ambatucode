import { buildClearedSessionCookie } from "@/server/auth/session";
import { getSession } from "@/server/auth/session";
import { ok, route } from "@/server/http/respond";
import { logout } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/**
 * Logout is idempotent: a caller with no live session still gets a cleared
 * cookie and a 200, so a stale browser tab cannot get stuck.
 */
export const POST = route(async () => {
  const session = await getSession();
  if (session) {
    await logout(session.sessionId, session.user.id);
  }

  const response = ok({ loggedOut: true });
  const cookie = buildClearedSessionCookie();
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
});
