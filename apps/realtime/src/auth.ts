import { prisma } from "@ambatucode/db";
import type { SocketData } from "@ambatucode/shared";
import {
  hashSessionToken,
  isSessionLive,
  readSessionCookie,
} from "@ambatucode/shared/auth/session-token";

/**
 * Handshake authentication.
 *
 * apps/realtime does not own the session table — it reads the very same rows
 * apps/web writes, using the same cookie name and the same hash from
 * packages/shared. There is no second credential and no shared bearer secret.
 */
export async function authenticateHandshake(
  cookieHeader: string | undefined,
): Promise<SocketData | null> {
  const token = readSessionCookie(cookieHeader);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });

  if (!session) return null;
  if (!isSessionLive({ revokedAt: session.revokedAt, expiresAt: session.expiresAt })) return null;
  if (!session.user.isActive) return null;

  return {
    userId: session.user.id,
    role: session.user.role,
    sessionId: session.id,
  };
}
