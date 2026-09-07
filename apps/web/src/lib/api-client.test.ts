import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "@ambatucode/shared";
import { apiClient, isApiError, type ApiError } from "./api-client";

function respondWith(body: ApiResponse<unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(implementation: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(implementation);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiClient", () => {
  it("unwraps a successful envelope to its data", async () => {
    stubFetch(() => Promise.resolve(respondWith({ ok: true, data: { id: "u1" } })));

    await expect(apiClient.get<{ id: string }>("/api/thing")).resolves.toEqual({ id: "u1" });
  });

  it("sends a JSON body and content-type only when there is a body", async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(respondWith({ ok: true, data: null })));

    await apiClient.post("/api/thing", { name: "x" });
    await apiClient.get("/api/thing");

    const withBody = fetchSpy.mock.calls[0]?.[1];
    const withoutBody = fetchSpy.mock.calls[1]?.[1];

    expect(withBody?.body).toBe(JSON.stringify({ name: "x" }));
    expect(withBody?.headers).toEqual({ "content-type": "application/json" });
    expect(withoutBody?.body).toBeUndefined();
    expect(withoutBody?.headers).toBeUndefined();
  });

  it("never sends credentials cross-origin", async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(respondWith({ ok: true, data: null })));

    await apiClient.get("/api/thing");

    expect(fetchSpy.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("drops empty and nullish query parameters", async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(respondWith({ ok: true, data: null })));

    await apiClient.get("/api/users", {
      query: { page: 1, role: undefined, search: "", active: false },
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/users?page=1&active=false");
  });

  it("omits the query string entirely when nothing survives filtering", async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(respondWith({ ok: true, data: null })));

    await apiClient.get("/api/users", { query: { search: undefined } });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/users");
  });

  it("turns a failed envelope into a typed ApiError carrying the code", async () => {
    stubFetch(() =>
      Promise.resolve(
        respondWith(
          { ok: false, error: { code: "ATTEMPT_ALREADY_SUBMITTED", message: "already" } },
          409,
        ),
      ),
    );

    const error = await apiClient
      .post("/api/attempts/a1/submit")
      .catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).code).toBe("ATTEMPT_ALREADY_SUBMITTED");
    expect((error as ApiError).status).toBe(409);
    // The developer message is preserved for logs; the user sees the mapped copy.
    expect((error as ApiError).message).toBe("already");
    expect((error as ApiError).userMessage).toMatch(/already been submitted/i);
  });

  it("reports a transport failure as a network error, not a server error", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    const error = await apiClient.get("/api/thing").catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).isNetworkError).toBe(true);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).userMessage).toMatch(/cannot reach the server/i);
  });

  it("propagates an abort instead of disguising it as a network error", async () => {
    stubFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));

    const error = await apiClient.get("/api/thing").catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(false);
    expect((error as DOMException).name).toBe("AbortError");
  });

  it("maps a non-JSON 401 to UNAUTHENTICATED rather than a parse failure", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>proxy</html>", { status: 401 })));

    const error = await apiClient.get("/api/auth/me").catch((caught: unknown) => caught);

    expect((error as ApiError).code).toBe("UNAUTHENTICATED");
  });

  it("maps any other non-JSON response to INTERNAL", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>gateway</html>", { status: 502 })));

    const error = await apiClient.get("/api/thing").catch((caught: unknown) => caught);

    expect((error as ApiError).code).toBe("INTERNAL");
    expect((error as ApiError).status).toBe(502);
  });
});
