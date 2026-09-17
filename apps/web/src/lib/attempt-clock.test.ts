import { describe, expect, it } from "vitest";
import {
  TIMER_DANGER_MS,
  TIMER_WARNING_MS,
  describeRemaining,
  formatRemaining,
  measureSkew,
  remainingFrom,
  shouldAnnounceTier,
  timerTier,
} from "./attempt-clock";

describe("measureSkew", () => {
  it("is zero when the clocks agree", () => {
    expect(measureSkew(1_000, 1_000)).toBe(0);
  });

  it("is positive when the browser runs behind the server", () => {
    expect(measureSkew(10_000, 7_000)).toBe(3_000);
  });

  it("is negative when the browser runs ahead of the server", () => {
    expect(measureSkew(7_000, 10_000)).toBe(-3_000);
  });
});

describe("remainingFrom", () => {
  it("corrects a browser clock that is minutes behind", () => {
    // Server says the deadline is at 600_000 and that it is now 300_000, while
    // the browser thinks it is 0. Five minutes are left, not ten.
    const skew = measureSkew(300_000, 0);
    expect(remainingFrom(600_000, skew, 0)).toBe(300_000);
  });

  it("corrects a browser clock that is minutes ahead", () => {
    const skew = measureSkew(300_000, 600_000);
    expect(remainingFrom(600_000, skew, 600_000)).toBe(300_000);
  });

  it("never reports negative time", () => {
    expect(remainingFrom(1_000, 0, 60_000)).toBe(0);
  });
});

describe("timerTier", () => {
  it("escalates at five minutes and at one minute", () => {
    expect(timerTier(TIMER_WARNING_MS + 1)).toBe("normal");
    expect(timerTier(TIMER_WARNING_MS)).toBe("warning");
    expect(timerTier(TIMER_DANGER_MS + 1)).toBe("warning");
    expect(timerTier(TIMER_DANGER_MS)).toBe("danger");
    expect(timerTier(0)).toBe("expired");
  });
});

describe("formatRemaining", () => {
  it("rounds up so a live deadline never reads as zero", () => {
    expect(formatRemaining(1)).toBe("00:01");
    expect(formatRemaining(999)).toBe("00:01");
    expect(formatRemaining(0)).toBe("00:00");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatRemaining(90_000)).toBe("01:30");
    expect(formatRemaining(59 * 60_000)).toBe("59:00");
  });

  it("widens to hours only when there is an hour to show", () => {
    expect(formatRemaining(60 * 60_000)).toBe("1:00:00");
    expect(formatRemaining(2 * 60 * 60_000 + 5_000)).toBe("2:00:05");
  });
});

describe("describeRemaining", () => {
  it("reads as words for the live region", () => {
    expect(describeRemaining(0)).toBe("Time is up");
    expect(describeRemaining(45_000)).toBe("45 seconds remaining");
    expect(describeRemaining(120_000)).toBe("2 minutes remaining");
    expect(describeRemaining(125_000)).toBe("2 minutes 5 seconds remaining");
  });
});

describe("shouldAnnounceTier", () => {
  it("announces each escalation once", () => {
    expect(shouldAnnounceTier("warning", [])).toBe(true);
    expect(shouldAnnounceTier("warning", ["warning"])).toBe(false);
    expect(shouldAnnounceTier("danger", ["warning"])).toBe(true);
  });

  it("stays quiet for the ordinary and the finished states", () => {
    expect(shouldAnnounceTier("normal", [])).toBe(false);
    // Expiry has its own modal; the countdown does not also shout about it.
    expect(shouldAnnounceTier("expired", [])).toBe(false);
  });
});
