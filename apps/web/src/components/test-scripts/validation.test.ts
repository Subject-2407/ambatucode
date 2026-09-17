import { describe, expect, it } from "vitest";
import type { TestScriptValidationStatus } from "@ambatucode/shared";
import { isValidating, validationWarning } from "./validation";

const script = (status: TestScriptValidationStatus) => ({
  validation: { status, summary: null, changedAt: null },
});

describe("validationWarning", () => {
  it("says nothing when every script passed, or there are none", () => {
    expect(validationWarning([])).toBeNull();
    expect(validationWarning([script("PASSED"), script("PASSED")])).toBeNull();
  });

  it("counts scripts nobody has checked", () => {
    expect(validationWarning([script("PASSED"), script("UNVALIDATED")])).toMatch(
      /^1 test script has not been validated/,
    );
    expect(validationWarning([script("UNVALIDATED"), script("VALIDATING")])).toMatch(
      /^2 test scripts have not been validated/,
    );
  });

  it("puts a known failure ahead of an unchecked script", () => {
    expect(validationWarning([script("UNVALIDATED"), script("FAILED")])).toMatch(
      /^1 test script failed/,
    );
  });
});

describe("isValidating", () => {
  it("is true only while a validation is in flight", () => {
    expect(isValidating([script("PASSED"), script("VALIDATING")])).toBe(true);
    expect(isValidating([script("FAILED")])).toBe(false);
  });
});
