import type { ApiResponse, ErrorCode } from "@ambatucode/shared";
import { messageForCode } from "./error-messages";

/**
 * The only place the browser talks HTTP to apps/web. Components never call
 * `fetch` directly: every response arrives as the shared `ApiResponse<T>`
 * envelope, and this module is what unwraps it and turns a failure into a
 * typed throw.
 *
 * Server Components do not use this — they call the services in `src/server`
 * directly, so there is no loopback request and no cookie forwarding to get
 * wrong.
 */

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  /** True when the request never reached the server (offline, server down). */
  readonly isNetworkError: boolean;

  constructor(init: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: unknown;
    isNetworkError?: boolean;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.isNetworkError = init.isNetworkError ?? false;
  }

  /** Copy safe to show a user. Never the raw server message. */
  get userMessage(): string {
    return this.isNetworkError
      ? "Cannot reach the server. Check your connection and try again."
      : messageForCode(this.code);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

type RequestOptions = {
  signal?: AbortSignal;
  /** Query string parameters. Undefined and null entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, query: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function networkError(): ApiError {
  return new ApiError({
    code: "INTERNAL",
    message: "Request failed before reaching the server",
    status: 0,
    isNetworkError: true,
  });
}

async function readEnvelope<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    // A non-JSON body means something upstream of the route handler answered —
    // a proxy error page, a crash. Report it as the status, not as a parse bug.
    throw new ApiError({
      code: response.status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
      message: `Unexpected non-JSON response (${String(response.status)})`,
      status: response.status,
    });
  }
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      // Same-origin only: the session cookie is httpOnly and must never be
      // sent anywhere but apps/web.
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw networkError();
  }

  const envelope = await readEnvelope<T>(response);

  if (!envelope.ok) {
    throw new ApiError({
      code: envelope.error.code,
      message: envelope.error.message,
      status: response.status,
      details: envelope.error.details,
    });
  }

  return envelope.data;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, undefined, options),
};
