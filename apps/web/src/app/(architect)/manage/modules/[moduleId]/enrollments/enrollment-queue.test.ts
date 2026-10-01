import { describe, expect, it } from "vitest";
import {
  changedBy,
  clearPending,
  markPending,
  pageCheckState,
  pageToRecover,
  selectedRows,
  withSelection,
} from "./enrollment-queue";

const ROWS = [
  { id: "e1", status: "PENDING" as const },
  { id: "e2", status: "APPROVED" as const },
  { id: "e3", status: "REJECTED" as const },
];

describe("selection", () => {
  it("counts only ticked rows that are still on screen", () => {
    const selected = new Set(["e3", "gone", "e1"]);
    expect(selectedRows(selected, ROWS).map((row) => row.id)).toEqual(["e1", "e3"]);
  });

  it("reads the header checkbox from the page", () => {
    expect(pageCheckState(new Set(), ROWS)).toBe(false);
    expect(pageCheckState(new Set(["e1"]), ROWS)).toBe("indeterminate");
    expect(pageCheckState(new Set(["e1", "e2", "e3"]), ROWS)).toBe(true);
    // A tick left over from a row that has gone does not make the page "some".
    expect(pageCheckState(new Set(["gone"]), ROWS)).toBe(false);
  });

  it("ticks and unticks without touching the set it was given", () => {
    const before = new Set(["e1"]);
    const after = withSelection(before, ["e2", "e3"], true);
    expect([...after].sort()).toEqual(["e1", "e2", "e3"]);
    expect([...before]).toEqual(["e1"]);
    expect([...withSelection(after, ["e1", "e2"], false)]).toEqual(["e3"]);
  });
});

describe("changedBy", () => {
  it("leaves out rows already in the chosen state", () => {
    expect(changedBy(ROWS, "APPROVED")).toEqual(["e1", "e3"]);
    expect(changedBy(ROWS, "REJECTED")).toEqual(["e1", "e2"]);
  });
});

describe("pending decisions", () => {
  it("tracks each row's decision on its own", () => {
    const pending = markPending(markPending(new Map(), ["e1"], "APPROVED"), ["e2"], "REJECTED");
    expect(pending.get("e1")).toBe("APPROVED");
    expect(pending.get("e2")).toBe("REJECTED");
    const settled = clearPending(pending, ["e1"]);
    expect(settled.has("e1")).toBe(false);
    expect(settled.get("e2")).toBe("REJECTED");
  });
});

describe("pageToRecover", () => {
  it("moves back when the last page emptied", () => {
    expect(pageToRecover(3, { items: [], total: 50, pageSize: 25 })).toBe(2);
  });

  it("stays put on a page with rows, or when the queue is empty", () => {
    expect(pageToRecover(2, { items: [{}], total: 50, pageSize: 25 })).toBeNull();
    expect(pageToRecover(2, { items: [], total: 0, pageSize: 25 })).toBeNull();
  });
});
