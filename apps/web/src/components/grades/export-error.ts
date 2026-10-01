import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "@ambatucode/shared";
import { ApiError } from "@/lib/api-client";

/**
 * Turns a refused export into the same `ApiError` every other request throws.
 *
 * The export is the one route read with `fetch` directly, because its success
 * is a file. Its failure is still the ordinary JSON envelope, and reading it
 * means the Architect is told what actually went wrong — through the same
 * copy as everywhere else — rather than a guess about module ownership.
 */

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
});

/** For a body that is not the envelope: a proxy page, a crash upstream of the route. */
function codeForStatus(status: number): ErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  return "INTERNAL";
}

export function exportErrorFrom(status: number, body: unknown): ApiError {
  const parsed = failureSchema.safeParse(body);
  return parsed.success
    ? new ApiError({ code: parsed.data.error.code, message: parsed.data.error.message, status })
    : new ApiError({
        code: codeForStatus(status),
        message: `Export failed (${String(status)})`,
        status,
      });
}
