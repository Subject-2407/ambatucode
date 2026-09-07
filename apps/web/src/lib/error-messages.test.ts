import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@ambatucode/shared";
import { messageForCode } from "./error-messages";

describe("messageForCode", () => {
  it("covers every error code in the shared contract", () => {
    // Adding a code to packages/shared without giving it copy would otherwise
    // surface as `undefined` in a toast.
    for (const code of ERROR_CODES) {
      const message = messageForCode(code);
      expect(message, code).toBeTypeOf("string");
      expect(message.length, code).toBeGreaterThan(0);
    }
  });

  it("keeps the assessment codes free of accusatory language", () => {
    const assessmentCopy = [
      messageForCode("ATTEMPT_ALREADY_SUBMITTED"),
      messageForCode("ATTEMPT_EXPIRED"),
      messageForCode("SESSION_NOT_RUNNING"),
    ].join(" ");

    expect(assessmentCopy).not.toMatch(/cheat|violation|illegal|banned|denied/i);
  });

  it("never leaks the raw code to the user", () => {
    for (const code of ERROR_CODES) {
      expect(messageForCode(code)).not.toContain(code);
    }
  });
});
