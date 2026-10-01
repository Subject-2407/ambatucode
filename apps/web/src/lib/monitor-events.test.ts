import { describe, expect, it } from "vitest";
import type { MonitorEventPayload } from "@ambatucode/shared";
import {
  countByCategory,
  describeEvent,
  filterEvents,
  formatSpan,
  mergeEvents,
} from "./monitor-events";

function event(id: string, occurredAt: number): MonitorEventPayload {
  return {
    id,
    sessionId: "session-1",
    userId: "user-1",
    attemptId: null,
    type: "DISCONNECTED",
    durationMs: null,
    occurredAt,
    payload: {},
  };
}

describe("mergeEvents", () => {
  it("shows the snapshot's history when the live feed is still empty", () => {
    const merged = mergeEvents([], [event("a", 1), event("b", 2)], 10);
    expect(merged.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("keeps live events that arrived before the snapshot, newest first", () => {
    const merged = mergeEvents([event("live", 5)], [event("old", 1), event("older", 0)], 10);
    expect(merged.map((e) => e.id)).toEqual(["live", "old", "older"]);
  });

  it("shows an event delivered both ways once", () => {
    const merged = mergeEvents([event("both", 3)], [event("both", 3), event("old", 1)], 10);
    expect(merged.map((e) => e.id)).toEqual(["both", "old"]);
  });

  it("caps the result like the live feed", () => {
    const snapshot = Array.from({ length: 20 }, (_, index) => event(`e${String(index)}`, index));
    const merged = mergeEvents([], snapshot, 5);
    expect(merged.map((e) => e.id)).toEqual(["e19", "e18", "e17", "e16", "e15"]);
  });
});

function typed(
  type: MonitorEventPayload["type"],
  overrides: Partial<MonitorEventPayload> = {},
): MonitorEventPayload {
  return { ...event(`${type}-${String(Math.random())}`, 0), type, ...overrides };
}

describe("describeEvent", () => {
  it("tells walking away from a dropped connection", () => {
    expect(describeEvent(typed("DISCONNECTED", { payload: { reason: "LEFT" } }))).toMatchObject({
      label: "Left the workspace",
      category: "CONNECTION",
      tone: "neutral",
    });
    expect(describeEvent(typed("DISCONNECTED", { payload: { reason: "LOST" } })).label).toBe(
      "Connection lost",
    );
    expect(describeEvent(typed("DISCONNECTED")).detail).toBeNull();
  });

  it("says which time a Coder left the window and what was done about it", () => {
    expect(
      describeEvent(typed("FOCUS_LOST", { payload: { count: 2, action: "WARN" } })),
    ).toMatchObject({ category: "ANTI_CHEAT", tone: "warning", detail: "2nd time · warned" });
    expect(describeEvent(typed("FOCUS_REGAINED", { durationMs: 65_000 })).detail).toBe(
      "Away for 1m 05s",
    );
  });

  it("names the clipboard action and the reason for an auto-submit", () => {
    expect(describeEvent(typed("CLIPBOARD_BLOCKED", { payload: { action: "PASTE" } })).detail).toBe(
      "Tried to paste",
    );
    expect(
      describeEvent(typed("ATTEMPT_AUTO_SUBMITTED", { payload: { reason: "FOCUS_LOSS" } })).detail,
    ).toBe("Left the window too often");
  });

  it("reads a forced start as a forced start", () => {
    expect(
      describeEvent(typed("SESSION_STARTED", { payload: { forced: true, ready: 3, total: 5 } }))
        .detail,
    ).toBe("Started anyway · 3/5 ready");
  });
});

describe("formatSpan", () => {
  it("uses the fewest units that fit", () => {
    expect(formatSpan(4_400)).toBe("4s");
    expect(formatSpan(185_000)).toBe("3m 05s");
    expect(formatSpan(3_720_000)).toBe("1h 02m");
  });
});

describe("filterEvents and countByCategory", () => {
  const events = [
    typed("FOCUS_LOST", { userId: "ana" }),
    typed("DISCONNECTED", { userId: "ana" }),
    typed("FOCUS_LOST", { userId: "bo" }),
    typed("SESSION_STARTED", { userId: null }),
  ];

  it("narrows by category and by Coder together", () => {
    expect(filterEvents(events, { category: "ANTI_CHEAT", userId: null })).toHaveLength(2);
    expect(filterEvents(events, { category: "ANTI_CHEAT", userId: "ana" })).toHaveLength(1);
    expect(filterEvents(events, { category: "ALL", userId: "ana" })).toHaveLength(2);
  });

  it("counts every category, adding up to the whole", () => {
    expect(countByCategory(events)).toEqual({
      ALL: 4,
      CONNECTION: 1,
      ANTI_CHEAT: 2,
      ATTEMPT: 0,
      SESSION: 1,
    });
  });
});
