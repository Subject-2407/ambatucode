import { z } from "zod";
import type { AutoSubmitOutcome, AutoSubmitReason, ExpireSessionOutcome } from "@ambatucode/shared";
import {
  INTERNAL_TOKEN_HEADER,
  autoSubmitScope,
  expireSessionScope,
  issueInternalToken,
} from "@ambatucode/shared/auth/internal-token";

/**
 * apps/realtime's only way to close an attempt.
 *
 * Creating a Submission and queueing it for grading lives in apps/web, in one
 * service, and nowhere else. apps/realtime decides *when* — a deadline alarm,
 * a focus-loss action — and asks. apps/web still decides *whether*: it re-reads
 * the attempt under a row lock and may answer that it is not due.
 */

export type WebClient = {
  autoSubmit(attemptId: string, reason: AutoSubmitReason): Promise<AutoSubmitOutcome>;
  expireSession(sessionId: string): Promise<ExpireSessionOutcome>;
};

const autoSubmitOutcomeSchema = z.object({
  outcome: z.enum(["SUBMITTED", "EXPIRED", "NOT_DUE", "NOT_ACTIVE"]),
  submissionId: z.string().nullable(),
});

const expireSessionOutcomeSchema = z.object({
  outcome: z.enum(["ENDED", "NOT_DUE", "NOT_RUNNING"]),
});

const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export function createWebClient(options: {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
}): WebClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function post<Schema extends z.ZodType>(
    path: string,
    scope: string,
    body: unknown,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    const response = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: issueInternalToken(options.secret, scope),
      },
      body: JSON.stringify(body),
    });

    let parsed: z.infer<typeof envelopeSchema>;
    try {
      parsed = envelopeSchema.parse(await response.json());
    } catch {
      throw new Error(`${path} answered ${response.status} with an unreadable body`);
    }
    // Thrown, not swallowed: the deadline queue retries a failed job, and the
    // sweep catches anything the retries do not.
    if (!parsed.ok) {
      throw new Error(`${path} failed: ${parsed.error.code} ${parsed.error.message}`);
    }
    return schema.parse(parsed.data);
  }

  return {
    autoSubmit: (attemptId, reason) =>
      post(
        `/api/internal/attempts/${encodeURIComponent(attemptId)}/auto-submit`,
        autoSubmitScope(attemptId),
        { reason },
        autoSubmitOutcomeSchema,
      ),
    expireSession: (sessionId) =>
      post(
        `/api/internal/sessions/${encodeURIComponent(sessionId)}/expire`,
        expireSessionScope(sessionId),
        {},
        expireSessionOutcomeSchema,
      ),
  };
}
