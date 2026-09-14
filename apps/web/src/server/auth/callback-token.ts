import "server-only";
import { createHmac } from "node:crypto";
import { AppError } from "@ambatucode/shared";
import { constantTimeEquals } from "@ambatucode/shared/auth/session-token";
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

export type CallbackTokenState = "VALID" | "EXPIRED";

/**
 * Checks a token's signature and reports whether it is still in date.
 *
 * Only a correctly signed token gets an answer: anything forged or malformed
 * throws, exactly as `verifyCallbackToken` does. An expired one is still
 * proof the worker sent it, which is what lets the callback route close the
 * job's submission out instead of leaving it queued forever. The caller must
 * still refuse the result itself.
 */
export function inspectCallbackToken(
  jobId: string,
  token: string,
  now: number = Date.now(),
): CallbackTokenState {
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
  // Expiry is checked after the signature so an attacker learns nothing from
  // it: a forged token never gets this far.
  return expiresAtMs <= now ? "EXPIRED" : "VALID";
}

export function verifyCallbackToken(jobId: string, token: string, now: number = Date.now()): void {
  // One error shape for forged and stale alike, so a caller cannot tell them apart.
  if (inspectCallbackToken(jobId, token, now) === "EXPIRED") {
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }
}
