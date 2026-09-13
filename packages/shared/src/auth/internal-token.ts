import { createHmac } from "node:crypto";
import { constantTimeEquals } from "./session-token";

/**
 * Authenticates apps/realtime to apps/web's internal assessment endpoints.
 *
 * Signed per request and per target rather than sent as a bearer secret: the
 * scope names the exact action and resource (`auto-submit:<attemptId>`), so a
 * token lifted from one call can only replay that call, and only until it
 * expires. Both processes hold `INTERNAL_API_SECRET`; neither the browser nor
 * the execution worker ever does.
 *
 * Format: `<expiresAtMs>.<hex signature>`
 */

export const INTERNAL_TOKEN_HEADER = "x-ambatucode-internal-token";

/** Long enough to absorb clock drift between two processes on a LAN. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

function sign(secret: string, scope: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(`internal.${scope}.${expiresAtMs}`).digest("hex");
}

export function issueInternalToken(
  secret: string,
  scope: string,
  now: number = Date.now(),
): string {
  const expiresAtMs = now + TOKEN_TTL_MS;
  return `${expiresAtMs}.${sign(secret, scope, expiresAtMs)}`;
}

export function isInternalTokenValid(
  secret: string,
  scope: string,
  token: string,
  now: number = Date.now(),
): boolean {
  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiresAtMs = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAtMs) || signature.length === 0) return false;

  // Signature before expiry, so a forged token and a stale one look the same.
  if (!constantTimeEquals(signature, sign(secret, scope, expiresAtMs))) return false;
  return expiresAtMs > now;
}

export function autoSubmitScope(attemptId: string): string {
  return `auto-submit:${attemptId}`;
}

export function expireSessionScope(sessionId: string): string {
  return `expire-session:${sessionId}`;
}
