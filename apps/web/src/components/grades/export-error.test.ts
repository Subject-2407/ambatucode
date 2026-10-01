import { describe, expect, it } from "vitest";
import { exportErrorFrom } from "./export-error";

describe("exportErrorFrom", () => {
  it("reads the code from the error envelope", () => {
    const error = exportErrorFrom(403, {
      ok: false,
      error: { code: "FORBIDDEN", message: "Only the owning Architect may manage this module" },
    });
    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    // The copy shown is the app's own, never the server's developer message.
    expect(error.userMessage).toBe("You do not have access to this.");
  });

  it("falls back on the status when the body is not the envelope", () => {
    expect(exportErrorFrom(404, "<html>Not Found</html>").code).toBe("NOT_FOUND");
    expect(exportErrorFrom(502, null).code).toBe("INTERNAL");
  });

  it("does not trust a code the contract does not know", () => {
    expect(
      exportErrorFrom(418, { ok: false, error: { code: "TEAPOT", message: "short and stout" } })
        .code,
    ).toBe("INTERNAL");
  });
});
