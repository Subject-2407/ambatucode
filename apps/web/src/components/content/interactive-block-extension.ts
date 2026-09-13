import { Node, mergeAttributes } from "@tiptap/core";
import {
  DEFAULT_BLOCK_HEIGHT,
  INTERACTIVE_BLOCK_NODE_TYPE,
  type InteractiveBlockAttrs,
} from "@ambatucode/shared";

/**
 * The TipTap node behind an Interactive Block.
 *
 * It is an atom: a leaf the editor treats as one indivisible thing. Everything
 * the block is lives in its attrs, so there is no inner document for a cursor
 * to wander into and nothing for the Architect to half-delete.
 *
 * The node carries no DOM parsing rules for authored markup, and it never
 * renders authored HTML into the editor's own document — the placeholder below
 * is all the editor draws. The real content only ever executes inside the
 * sandboxed frame, which is the entire point of the feature.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    interactiveBlock: {
      insertInteractiveBlock: (attrs: InteractiveBlockAttrs) => ReturnType;
      updateInteractiveBlock: (attrs: InteractiveBlockAttrs) => ReturnType;
    };
  }
}

/** Opaque, URL-safe, and short. Matches the id shape the shared schema enforces. */
export function newBlockId(): string {
  return `blk_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function emptyBlock(): InteractiveBlockAttrs {
  return {
    id: newBlockId(),
    title: "",
    html: "",
    css: "",
    js: "",
    initialHeight: DEFAULT_BLOCK_HEIGHT,
  };
}

export const InteractiveBlockExtension = Node.create({
  name: INTERACTIVE_BLOCK_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: "" },
      title: { default: "" },
      html: { default: "" },
      css: { default: "" },
      js: { default: "" },
      initialHeight: { default: DEFAULT_BLOCK_HEIGHT },
    };
  },

  parseHTML() {
    // Only the editor's own serialization round-trips. Pasted markup from
    // anywhere else is never adopted as a block.
    return [{ tag: `div[data-type="${INTERACTIVE_BLOCK_NODE_TYPE}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    // A placeholder element, never the authored content. The editor's document
    // is the application's own DOM, and nothing authored may execute there.
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": INTERACTIVE_BLOCK_NODE_TYPE,
        class: "interactive-block-node",
      }),
      ["span", {}, `Interactive block${HTMLAttributes.title ? `: ${HTMLAttributes.title}` : ""}`],
    ];
  },

  addCommands() {
    return {
      insertInteractiveBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: INTERACTIVE_BLOCK_NODE_TYPE, attrs }),

      updateInteractiveBlock:
        (attrs) =>
        ({ commands }) =>
          commands.updateAttributes(INTERACTIVE_BLOCK_NODE_TYPE, attrs),
    };
  },
});
