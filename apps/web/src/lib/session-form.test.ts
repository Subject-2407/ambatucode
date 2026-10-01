import { describe, expect, it } from "vitest";
import type { SessionView } from "@ambatucode/shared";
import {
  buildCreateRequest,
  buildUpdateRequest,
  formFromSession,
  fromDateTimeLocal,
  toDateTimeLocal,
  type SessionForm,
} from "./session-form";

const NOW = Date.parse("2026-10-01T09:00:00.000Z");

function form(overrides: Partial<SessionForm> = {}): SessionForm {
  return {
    name: "Class A",
    access: "MODULE",
    executionMode: "INDIVIDUAL",
    durationMinutes: "45",
    closesAt: "",
    requireAllReady: false,
    openLobby: true,
    ...overrides,
  };
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    assessmentId: "a1",
    moduleId: "m1",
    name: "Class A",
    executionMode: "INDIVIDUAL",
    durationMinutes: 45,
    status: "DRAFT",
    startedAt: null,
    endsAt: null,
    closesAt: null,
    requireAllReady: false,
    startedWithMissingParticipants: false,
    access: "MODULE",
    isOpenAccess: false,
    listedParticipantCount: 0,
    isRestricted: false,
    rosterSource: "MODULE",
    attemptCount: 0,
    submissionCount: 0,
    createdAt: "2026-09-30T09:00:00.000Z",
    updatedAt: "2026-09-30T09:00:00.000Z",
    ...overrides,
  };
}

describe("datetime-local conversion", () => {
  it("round-trips an instant through the local wall clock to the minute", () => {
    const iso = "2026-10-02T13:45:00.000Z";
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it("treats an empty field as no closing time", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(fromDateTimeLocal("  ")).toBeNull();
  });
});

describe("buildCreateRequest", () => {
  it("sends timing only for a timed assessment", () => {
    const untimed = buildCreateRequest(form(), { timed: false, nowMs: NOW });
    expect(untimed.ok && "executionMode" in untimed.request).toBe(false);

    const timed = buildCreateRequest(form(), { timed: true, nowMs: NOW });
    expect(timed).toMatchObject({
      ok: true,
      request: { executionMode: "INDIVIDUAL", durationMinutes: 45, access: "MODULE" },
    });
  });

  it("drops a closing time for a live session and always waits for the room", () => {
    const result = buildCreateRequest(
      form({ executionMode: "LIVE", closesAt: "2026-10-02T10:00", requireAllReady: false }),
      { timed: true, nowMs: NOW },
    );
    expect(result).toMatchObject({ ok: true, request: { closesAt: null, requireAllReady: true } });
  });

  it("refuses a closing time already in the past", () => {
    const result = buildCreateRequest(form({ closesAt: "2020-01-01T10:00" }), {
      timed: true,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, error: "The closing time is already in the past" });
  });

  it("passes the lobby choice through", () => {
    const result = buildCreateRequest(form({ openLobby: false }), { timed: true, nowMs: NOW });
    expect(result).toMatchObject({ ok: true, request: { openLobby: false } });
  });

  it("refuses an empty name", () => {
    expect(buildCreateRequest(form({ name: "  " }), { timed: true, nowMs: NOW }).ok).toBe(false);
  });
});

describe("buildUpdateRequest", () => {
  it("sends nothing when nothing changed", () => {
    const original = session();
    expect(buildUpdateRequest(formFromSession(original), original, { nowMs: NOW })).toEqual({
      ok: true,
      request: null,
    });
  });

  it("does not judge an untouched closing time that has since passed", () => {
    const original = session({ closesAt: "2020-01-01T10:00:00.000Z" });
    const result = buildUpdateRequest({ ...formFromSession(original), name: "Renamed" }, original, {
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: true, request: { name: "Renamed" } });
  });

  it("clears the closing time when switching to live", () => {
    const original = session({ closesAt: "2026-10-05T10:00:00.000Z" });
    const result = buildUpdateRequest(
      { ...formFromSession(original), executionMode: "LIVE" },
      original,
      { nowMs: NOW },
    );
    expect(result).toEqual({
      ok: true,
      request: { executionMode: "LIVE", closesAt: null, requireAllReady: true },
    });
  });

  it("never sends timing for an untimed session", () => {
    const original = session({ executionMode: null, durationMinutes: null });
    const result = buildUpdateRequest(
      { ...formFromSession(original), durationMinutes: "90", requireAllReady: true },
      original,
      { nowMs: NOW },
    );
    expect(result).toEqual({ ok: true, request: { requireAllReady: true } });
  });
});
