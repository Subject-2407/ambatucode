import { executionResultSchema } from "@ambatucode/shared";
import { verifyCallbackToken } from "@/server/auth/callback-token";
import { ok, parseJsonBody, route } from "@/server/http/respond";
import { ingestExecutionResult } from "@/server/services/execution-result";

export const dynamic = "force-dynamic";

/**
 * Worker callback. Bound to the internal network and never reachable from a
 * browser: the only credential it accepts is the per-job HMAC minted when the
 * job was enqueued, which is not present in any Coder-facing response.
 */
export const POST = route(async (request) => {
  const token = request.headers.get("x-execution-callback-token") ?? "";
  const body = await parseJsonBody(request, executionResultSchema);

  verifyCallbackToken(body.jobId, token);

  const outcome = await ingestExecutionResult(body);
  return ok({ accepted: true, persisted: outcome.persisted });
});
