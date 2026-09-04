import { describe, expect, it } from "vitest";
import { PRISMA_UNIQUE_VIOLATION, getPrismaErrorCode, isPrismaErrorCode } from "./errors";

/**
 * These stand in for the real thing deliberately: the point of shape checking
 * is that it works on an error object that did not come from the constructor
 * this module can see.
 */
function knownRequestError(code: string): unknown {
  return Object.assign(new Error("Unique constraint failed"), {
    code,
    clientVersion: "6.19.3",
    meta: { target: ["username"] },
  });
}

describe("getPrismaErrorCode", () => {
  it("reads the code off a known request error", () => {
    expect(getPrismaErrorCode(knownRequestError("P2002"))).toBe("P2002");
  });

  it("ignores an ordinary Node error that happens to carry a code", () => {
    const nodeError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(getPrismaErrorCode(nodeError)).toBeNull();
  });

  it("ignores values that are not error-shaped", () => {
    expect(getPrismaErrorCode(null)).toBeNull();
    expect(getPrismaErrorCode("P2002")).toBeNull();
    expect(getPrismaErrorCode(new Error("plain"))).toBeNull();
    expect(getPrismaErrorCode({ code: 2002, clientVersion: "6.19.3" })).toBeNull();
  });
});

describe("isPrismaErrorCode", () => {
  it("matches only the requested code", () => {
    const error = knownRequestError(PRISMA_UNIQUE_VIOLATION);
    expect(isPrismaErrorCode(error, PRISMA_UNIQUE_VIOLATION)).toBe(true);
    expect(isPrismaErrorCode(error, "P2003")).toBe(false);
  });
});
