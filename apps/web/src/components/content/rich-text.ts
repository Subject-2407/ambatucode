import {
  INTERACTIVE_BLOCK_NODE_TYPE,
  type RichTextDocument,
  type RichTextNode,
} from "@ambatucode/shared";

/**
 * Pure helpers behind the Material renderer.
 *
 * They live apart from the component so the rules that matter — which links
 * are safe to render, and whether a document says anything at all — can be
 * tested directly rather than through a DOM.
 */

/**
 * Link schemes a Material may use.
 *
 * Material content is authored by an Architect, but "authored by a trusted
 * role" is not the same as "safe to render": an href is executable in a
 * browser, and `javascript:` in a stored document would run in every reader's
 * session. Anything not on this list becomes a plain span with no href.
 */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function sanitizeHref(href: unknown): string | null {
  if (typeof href !== "string" || href.trim() === "") return null;

  const value = href.trim();

  // A relative link stays inside the app and carries no scheme to abuse.
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  // A protocol-relative href ("//host/path") is neither: it leaves the site
  // while inheriting whatever scheme the page happens to be served over. It
  // reads like a path to whoever typed it, so it is refused rather than
  // silently turned into an external link.
  if (value.startsWith("//")) return null;

  try {
    // The base only matters for parsing; an absolute href ignores it.
    const parsed = new URL(value, "https://ambatucode.invalid");
    return SAFE_LINK_SCHEMES.has(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** True when the document holds no text and no block worth rendering. */
export function isEmptyDocument(document: RichTextDocument): boolean {
  return document.content.every(isEmptyNode);
}

function isEmptyNode(node: RichTextNode): boolean {
  // A rule, an image, or an interactive block is content even with nothing
  // inside it. The block is a leaf carrying everything in its attrs, so
  // counting children would read a whole simulation as an empty Material.
  if (
    node.type === "horizontalRule" ||
    node.type === "image" ||
    node.type === INTERACTIVE_BLOCK_NODE_TYPE
  ) {
    return false;
  }
  if (typeof node.text === "string" && node.text.trim() !== "") return false;
  return (node.content ?? []).every(isEmptyNode);
}

/** Heading levels the renderer supports; anything else falls back to a body paragraph. */
export function headingLevel(attrs: Record<string, unknown> | undefined): 1 | 2 | 3 | null {
  const level = attrs?.level;
  return level === 1 || level === 2 || level === 3 ? level : null;
}
