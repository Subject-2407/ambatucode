import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AppError,
  ERROR_STATUS,
  type ApiResponse,
  type ErrorCode,
  isAppError,
} from "@ambatucode/shared";

/**
 * Every route handler answers through this module so the envelope, the status
 * mapping, and the "never leak internals" rule are applied in exactly one
 * place.
 */

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json<ApiResponse<T>>({ ok: true, data }, { status });
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiResponse<never>> {
  const error = details === undefined ? { code, message } : { code, message, details };
  return NextResponse.json<ApiResponse<never>>(
    { ok: false, error },
    { status: ERROR_STATUS[code] },
  );
}

/**
 * `details` is echoed only for VALIDATION_FAILED. Every other code returns the
 * message alone, so nothing about internal state reaches a Coder.
 */
export function toErrorResponse(error: unknown): NextResponse<ApiResponse<never>> {
  if (error instanceof z.ZodError) {
    return fail("VALIDATION_FAILED", "Request validation failed", z.treeifyError(error));
  }

  if (isAppError(error)) {
    if (error.code === "INTERNAL") {
      console.error("[api] internal AppError:", error.message);
      return fail("INTERNAL", "Something went wrong");
    }
    return error.code === "VALIDATION_FAILED"
      ? fail(error.code, error.message, error.details)
      : fail(error.code, error.message);
  }

  console.error("[api] unhandled error:", error);
  return fail("INTERNAL", "Something went wrong");
}

type RouteHandler<Context> = (
  request: Request,
  context: Context,
) => Promise<NextResponse> | NextResponse;

/** Wraps a handler so thrown AppErrors and ZodErrors become the envelope. */
export function route<Context>(handler: RouteHandler<Context>) {
  return async (request: Request, context: Context): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Request validation failed",
      z.treeifyError(parsed.error),
    );
  }
  return parsed.data;
}

export function parseQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): z.infer<Schema> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Query validation failed",
      z.treeifyError(parsed.error),
    );
  }
  return parsed.data;
}

/** Best-effort client address for session bookkeeping and rate limiting. */
export function clientIpFrom(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
