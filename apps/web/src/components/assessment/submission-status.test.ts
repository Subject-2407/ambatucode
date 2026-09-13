import { describe, expect, it } from "vitest";
import { SUBMISSION_STATUSES } from "@ambatucode/shared";
import { describeSubmission } from "./submission-status";

describe("describeSubmission", () => {
  it("gives every status a label and an explanation", () => {
    for (const status of SUBMISSION_STATUSES) {
      const view = describeSubmission(status, null);
      expect(view.label, status).not.toBe("");
      expect(view.detail, status).not.toBe("");
    }
  });

  it("marks only the terminal statuses as settled", () => {
    expect(describeSubmission("QUEUED", null).settled).toBe(false);
    expect(describeSubmission("RUNNING", null).settled).toBe(false);
    expect(describeSubmission("GRADED", 80).settled).toBe(true);
    expect(describeSubmission("SYSTEM_ERROR", null).settled).toBe(true);
  });

  it("colours a graded submission by what it earned", () => {
    expect(describeSubmission("GRADED", 100).tone).toBe("success");
    expect(describeSubmission("GRADED", 60).tone).toBe("warning");
    expect(describeSubmission("GRADED", 0).tone).toBe("danger");
  });

  it("shows the score in the label once there is one", () => {
    expect(describeSubmission("GRADED", 75).label).toContain("75/100");
    expect(describeSubmission("GRADED", null).label).toBe("Graded");
  });

  it("treats every failure status as danger", () => {
    for (const status of [
      "COMPILE_ERROR",
      "RUNTIME_ERROR",
      "TIME_LIMIT_EXCEEDED",
      "MEMORY_LIMIT_EXCEEDED",
      "SYSTEM_ERROR",
    ] as const) {
      expect(describeSubmission(status, null).tone, status).toBe("danger");
    }
  });

  it("never claims a system error was the Coder's fault", () => {
    expect(describeSubmission("SYSTEM_ERROR", null).detail).toContain("platform");
  });
});
