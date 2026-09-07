import "server-only";
import { redirect } from "next/navigation";
import type { UserRole } from "@ambatucode/shared";
import { getSession, type SessionContext } from "@/server/auth/session";
import { homePathForRole, routes } from "./routes";

/**
 * The guard every role layout runs before rendering.
 *
 * This is a routing decision, not the authorization boundary: route handlers
 * and socket events enforce access on their own, because a redirect only
 * decides what a browser is shown. Someone calling the API directly never
 * reaches this code at all.
 */
export async function requirePageSession(role: UserRole): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect(routes.login);
  if (session.user.role !== role) redirect(homePathForRole(session.user.role));
  return session;
}
