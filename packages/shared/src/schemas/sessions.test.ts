import { describe, expect, it } from "vitest";
import {
  createSessionRequestSchema,
  sessionRuleProblem,
  updateSessionRequestSchema,
} from "./sessions";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const LATER = "2026-09-21T17:00:00.000Z";
const EARLIER = "2026-09-21T09:00:00.000Z";

describe("sessionRuleProblem", () => {
  it("allows a scheduled session with a closing time", () => {
    expect(
      sessionRuleProblem({
        executionMode: "INDIVIDUAL",
        closesAt: LATER,
        requireAllReady: true,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("allows an untimed session with a closing time", () => {
    expect(
      sessionRuleProblem({
        executionMode: null,
        closesAt: LATER,
        requireAllReady: false,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("refuses a closing time on a live session, whose shared timer already ends it", () => {
    expect(
      sessionRuleProblem({
        executionMode: "LIVE",
        closesAt: LATER,
        requireAllReady: false,
        nowMs: NOW,
      }),
    ).toMatch(/live session/i);
  });

  it("leaves a live session alone when it has no closing time", () => {
    expect(
      sessionRuleProblem({
        executionMode: "LIVE",
        closesAt: null,
        requireAllReady: true,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("refuses a closing time that has already passed", () => {
    expect(
      sessionRuleProblem({
        executionMode: "INDIVIDUAL",
        closesAt: EARLIER,
        requireAllReady: false,
        nowMs: NOW,
      }),
    ).toMatch(/past/i);
  });

  it("refuses a closing time that is not a date", () => {
    expect(
      sessionRuleProblem({
        executionMode: "INDIVIDUAL",
        closesAt: "tomorrow afternoon",
        requireAllReady: false,
        nowMs: NOW,
      }),
    ).toMatch(/valid date/i);
  });

  it("does not judge a past closing time when the caller has no clock", () => {
    expect(
      sessionRuleProblem({
        executionMode: "INDIVIDUAL",
        closesAt: EARLIER,
        requireAllReady: false,
      }),
    ).toBeNull();
  });

  it("treats readiness on its own as always allowed", () => {
    expect(
      sessionRuleProblem({ executionMode: null, closesAt: null, requireAllReady: true }),
    ).toBeNull();
  });
});

describe("createSessionRequestSchema", () => {
  it("accepts a session with neither a closing time nor a ready gate", () => {
    const parsed = createSessionRequestSchema.safeParse({ name: "Tuesday lab" });
    expect(parsed.success).toBe(true);
  });

  it("accepts an explicit null closing time", () => {
    const parsed = createSessionRequestSchema.safeParse({ name: "Tuesday lab", closesAt: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts an ISO closing time and a ready gate", () => {
    const parsed = createSessionRequestSchema.safeParse({
      name: "Tuesday lab",
      closesAt: LATER,
      requireAllReady: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.requireAllReady).toBe(true);
  });

  it("refuses a closing time that is not an ISO datetime", () => {
    const parsed = createSessionRequestSchema.safeParse({
      name: "Tuesday lab",
      closesAt: "2026-09-21",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("updateSessionRequestSchema", () => {
  it("accepts clearing the closing time on its own", () => {
    const parsed = updateSessionRequestSchema.safeParse({ closesAt: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts turning the ready gate off on its own", () => {
    const parsed = updateSessionRequestSchema.safeParse({ requireAllReady: false });
    expect(parsed.success).toBe(true);
  });

  it("still refuses an empty patch", () => {
    expect(updateSessionRequestSchema.safeParse({}).success).toBe(false);
  });
});
