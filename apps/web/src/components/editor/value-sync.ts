/**
 * Tells an echo of the Coder's own typing apart from a real change of the
 * buffer from outside.
 *
 * Monaco holds the text. React holds a copy, which it hands back to the editor
 * on every render — and when a Coder types quickly, that copy is a keystroke or
 * two behind what is already on screen. `@monaco-editor/react` treated any
 * difference as an outside change and replaced the whole document with the
 * stale copy, which threw the caret to the end of the file and dropped the
 * characters typed in between.
 *
 * So every value the editor emits is remembered until React catches up. A
 * value that arrives and is one of those is an echo, and is ignored. Anything
 * else — a language switch, a reset, a recovered draft — is genuinely new and
 * is applied.
 */

/** Bounded so a parent that never re-renders cannot grow this without limit. */
const MAX_PENDING = 256;

export type ValueSync = {
  /** The editor produced this value. */
  emitted: (value: string) => void;
  /**
   * Whether `incoming` from the parent should be written into the editor,
   * given what the editor holds now.
   */
  shouldApply: (incoming: string, current: string) => boolean;
};

export function createValueSync(): ValueSync {
  let pending: string[] = [];

  return {
    emitted(value) {
      pending.push(value);
      if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    },

    shouldApply(incoming, current) {
      // Caught up: nothing is in flight any more.
      if (incoming === current) {
        pending = [];
        return false;
      }

      const echo = pending.lastIndexOf(incoming);
      if (echo !== -1) {
        // React renders in order, so nothing older than this can still arrive.
        pending = pending.slice(echo + 1);
        return false;
      }

      pending = [];
      return true;
    },
  };
}
