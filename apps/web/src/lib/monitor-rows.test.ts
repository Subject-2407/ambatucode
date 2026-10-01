import { describe, expect, it } from "vitest";
import type { MonitorEventPayload, MonitorParticipantRow } from "@ambatucode/shared";
import {
  attemptPhase,
  flagCounts,
  mergeMonitorRows,
  needsAttention,
  selectRows,
  summarizeRows,
} from "./monitor-rows";

function row(
  overrides: Partial<MonitorParticipantRow> & { userId: string },
): MonitorParticipantRow {
  return {
    username: overrides.userId,
    displayName: overrides.userId,
    isListed: true,
    onRoster: true,
    readyState: "NOT_READY",
    connectionState: "ONLINE",
    presence: "HERE",
    lastSeenAt: null,
    attempt: null,
    submission: null,
    ...overrides,
  };
}

const working = (remainingMs: number, paused = false) => ({
  id: "a",
  attemptNumber: 1,
  status: "IN_PROGRESS" as const,
  remainingMs,
  paused,
});

const graded = (score: number) => ({
  id: "s",
  status: "GRADED" as const,
  score,
  isAutoSubmitted: false,
  submittedAt: "2026-10-01T09:00:00.000Z",
});

function event(userId: string, type: MonitorEventPayload["type"]): MonitorEventPayload {
  return {
    id: `${userId}-${type}-${String(Math.random())}`,
    sessionId: "s1",
    userId,
    attemptId: null,
    type,
    durationMs: null,
    occurredAt: 0,
    payload: {},
  };
}

describe("mergeMonitorRows", () => {
  const base = [row({ userId: "ana", presence: "HERE" })];

  it("lays a delta newer than the snapshot over its row", () => {
    const merged = mergeMonitorRows(
      base,
      new Map([
        [
          "ana",
          {
            payload: {
              sessionId: "s1",
              userId: "ana",
              displayName: "ana",
              readyState: "NOT_READY",
              connectionState: "OFFLINE",
              presence: "ELSEWHERE",
              lastSeenAt: null,
            },
            receivedAtMs: 2_000,
          },
        ],
      ]),
      1_000,
    );
    expect(merged[0]?.presence).toBe("ELSEWHERE");
  });

  it("lets a newer snapshot win over an older delta", () => {
    const merged = mergeMonitorRows(
      base,
      new Map([
        [
          "ana",
          {
            payload: {
              sessionId: "s1",
              userId: "ana",
              displayName: "ana",
              readyState: "NOT_READY",
              connectionState: "OFFLINE",
              presence: "OFFLINE",
              lastSeenAt: null,
            },
            receivedAtMs: 500,
          },
        ],
      ]),
      1_000,
    );
    expect(merged[0]?.presence).toBe("HERE");
  });
});

describe("attempt phases and the summary", () => {
  const rows = [
    row({ userId: "a" }),
    row({ userId: "b", attempt: working(60_000) }),
    row({ userId: "c", attempt: working(60_000, true), presence: "OFFLINE" }),
    row({
      userId: "d",
      attempt: { ...working(0), status: "SUBMITTED", remainingMs: null },
      submission: graded(80),
    }),
    row({ userId: "e", attempt: { ...working(0), status: "EXPIRED", remainingMs: null } }),
  ];

  it("names what each attempt is doing", () => {
    expect(rows.map(attemptPhase)).toEqual([
      "NOT_STARTED",
      "WORKING",
      "PAUSED",
      "SUBMITTED",
      "EXPIRED",
    ]);
  });

  it("counts the room, and who is away mid-attempt", () => {
    expect(summarizeRows(rows)).toEqual({
      total: 5,
      notStarted: 1,
      working: 2,
      submitted: 2,
      away: 1,
    });
  });
});

describe("attention, filters and sorting", () => {
  const flags = flagCounts([
    event("b", "FOCUS_LOST"),
    event("b", "CLIPBOARD_BLOCKED"),
    event("b", "DISCONNECTED"),
    event("c", "RECONNECTED"),
  ]);

  it("counts only anti-cheat events as flags", () => {
    expect(flags.get("b")).toBe(2);
    expect(flags.has("c")).toBe(false);
  });

  it("needs attention when away from a running attempt or flagged, never for a disconnect alone", () => {
    expect(needsAttention(row({ userId: "x", attempt: working(1), presence: "OFFLINE" }), 0)).toBe(
      true,
    );
    expect(needsAttention(row({ userId: "x", presence: "OFFLINE" }), 0)).toBe(false);
    expect(needsAttention(row({ userId: "x", attempt: working(1) }), 1)).toBe(true);
  });

  const rows = [
    row({ userId: "cara", attempt: working(90_000) }),
    row({ userId: "ana", attempt: working(30_000) }),
    row({
      userId: "bo",
      attempt: { ...working(0), status: "SUBMITTED", remainingMs: null },
      submission: graded(95),
    }),
    row({ userId: "dee" }),
  ];

  it("searches by name and filters by what the attempt is doing", () => {
    expect(
      selectRows(rows, { search: "", filter: "WORKING", sort: "NAME", flags: new Map() }).map(
        (r) => r.userId,
      ),
    ).toEqual(["ana", "cara"]);
    expect(
      selectRows(rows, { search: "DE", filter: "ALL", sort: "NAME", flags: new Map() }).map(
        (r) => r.userId,
      ),
    ).toEqual(["dee"]);
  });

  it("sorts by least time left, and by score with the ungraded last", () => {
    expect(
      selectRows(rows, { search: "", filter: "ALL", sort: "TIME_LEFT", flags: new Map() }).map(
        (r) => r.userId,
      ),
    ).toEqual(["ana", "cara", "bo", "dee"]);
    expect(
      selectRows(rows, { search: "", filter: "ALL", sort: "SCORE", flags: new Map() })[0]?.userId,
    ).toBe("bo");
  });
});
