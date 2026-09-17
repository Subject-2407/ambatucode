import type { AntiCheatConfig } from "./schemas/assessments";

export type FocusLossResponse = "NONE" | "WARN" | "AUTO_SUBMIT";

/**
 * What the server does about a focus loss, given how many the attempt has now
 * logged (this one included).
 *
 * Every loss is logged regardless; this only decides the action on top. The
 * threshold is the number tolerated before the action fires, so a threshold of
 * 2 lets two losses pass and acts on the third — and a warning keeps firing on
 * every loss after that, because a warning the Coder stops receiving is one
 * they can safely ignore.
 */
export function focusLossResponse(config: AntiCheatConfig, lossCount: number): FocusLossResponse {
  if (!config.detectFocusLoss) return "NONE";
  if (lossCount <= config.focusLossThreshold) return "NONE";
  switch (config.focusLossAction) {
    case "LOG_ONLY":
      return "NONE";
    case "WARN":
      return "WARN";
    case "AUTO_SUBMIT":
      return "AUTO_SUBMIT";
  }
}
