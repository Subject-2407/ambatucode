import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session token primitives shared by apps/web (issues the cookie) and
 * apps/realtime (validates it during the Socket.IO handshake). Both must hash
 * identically or a valid socket handshake would be rejected, so the logic
 * lives here rather than being written twice.
 *
 * The raw token never touches the database — only its SHA-256 hash is stored.
 */

export const SESSION_COOKIE_NAME = "ambatucode_session";
const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type SessionLiveness = {
  revokedAt: Date | null;
  expiresAt: Date;
};

/** A session is usable only while it is neither revoked nor expired. */
export function isSessionLive(session: SessionLiveness, now: Date = new Date()): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}

/**
 * Minimal cookie-header parser for the Socket.IO handshake, where no framework
 * has already parsed the request.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}
