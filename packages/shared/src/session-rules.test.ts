import { describe, expect, it } from "vitest";
import { focusLossResponse } from "./anti-cheat";
import { antiCheatConfigSchema } from "./schemas/assessments";
import { countReadiness, everyoneReady, type ReadinessRow } from "./session-readiness";

describe("countReadiness", () => {
  const row = (overrides: Partial<ReadinessRow>): ReadinessRow => ({
    isListed: true,
    readyState: "NOT_READY",
    connectionState: "ONLINE",
    ...overrides,
  });

  it("puts every listed participant in exactly one bucket", () => {
    const counts = countReadiness([
      row({ readyState: "READY" }),
      row({ readyState: "READY" }),
      row({ readyState: "NOT_READY" }),
      row({ readyState: "READY", connectionState: "OFFLINE" }),
    ]);
    expect(counts).toEqual({ ready: 2, notReady: 1, offline: 1, total: 4 });
    expect(counts.ready + counts.notReady + counts.offline).toBe(counts.total);
  });

  it("counts a ready Coder who is offline as offline", () => {
    expect(countReadiness([row({ readyState: "READY", connectionState: "OFFLINE" })]).ready).toBe(
      0,
    );
  });

  it("ignores Coders who joined an open session without being listed", () => {
    expect(countReadiness([row({ isListed: false, readyState: "READY" })]).total).toBe(0);
  });

  it("is only fully ready when there is someone to be ready", () => {
    expect(everyoneReady({ ready: 3, notReady: 0, offline: 0, total: 3 })).toBe(true);
    expect(everyoneReady({ ready: 2, notReady: 0, offline: 1, total: 3 })).toBe(false);
    expect(everyoneReady({ ready: 0, notReady: 0, offline: 0, total: 0 })).toBe(false);
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
