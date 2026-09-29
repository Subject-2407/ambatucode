import type { AntiCheatConfig, ExecutionMode, ExitPolicy } from "@ambatucode/shared";
import { ANTI_CHEAT_NOTICE } from "./anti-cheat";

/**
 * The rules of an attempt, stated before the Coder starts it.
 *
 * The workspace has always said which anti-cheat controls were on — but only
 * once it was open, which for a timed Assessment means once the clock was
 * already running. Learning that pasting is blocked, or that leaving submits,
 * is worth nothing after the fact.
 *
 * Built from the same configuration and the same anti-cheat wording the
 * workspace uses, so the two screens cannot describe one Assessment
 * differently.
 */
export function describeAttemptRules(input: {
  executionMode: ExecutionMode | null;
  exitPolicy: ExitPolicy;
  antiCheat: Pick<AntiCheatConfig, "blockClipboard" | "blockContextMenu" | "detectFocusLoss">;
}): string[] {
  const rules = ["You get one submission. Run your code as often as you like before it."];

  if (input.executionMode === "LIVE") {
    rules.push("Everyone shares one clock, and it keeps running if you disconnect.");
  } else if (input.executionMode === "INDIVIDUAL") {
    rules.push("Your timer pauses if you disconnect.");
  }

  switch (input.exitPolicy) {
    case "RESUME":
      rules.push("You can leave and come back. Your code is saved.");
      break;
    case "SUBMIT":
      rules.push("Leaving the workspace submits your code.");
      break;
    case "BLOCKED":
      rules.push("You cannot leave the workspace until you submit.");
      break;
  }

  if (input.antiCheat.blockClipboard) rules.push(ANTI_CHEAT_NOTICE.clipboard);
  if (input.antiCheat.blockContextMenu) rules.push(ANTI_CHEAT_NOTICE.contextMenu);
  if (input.antiCheat.detectFocusLoss) rules.push(ANTI_CHEAT_NOTICE.focus);

  return rules;
}
