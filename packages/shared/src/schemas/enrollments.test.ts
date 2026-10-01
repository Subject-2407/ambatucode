import { describe, expect, it } from "vitest";
import { BULK_ENROLLMENT_LIMIT, bulkDecideEnrollmentsRequestSchema } from "./enrollments";

describe("bulkDecideEnrollmentsRequestSchema", () => {
  it("accepts either decision on selected requests", () => {
    for (const status of ["APPROVED", "REJECTED"] as const) {
      expect(
        bulkDecideEnrollmentsRequestSchema.safeParse({
          target: "SELECTED",
          status,
          enrollmentIds: ["e1", "e2"],
        }).success,
      ).toBe(true);
    }
  });

  it("refuses an empty selection", () => {
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({
        target: "SELECTED",
        status: "APPROVED",
        enrollmentIds: [],
      }).success,
    ).toBe(false);
  });

  it("refuses a selection larger than one page of the queue", () => {
    const enrollmentIds = Array.from({ length: BULK_ENROLLMENT_LIMIT + 1 }, (_, i) => `e${i}`);
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({
        target: "SELECTED",
        status: "APPROVED",
        enrollmentIds,
      }).success,
    ).toBe(false);
  });

  it("refuses a request named twice", () => {
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({
        target: "SELECTED",
        status: "APPROVED",
        enrollmentIds: ["e1", "e1"],
      }).success,
    ).toBe(false);
  });

  it("approves the whole pending queue", () => {
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({ target: "ALL_PENDING", status: "APPROVED" })
        .success,
    ).toBe(true);
  });

  // Declining everybody at once is not a shortcut the queue offers.
  it("refuses to decline the whole pending queue", () => {
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({ target: "ALL_PENDING", status: "REJECTED" })
        .success,
    ).toBe(false);
  });

  it("refuses a pending status, which is a request rather than a decision", () => {
    expect(
      bulkDecideEnrollmentsRequestSchema.safeParse({
        target: "SELECTED",
        status: "PENDING",
        enrollmentIds: ["e1"],
      }).success,
    ).toBe(false);
  });
});
