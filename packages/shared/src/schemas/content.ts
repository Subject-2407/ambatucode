import { z } from "zod";
import { COMPARISON_MODES, LANGUAGES } from "../enums";

/**
 * The shapes stored in the `Json` columns of the content models. Prisma types
 * those columns as `Json`, which is to say untyped — so these schemas are the
 * only thing standing between a malformed document and a Material that no
 * longer renders.
 *
 * They are parsed on the way in (a route handler validating an Architect's
 * edit) and on the way out (a reader turning a stored column into props),
 * because a column written by an older shape is exactly as untrusted as a
 * request body.
 */

// --- Rich text (Material.contentJson) ---------------------------------------

export type RichTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: RichTextMark[];
  text?: string;
  content?: RichTextNode[];
};

export const richTextMarkSchema: z.ZodType<RichTextMark> = z.object({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Node types and attributes are deliberately open: the editor's extension set
 * decides what a paragraph or a code block looks like, and pinning that list
 * here would mean a schema change every time the toolbar grows. What is closed
 * is the tree's shape, which is what a renderer actually depends on.
 */
export const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z.array(richTextMarkSchema).optional(),
    text: z.string().optional(),
    content: z.array(richTextNodeSchema).optional(),
  }),
);

export const richTextDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(richTextNodeSchema).default([]),
});

export type RichTextDocument = z.infer<typeof richTextDocumentSchema>;

/** What a Material holds before anyone has typed into it. */
export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = { type: "doc", content: [] };

// --- Starter code (PracticeActivity / Assessment starterCodeJson) -----------

/**
 * Language to starter source. Partial on purpose: an activity that allows
 * three languages need not ship starter code for all three, and an absent
 * entry means an empty editor rather than an error.
 */
export const starterCodeMapSchema = z.partialRecord(z.enum(LANGUAGES), z.string());

export type StarterCodeMap = z.infer<typeof starterCodeMapSchema>;

// --- Practice test cases (PracticeActivity.testCasesJson) -------------------

/**
 * A practice case as stored and as shown.
 *
 * There is no `kind` and no `isPublic`: every practice case is visible to the
 * Coder by definition, which is what separates practice from an Assessment. If
 * a case ever needs hiding, the exercise belongs in an Assessment instead —
 * adding a hidden flag here would quietly turn practice into ungraded
 * examination and route it through code paths that never expected secrets.
 *
 * There is no `weight` either, because practice produces no grade.
 */
export const practiceTestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  input: z.string(),
  expectedOutput: z.string(),
  /** Trimmed suits teaching contexts: trailing whitespace is rarely the lesson. */
  comparison: z.enum(COMPARISON_MODES).default("TRIMMED"),
});

export type PracticeTestCase = z.infer<typeof practiceTestCaseSchema>;

export const practiceTestCasesSchema = z.array(practiceTestCaseSchema);

// --- Interactive Blocks (nodes inside Material.contentJson) ------------------

/**
 * Architect-authored HTML, CSS, and JavaScript, stored as a node inside the
 * Material that contains it. There is no table and no endpoint of its own: a
 * block and the prose around it save together, version together, and leave no
 * orphan row behind when the block is deleted from the document.
 *
 * This is the one place the open node schema above is not enough.
 * `richTextNodeSchema` types `attrs` as an open record so the toolbar can grow
 * without a schema change. An `interactiveBlock` is the exception, because its
 * attrs are concatenated into a document that *executes*. Its shape is closed,
 * and it is validated in both directions — on the Architect's save and on the
 * way out to a reader — since a column written by an older editor build is
 * exactly as untrusted as a request body, and this particular column runs.
 *
 * What is deliberately absent is any attempt to sanitize, strip, or rewrite the
 * authored content. Safety comes from *where* it runs — an opaque-origin
 * sandboxed frame with no network and no platform data — not from filtering it
 * on the way past. A sanitizer would break legitimate authoring, give false
 * assurance, and be bypassed anyway. Validate size and shape; never police
 * content.
 */
export const INTERACTIVE_BLOCK_NODE_TYPE = "interactiveBlock";

/** Per-field ceilings, in bytes of UTF-8. */
export const MAX_BLOCK_HTML_BYTES = 128 * 1024;
export const MAX_BLOCK_CSS_BYTES = 64 * 1024;
export const MAX_BLOCK_JS_BYTES = 128 * 1024;

/** Per-Material ceilings. */
export const MAX_BLOCKS_PER_MATERIAL = 20;
export const MAX_BLOCK_BYTES_PER_MATERIAL = 512 * 1024;

export const MIN_BLOCK_HEIGHT = 120;
export const MAX_BLOCK_HEIGHT = 4000;
export const DEFAULT_BLOCK_HEIGHT = 320;

/** The id shape, kept in one place so the walk and the schema cannot drift. */
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Bytes, not `String.length`.
 *
 * A document of emoji or CJK text is roughly three times heavier than its
 * character count suggests, so a character-counted limit lets through payloads
 * three times the size the budget was written to allow — and rejects honest
 * ASCII well before the real ceiling. What costs storage and bandwidth is
 * bytes, so bytes is what the limits count.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function boundedUtf8(limitBytes: number, field: string) {
  return z.string().refine((value) => utf8ByteLength(value) <= limitBytes, {
    message: `${field} is larger than ${Math.round(limitBytes / 1024)} KiB`,
  });
}

export const interactiveBlockAttrsSchema = z.object({
  /**
   * Stable across edits. Keys the frame and its resize state, and is echoed
   * back in validation errors — hence an opaque token rather than free text, so
   * a block id can never carry markup or a newline into a label or a log line.
   */
  id: z.string().regex(BLOCK_ID_PATTERN, "Block id must be 1-64 of A-Z, a-z, 0-9, _ or -"),
  title: z.string().trim().max(160).default(""),
  html: boundedUtf8(MAX_BLOCK_HTML_BYTES, "HTML").default(""),
  css: boundedUtf8(MAX_BLOCK_CSS_BYTES, "CSS").default(""),
  js: boundedUtf8(MAX_BLOCK_JS_BYTES, "JavaScript").default(""),
  /** Pre-measurement height, so the page does not jump on load. */
  initialHeight: z
    .number()
    .int()
    .min(MIN_BLOCK_HEIGHT)
    .max(MAX_BLOCK_HEIGHT)
    .default(DEFAULT_BLOCK_HEIGHT),
});

export type InteractiveBlockAttrs = z.infer<typeof interactiveBlockAttrsSchema>;

/** What one block costs against the per-Material budget. */
export function interactiveBlockByteSize(attrs: { html: string; css: string; js: string }): number {
  return utf8ByteLength(attrs.html) + utf8ByteLength(attrs.css) + utf8ByteLength(attrs.js);
}

/** Every `interactiveBlock` node in the tree, in document order, at any depth. */
export function findInteractiveBlockNodes(document: RichTextDocument): RichTextNode[] {
  const found: RichTextNode[] = [];

  const walk = (nodes: RichTextNode[]) => {
    for (const node of nodes) {
      if (node.type === INTERACTIVE_BLOCK_NODE_TYPE) found.push(node);
      // Descend regardless of the match: a block nested inside a list item or
      // a blockquote still executes, and a walk that stopped at the first hit
      // would miss exactly the ones someone buried on purpose.
      if (node.content) walk(node.content);
    }
  };

  walk(document.content);
  return found;
}

export function documentHasInteractiveBlock(document: RichTextDocument): boolean {
  return findInteractiveBlockNodes(document).length > 0;
}

/** One thing wrong with one block, phrased so an Architect can act on it. */
export type InteractiveBlockProblem = {
  /** The block's id when it has a usable one; null when that is what is wrong. */
  blockId: string | null;
  /** Document order, so a block with no id can still be pointed at. */
  index: number;
  message: string;
};

export type InteractiveBlockValidation =
  | { ok: true; blocks: InteractiveBlockAttrs[] }
  | { ok: false; problems: InteractiveBlockProblem[] };

/**
 * Validates every Interactive Block in a document against its own shape and
 * against the Material's budgets.
 *
 * Problems are collected rather than thrown on the first one, and each names
 * its block. An Architect who pasted 200 KiB of JavaScript needs to know which
 * block to trim — "content is invalid" sends them hunting through twenty.
 */
export function validateInteractiveBlocks(document: RichTextDocument): InteractiveBlockValidation {
  const nodes = findInteractiveBlockNodes(document);
  const problems: InteractiveBlockProblem[] = [];
  const blocks: InteractiveBlockAttrs[] = [];
  const seenIds = new Set<string>();
  let totalBytes = 0;

  nodes.forEach((node, index) => {
    const rawId = node.attrs?.id;
    const blockId = typeof rawId === "string" && BLOCK_ID_PATTERN.test(rawId) ? rawId : null;

    // The node is a leaf. Children would be prose the reader never sees,
    // because what renders is the frame, not the node's content.
    if ((node.content?.length ?? 0) > 0 || typeof node.text === "string") {
      problems.push({
        blockId,
        index,
        message: "An interactive block cannot contain other content",
      });
      return;
    }

    const parsed = interactiveBlockAttrsSchema.safeParse(node.attrs ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({ blockId, index, message: issue.message });
      }
      return;
    }

    if (seenIds.has(parsed.data.id)) {
      // Two blocks sharing an id collide on the frame key and on the resize
      // state keyed by it, so one would inherit the other's measured height.
      problems.push({
        blockId: parsed.data.id,
        index,
        message: "Two interactive blocks share this id",
      });
      return;
    }
    seenIds.add(parsed.data.id);

    totalBytes += interactiveBlockByteSize(parsed.data);
    blocks.push(parsed.data);
  });

  if (nodes.length > MAX_BLOCKS_PER_MATERIAL) {
    problems.push({
      blockId: null,
      index: MAX_BLOCKS_PER_MATERIAL,
      message: `A material may hold at most ${MAX_BLOCKS_PER_MATERIAL} interactive blocks; this one has ${nodes.length}`,
    });
  }

  if (totalBytes > MAX_BLOCK_BYTES_PER_MATERIAL) {
    const used = Math.round(totalBytes / 1024);
    const budget = Math.round(MAX_BLOCK_BYTES_PER_MATERIAL / 1024);
    problems.push({
      blockId: null,
      index: -1,
      message: `Interactive blocks total ${used} KiB, over the ${budget} KiB budget for one material`,
    });
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, blocks };
}

/** Renders a validation failure as one sentence naming the offending blocks. */
export function describeInteractiveBlockProblems(problems: InteractiveBlockProblem[]): string {
  return problems
    .map((problem) =>
      problem.blockId === null ? problem.message : `block ${problem.blockId}: ${problem.message}`,
    )
    .join("; ");
}
