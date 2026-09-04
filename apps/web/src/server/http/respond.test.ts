import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, type ApiResponse } from "@ambatucode/shared";
import { toErrorResponse } from "./respond";

async function bodyOf(response: Response): Promise<ApiResponse<never>> {
  return (await response.json()) as ApiResponse<never>;
}

describe("toErrorResponse", () => {
  it("maps an AppError to its status and code", async () => {
    const response = toErrorResponse(
      new AppError("ATTEMPT_ALREADY_SUBMITTED", "Already submitted"),
    );
    expect(response.status).toBe(409);

    const body = await bodyOf(response);
    expect(body).toEqual({
      ok: false,
      error: { code: "ATTEMPT_ALREADY_SUBMITTED", message: "Already submitted" },
    });
  });

  it("echoes details only for VALIDATION_FAILED", async () => {
    const withDetails = toErrorResponse(
      new AppError("VALIDATION_FAILED", "Bad input", { field: "username" }),
    );
    const validationBody = await bodyOf(withDetails);
    expect(validationBody.ok).toBe(false);
    expect(!validationBody.ok && validationBody.error.details).toEqual({ field: "username" });

    const conflict = toErrorResponse(new AppError("CONFLICT", "Nope", { internal: "secret" }));
    const conflictBody = await bodyOf(conflict);
    expect(!conflictBody.ok && conflictBody.error.details).toBeUndefined();
  });

  it("turns a ZodError into VALIDATION_FAILED", async () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
    expect(parsed.success).toBe(false);

    const response = toErrorResponse(parsed.success ? new Error("unreachable") : parsed.error);
    expect(response.status).toBe(422);
    const body = await bodyOf(response);
    expect(!body.ok && body.error.code).toBe("VALIDATION_FAILED");
  });

  it("never leaks an unexpected error message to the client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = toErrorResponse(new Error("connection string postgres://user:pw@host"));
    expect(response.status).toBe(500);

    const body = await bodyOf(response);
    expect(body).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong" },
    });

    spy.mockRestore();
  });

  it("does not leak the message of an INTERNAL AppError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const body = await bodyOf(toErrorResponse(new AppError("INTERNAL", "table users column pw")));
    expect(!body.ok && body.error.message).toBe("Something went wrong");

    spy.mockRestore();
  });
});
