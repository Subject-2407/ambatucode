import "server-only";
import { AppError, type AuthenticatedUser, type UserRole } from "@ambatucode/shared";
import { getSession, type SessionContext } from "./session";

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  }
  return session;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  return (await requireSession()).user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "Insufficient permissions");
  }
  return user;
}

export function requireRoot(): Promise<AuthenticatedUser> {
  return requireRole("ROOT");
}

/**
 * Root administers infrastructure and accounts but is explicitly barred from
 * grading records, participant submissions, and leaderboards. Every service
 * function that returns one of those calls this first, so the restriction
 * holds even if a route forgets to check — hiding a button is not
 * authorization, and neither is a route-level guard alone.
 */
export function assertNotRoot(user: Pick<AuthenticatedUser, "role">): void {
  if (user.role === "ROOT") {
    throw new AppError("FORBIDDEN", "Root cannot access grading, submission, or leaderboard data");
  }
}
