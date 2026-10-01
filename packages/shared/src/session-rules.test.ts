import { describe, expect, it } from "vitest";
import { focusLossResponse } from "./anti-cheat";
import { antiCheatConfigSchema } from "./schemas/assessments";
import {
  countReadiness,
  everyoneReady,
  presenceOf,
  readinessStateOf,
  rosterSource,
  type ReadinessRow,
} from "./session-readiness";

describe("countReadiness", () => {
  const row = (overrides: Partial<ReadinessRow>): ReadinessRow => ({
    onRoster: true,
    readyState: "NOT_READY",
    presence: "HERE",
    ...overrides,
  });

  it("puts everyone on the roster in exactly one bucket", () => {
    const counts = countReadiness([
      row({ readyState: "READY" }),
      row({ readyState: "READY" }),
      row({ readyState: "NOT_READY" }),
      row({ readyState: "READY", presence: "OFFLINE" }),
      row({ presence: "ELSEWHERE" }),
    ]);
    expect(counts).toEqual({ ready: 2, notReady: 2, offline: 1, total: 5 });
    expect(counts.ready + counts.notReady + counts.offline).toBe(counts.total);
  });

  it("counts a ready Coder who is offline as offline", () => {
    expect(countReadiness([row({ readyState: "READY", presence: "OFFLINE" })]).ready).toBe(0);
  });

  it("counts a READY left behind on another page as not ready, not offline", () => {
    expect(countReadiness([row({ readyState: "READY", presence: "ELSEWHERE" })])).toEqual({
      ready: 0,
      notReady: 1,
      offline: 0,
      total: 1,
    });
  });

  it("ignores Coders the session was not expecting", () => {
    expect(countReadiness([row({ onRoster: false, readyState: "READY" })]).total).toBe(0);
  });

  it("is only fully ready when there is someone to be ready", () => {
    expect(everyoneReady({ ready: 3, notReady: 0, offline: 0, total: 3 })).toBe(true);
    expect(everyoneReady({ ready: 2, notReady: 0, offline: 1, total: 3 })).toBe(false);
    expect(everyoneReady({ ready: 0, notReady: 0, offline: 0, total: 0 })).toBe(false);
  });
});

describe("rosterSource", () => {
  it("expects the whole Module when the session is open to it, list or no list", () => {
    expect(rosterSource({ access: "MODULE", isOpenAccess: false, listedCount: 0 })).toBe("MODULE");
    expect(rosterSource({ access: "MODULE", isOpenAccess: false, listedCount: 3 })).toBe("MODULE");
  });

  it("expects the list when the session is limited to one", () => {
    expect(rosterSource({ access: "LISTED", isOpenAccess: false, listedCount: 2 })).toBe("LIST");
  });

  it("expects nobody from a limited session with nobody chosen yet", () => {
    expect(rosterSource({ access: "LISTED", isOpenAccess: false, listedCount: 0 })).toBe("NONE");
  });

  it("expects nobody from the open-access session, which has no lobby", () => {
    expect(rosterSource({ access: "MODULE", isOpenAccess: true, listedCount: 0 })).toBe("NONE");
  });
});

describe("presence", () => {
  it("is HERE whenever this session's page holds a connection", () => {
    expect(presenceOf({ connectionState: "ONLINE", platformOnline: false })).toBe("HERE");
    expect(presenceOf({ connectionState: "ONLINE", platformOnline: true })).toBe("HERE");
  });

  it("tells a Coder on another page apart from one who is gone", () => {
    expect(presenceOf({ connectionState: "OFFLINE", platformOnline: true })).toBe("ELSEWHERE");
    expect(presenceOf({ connectionState: "OFFLINE", platformOnline: false })).toBe("OFFLINE");
  });

  it("labels a participant by the same rule the counts use", () => {
    expect(readinessStateOf({ readyState: "READY", presence: "HERE" })).toBe("READY");
    expect(readinessStateOf({ readyState: "NOT_READY", presence: "HERE" })).toBe("NOT_READY");
    expect(readinessStateOf({ readyState: "READY", presence: "ELSEWHERE" })).toBe("ELSEWHERE");
    expect(readinessStateOf({ readyState: "READY", presence: "OFFLINE" })).toBe("OFFLINE");
  });
});

describe("focusLossResponse", () => {
  const config = (overrides: Partial<ReturnType<typeof antiCheatConfigSchema.parse>>) =>
    antiCheatConfigSchema.parse({ detectFocusLoss: true, ...overrides });

  it("does nothing when detection is off, whatever the action", () => {
    expect(
      focusLossResponse(config({ detectFocusLoss: false, focusLossAction: "AUTO_SUBMIT" }), 99),
    ).toBe("NONE");
  });

  it("tolerates exactly the threshold before acting", () => {
    const warn = config({ focusLossAction: "WARN", focusLossThreshold: 2 });
    expect(focusLossResponse(warn, 1)).toBe("NONE");
    expect(focusLossResponse(warn, 2)).toBe("NONE");
    expect(focusLossResponse(warn, 3)).toBe("WARN");
    expect(focusLossResponse(warn, 4)).toBe("WARN");
  });

  it("acts on the first loss with a threshold of zero", () => {
    expect(focusLossResponse(config({ focusLossAction: "AUTO_SUBMIT" }), 1)).toBe("AUTO_SUBMIT");
  });

  it("only logs under LOG_ONLY", () => {
    expect(focusLossResponse(config({ focusLossAction: "LOG_ONLY" }), 10)).toBe("NONE");
  });

  it("reads a stored empty config as every control off", () => {
    expect(antiCheatConfigSchema.parse({})).toEqual({
      blockClipboard: false,
      blockContextMenu: false,
      detectFocusLoss: false,
      focusLossAction: "LOG_ONLY",
      focusLossThreshold: 0,
      hideLeaderboard: false,
    });
  });
});
