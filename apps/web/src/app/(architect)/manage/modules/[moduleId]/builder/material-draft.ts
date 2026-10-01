import type { RichTextDocument } from "@ambatucode/shared";
import { isEmptyDocument } from "@/components/content/rich-text";

/**
 * The part of a Material the editor holds as a draft, and how to tell whether
 * the draft still matches what was saved.
 */
export type MaterialDraft = {
  title: string;
  content: RichTextDocument;
  isPublished: boolean;
};

export function materialIsDirty(saved: MaterialDraft, draft: MaterialDraft): boolean {
  return (
    draft.title !== saved.title ||
    draft.isPublished !== saved.isPublished ||
    !sameDocument(saved.content, draft.content)
  );
}

/**
 * Structural, not textual, equality.
 *
 * The saved document comes back from a JSONB column, which stores object keys
 * in its own order, while the editor emits them in the order its schema lists
 * them. Comparing serialised strings would report every freshly opened
 * Material as edited. Two documents with nothing in them are also the same:
 * the editor writes an empty paragraph where the database holds an empty list,
 * and typing a word and deleting it again is not an edit.
 */
export function sameDocument(a: RichTextDocument, b: RichTextDocument): boolean {
  if (isEmptyDocument(a) && isEmptyDocument(b)) return true;
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;

  // An absent key and a key holding `undefined` say the same thing, and the
  // two sides of this comparison do not agree on which one they use.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Why a Coder would not see this Material, or null when they would.
 *
 * Both flags count. A published Material inside a draft Module is still
 * invisible, and that combination is the one an Architect is most likely to
 * miss: the Material's own checkbox says "Published".
 */
export function hiddenFromCoders(state: {
  materialPublished: boolean;
  modulePublished: boolean;
}): string | null {
  if (!state.materialPublished && !state.modulePublished) {
    return "This material and its module are both drafts.";
  }
  if (!state.materialPublished) return "This material is a draft.";
  if (!state.modulePublished) {
    return "This material is published, but its module is a draft, so Coders cannot reach it yet.";
  }
  return null;
}
