import { describe, expect, it } from "vitest";
import { classifySession, orderAgenda, type AgendaItem, type AgendaKind } from "./coder-agenda";

function item(kind: AgendaKind, sessionId: string, closesAt: string | null = null): AgendaItem {
  return {
    kind,
    sessionId,
    sessionName: sessionId,
    attemptId: null,
    assessmentId: "a",
    assessmentTitle: "A",
    moduleSlug: "m",
    moduleTitle: "M",
    executionMode: "INDIVIDUAL",
    durationMinutes: 30,
    closesAt,
  };
}

describe("classifySession", () => {
  const running = { status: "RUNNING" as const, eligible: true };

  it("offers a running session to an eligible Coder who has not started it", () => {
    expect(classifySession({ ...running, attempt: null })).toBe("OPEN");
    expect(
      classifySession({
        ...running,
        attempt: { status: "NOT_STARTED", grantedOutsideSession: false },
      }),
    ).toBe("OPEN");
  });

  it("says continue for an attempt already in progress", () => {
    expect(
      classifySession({
        ...running,
        attempt: { status: "IN_PROGRESS", grantedOutsideSession: false },
      }),
    ).toBe("CONTINUE");
  });

  it("offers a granted retake even on an ended session", () => {
    expect(
      classifySession({
        status: "ENDED",
        eligible: true,
        attempt: { status: "NOT_STARTED", grantedOutsideSession: true },
      }),
    ).toBe("RETAKE");
  });

  it("offers nothing once the attempt is over", () => {
    for (const status of ["SUBMITTED", "EXPIRED"]) {
      expect(
        classifySession({ ...running, attempt: { status, grantedOutsideSession: false } }),
      ).toBeNull();
    }
  });

  it("offers nothing to a Coder the session does not admit", () => {
    expect(classifySession({ status: "RUNNING", eligible: false, attempt: null })).toBeNull();
  });

  it("points at the lobby of a session that is ready but not started", () => {
    expect(classifySession({ status: "READY", eligible: true, attempt: null })).toBe("WAITING");
    expect(classifySession({ status: "DRAFT", eligible: true, attempt: null })).toBeNull();
  });
});

describe("orderAgenda", () => {
  it("puts running clocks first and waiting rooms last", () => {
    const ordered = orderAgenda([
      item("WAITING", "w"),
      item("OPEN", "o"),
      item("CONTINUE", "c"),
      item("RETAKE", "r"),
    ]);
    expect(ordered.map((entry) => entry.kind)).toEqual(["CONTINUE", "RETAKE", "OPEN", "WAITING"]);
  });

  it("lists a session once, under its most urgent reason", () => {
    const ordered = orderAgenda([item("OPEN", "s"), item("CONTINUE", "s")]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.kind).toBe("CONTINUE");
  });

  it("orders by closing time within a kind, open-ended last", () => {
    const ordered = orderAgenda([
      item("OPEN", "never"),
      item("OPEN", "late", "2026-10-02T10:00:00.000Z"),
      item("OPEN", "soon", "2026-10-01T10:00:00.000Z"),
    ]);
    expect(ordered.map((entry) => entry.sessionId)).toEqual(["soon", "late", "never"]);
  });
});
