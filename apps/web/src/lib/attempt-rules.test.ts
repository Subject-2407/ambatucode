import { describe, expect, it } from "vitest";
import { ANTI_CHEAT_NOTICE } from "./anti-cheat";
import { describeAttemptRules } from "./attempt-rules";

const noControls = { blockClipboard: false, blockContextMenu: false, detectFocusLoss: false };

describe("describeAttemptRules", () => {
  it("always leads with the single submission", () => {
    const rules = describeAttemptRules({
      executionMode: null,
      exitPolicy: "RESUME",
      antiCheat: noControls,
    });
    expect(rules[0]).toMatch(/one submission/);
  });

  it("makes opposite promises about the clock in the two timed modes", () => {
    const live = describeAttemptRules({
      executionMode: "LIVE",
      exitPolicy: "RESUME",
      antiCheat: noControls,
    });
    const individual = describeAttemptRules({
      executionMode: "INDIVIDUAL",
      exitPolicy: "RESUME",
      antiCheat: noControls,
    });
    expect(live.join(" ")).toMatch(/keeps running/);
    expect(individual.join(" ")).toMatch(/pauses/);
  });

  it("says nothing about a clock when there is none", () => {
    const rules = describeAttemptRules({
      executionMode: null,
      exitPolicy: "RESUME",
      antiCheat: noControls,
    });
    expect(rules.join(" ")).not.toMatch(/clock|timer/);
  });

  it("names what leaving does under each exit policy", () => {
    const text = (exitPolicy: "RESUME" | "SUBMIT" | "BLOCKED") =>
      describeAttemptRules({ executionMode: null, exitPolicy, antiCheat: noControls }).join(" ");
    expect(text("RESUME")).toMatch(/come back/);
    expect(text("SUBMIT")).toMatch(/submits your code/);
    expect(text("BLOCKED")).toMatch(/cannot leave/);
  });

  it("uses the workspace's own wording for each anti-cheat control that is on", () => {
    const rules = describeAttemptRules({
      executionMode: null,
      exitPolicy: "RESUME",
      antiCheat: { blockClipboard: true, blockContextMenu: false, detectFocusLoss: true },
    });
    expect(rules).toContain(ANTI_CHEAT_NOTICE.clipboard);
    expect(rules).toContain(ANTI_CHEAT_NOTICE.focus);
    expect(rules).not.toContain(ANTI_CHEAT_NOTICE.contextMenu);
  });
});
