import { describe, expect, it } from "vitest";
import { bulkDecisionWhere } from "./enrollments";

/**
 * A bulk decision is one `updateMany`, so its `where` is the whole of what
 * keeps it inside the Architect's own module. These pin that scope for both
 * targets; the ownership check in front of it is covered by the integration
 * suite.
 */

describe("bulkDecisionWhere", () => {
  it("scopes a selection to the module in the path", () => {
    expect(
      bulkDecisionWhere("m1", {
        target: "SELECTED",
        status: "APPROVED",
        enrollmentIds: ["e1", "e2"],
      }),
    ).toEqual({ moduleId: "m1", id: { in: ["e1", "e2"] }, status: { not: "APPROVED" } });
  });

  it("leaves rows already in the chosen state alone, so their decider is kept", () => {
    const where = bulkDecisionWhere("m1", {
      target: "SELECTED",
      status: "REJECTED",
      enrollmentIds: ["e1"],
    });
    expect(where.status).toEqual({ not: "REJECTED" });
  });

  it("reads only the pending queue of this module when approving all", () => {
    expect(bulkDecisionWhere("m1", { target: "ALL_PENDING", status: "APPROVED" })).toEqual({
      moduleId: "m1",
      status: "PENDING",
    });
  });
});
