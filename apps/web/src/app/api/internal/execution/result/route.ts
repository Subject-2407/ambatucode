import { AppError, executionResultSchema } from "@ambatucode/shared";
import { inspectCallbackToken } from "@/server/auth/callback-token";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { closeExpiredExecution, ingestExecutionResult } from "@/server/services/execution-result";

export const dynamic = "force-dynamic";

/**
 * Worker callback. Bound to the internal network and never reachable from a
 * browser: the only credential it accepts is the per-job HMAC minted when the
 * job was enqueued, which is not present in any Coder-facing response.
 */
export const POST = route(async (request) => {
  const token = request.headers.get("x-execution-callback-token") ?? "";
  const body = await parseJsonBody(request, executionResultSchema);

  if (inspectCallbackToken(body.jobId, token) === "EXPIRED") {
    // The worker really did send this, but too late for its result to be
    // trusted. What it waited on is closed out rather than left queued, and the
    // result itself is refused with the same answer a forged token gets.
    await closeExpiredExecution(body.jobId);
    throw new AppError("FORBIDDEN", "Invalid callback token");
  }

  const outcome = await ingestExecutionResult(body);
  return ok({
    accepted: true,
    persisted: outcome.persisted,
    delivered: outcome.delivered,
  });
});
