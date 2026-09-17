import { describe, expect, it } from "vitest";
import type { MonitorEventPayload } from "@ambatucode/shared";
import { mergeEvents } from "./monitor-events";

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
