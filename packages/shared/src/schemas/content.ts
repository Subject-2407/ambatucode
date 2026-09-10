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
