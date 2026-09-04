import "server-only";
import { cookies } from "next/headers";
import { prisma, type Prisma } from "@ambatucode/db";
import {
  SESSION_COOKIE_NAME,
  type AuthenticatedUser,
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
} from "@ambatucode/shared";
import { getServerEnv, isProduction } from "../env";

export type SessionContext = {
  sessionId: string;
  expiresAt: Date;
  user: AuthenticatedUser;
};

/** Writing lastSeenAt on every request would mean a write per page view. */
const LAST_SEEN_REFRESH_MS = 60_000;

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
    expires?: Date;
    maxAge?: number;
  };
};

export function buildSessionCookie(token: string, expiresAt: Date): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      expires: expiresAt,
    },
  };
}

export function buildClearedSessionCookie(): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      maxAge: 0,
    },
  };
}

export function sessionExpiryFromNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + getServerEnv().SESSION_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Issues a session row inside the caller's transaction and hands back the raw
 * token. Only the SHA-256 hash is persisted, so a database leak cannot be
 * replayed as a live cookie.
 */
export async function issueSession(
  tx: Prisma.TransactionClient,
  input: { userId: string; userAgent: string | null; ipAddress: string | null; expiresAt: Date },
): Promise<{ token: string; sessionId: string }> {
  const token = generateSessionToken();
  const session = await tx.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id };
}

/**
 * Revokes every live session for a user and returns the ids that were killed
 * so the caller can publish them on `session:revoked`.
 */
export async function revokeLiveSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  reason: string,
  now: Date = new Date(),
): Promise<string[]> {
  const live = await tx.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (live.length === 0) return [];

  await tx.session.updateMany({
    where: { id: { in: live.map((session) => session.id) } },
    data: { revokedAt: now, revokedReason: reason },
  });

  return live.map((session) => session.id);
}

export async function revokeSessionById(
  sessionId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
}

/**
 * Resolves the caller from the session cookie. Returns null for a missing,
 * revoked, expired, or deactivated-user session — the route boundary turns
 * that into UNAUTHENTICATED.
 */
export async function getSession(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: { id: true, username: true, displayName: true, role: true, isActive: true } },
    },
  });

  if (!session) return null;

  const now = new Date();
  if (!isSessionLive({ revokedAt: session.revokedAt, expiresAt: session.expiresAt }, now)) {
    return null;
  }
  if (!session.user.isActive) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      role: session.user.role,
    },
  };
}
