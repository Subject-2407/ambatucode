import type { AnticheatClipboardPayload } from "@ambatucode/shared";

/**
 * The rules behind the client-side anti-cheat controls, as pure functions.
 *
 * None of this is a security boundary. A Coder with developer tools open can
 * defeat every line of it, and that is understood: the purpose is deterrence
 * and an honest log, and the server is what actually decides what happens.
 * Keeping the rules here means they can be checked without a browser, and that
 * the components below stay free of half-remembered keyboard trivia.
 */

export type ClipboardAction = AnticheatClipboardPayload["action"];

/**
 * Whether a clipboard event should be stopped.
 *
 * Copying *within* the editor is left alone on purpose. Moving a line from one
 * place to another in one's own program is ordinary work, and blocking it
 * makes the editor hostile without preventing anything — the clipboard content
 * came from the Coder's own buffer either way. What the control is actually
 * for is transfer across the boundary: pasting a solution in, or lifting the
 * problem statement out.
 */
export function blocksClipboardEvent(input: {
  action: ClipboardAction;
  /** True when the event originated inside the code editor. */
  insideEditor: boolean;
}): boolean {
  if (input.action === "CONTEXT_MENU") return true;
  if (input.action === "PASTE") return true;
  return !input.insideEditor;
}

/**
 * The clipboard chord a key event represents, if any.
 *
 * `event.key` rather than `event.code`, because the Coder's layout decides
 * which physical key carries `c`. Shift is not excluded: `Ctrl+Shift+V` is
 * paste-without-formatting in most browsers and would otherwise walk straight
 * through a control that stopped `Ctrl+V`.
 */
export function clipboardChord(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): ClipboardAction | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  switch (event.key.toLowerCase()) {
    case "c":
      return "COPY";
    case "x":
      return "CUT";
    case "v":
      return "PASTE";
    default:
      return null;
  }
}

/**
 * How long the window must stay away before it counts as a focus loss.
 *
 * Short enough that switching to a search engine is caught, long enough that
 * the browser's own momentary blurs are not. A click into the address bar and
 * straight back, or the flicker some window managers produce when a dialog
 * opens, must not land in an Architect's incident feed as evidence.
 */
export const FOCUS_LOSS_DEBOUNCE_MS = 750;

/** The copy shown to the Coder. Deterrence works only when it is stated. */
export const ANTI_CHEAT_NOTICE = {
  clipboard: "Copying and pasting are restricted during this assessment.",
  focus: "Leaving this window is recorded.",
  contextMenu: "The right-click menu is disabled during this assessment.",
} as const;

/**
 * One line naming exactly which controls are on, so the workspace can say so
 * up front. Silent surveillance is not the goal, and a Coder who does not know
 * a control exists cannot be deterred by it.
 */
export function describeAntiCheat(config: {
  blockClipboard: boolean;
  blockContextMenu: boolean;
  detectFocusLoss: boolean;
}): string | null {
  const parts: string[] = [];
  if (config.blockClipboard) parts.push(ANTI_CHEAT_NOTICE.clipboard);
  if (config.blockContextMenu) parts.push(ANTI_CHEAT_NOTICE.contextMenu);
  if (config.detectFocusLoss) parts.push(ANTI_CHEAT_NOTICE.focus);
  return parts.length === 0 ? null : parts.join(" ");
}
