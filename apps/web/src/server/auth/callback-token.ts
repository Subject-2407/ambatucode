import "server-only";
import { createHmac } from "node:crypto";
import { AppError, constantTimeEquals } from "@ambatucode/shared";
import { getServerEnv } from "../env";

/**
 * The worker result callback is authenticated with a short-lived HMAC over the
 * job id rather than a shared bearer secret, so a leaked token can only be
 * replayed against the one job it was minted for, and only until it expires.
 *
 * Format: `<expiresAtMs>.<hex signature>`
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

function sign(jobId: string, expiresAtMs: number): string {
  return createHmac("sha256", getServerEnv().EXECUTION_CALLBACK_SECRET)
    .update(`${jobId}.${expiresAtMs}`)
    .digest("hex");
}

export function issueCallbackToken(jobId: string, now: number = Date.now()): string {
  const expiresAtMs = now + TOKEN_TTL_MS;
  return `${expiresAtMs}.${sign(jobId, expiresAtMs)}`;
}

export function verifyCallbackToken(jobId: string, token: string, now: number = Date.now()): void {
  const separator = token.indexOf(".");
  if (separator === -1) {
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }

  const expiresAtMs = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);

  if (!Number.isSafeInteger(expiresAtMs) || signature.length === 0) {
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }
  if (!constantTimeEquals(signature, sign(jobId, expiresAtMs))) {
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }
  // Expiry is checked after the signature so an attacker cannot use the error
  // shape to distinguish a forged token from a stale one.
  if (expiresAtMs <= now) {
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }
}
