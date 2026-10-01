import type { InteractiveBlockAttrs } from "@ambatucode/shared";

/**
 * Whether the dialog holds edits the Architect would lose by cancelling.
 *
 * Every field counts, including the ones the dialog does not show: a block
 * whose height or id changed under it is no longer the block it was opened on.
 */
export function blockChanged(opened: InteractiveBlockAttrs, draft: InteractiveBlockAttrs): boolean {
  return (
    opened.id !== draft.id ||
    opened.title !== draft.title ||
    opened.html !== draft.html ||
    opened.css !== draft.css ||
    opened.js !== draft.js ||
    opened.initialHeight !== draft.initialHeight
  );
}

/**
 * What the preview pane says when it is not showing the block, or null when
 * it is.
 *
 * The preview runs on a debounced copy of the draft, so for half a second
 * after a fix the preview can still be failing on text that is already fine.
 * Telling the Architect to fix fields that are no longer flagged sends them
 * looking for a problem that is gone; in that window the pane says it is
 * catching up instead.
 */
export function previewNotice(state: {
  /** Whether the debounced copy, the one the frame would run, is valid. */
  previewValid: boolean;
  /** Whether the draft as it stands right now is valid. */
  draftValid: boolean;
  /** Labels of the panes over their size limit right now. */
  overflowing: readonly string[];
  /** The first validation message for the draft as it stands, if any. */
  firstIssue?: string;
}): string | null {
  if (state.overflowing.length > 0) {
    return `Trim ${state.overflowing.join(", ")} back under the limit to see a preview.`;
  }
  if (state.previewValid) return null;
  if (state.draftValid) return "Updating the preview…";
  return state.firstIssue
    ? `The preview cannot run this block: ${state.firstIssue}`
    : "The preview cannot run this block as it stands.";
}
