/**
 * A very small Markdown subset, parsed to a typed tree.
 *
 * Problem statements and Practice prompts are written by Architects in a plain
 * textarea and were rendered as preserved-whitespace text, which made anything
 * longer than a paragraph hard to read: no headings, no lists, no way to mark a
 * variable name apart from the prose around it.
 *
 * This parses rather than renders, and it produces data — never markup. The
 * renderer walks the tree and emits React elements, so authored content reaches
 * the page as text nodes and there is still no HTML path into the document.
 * That is the same rule Interactive Blocks follow for the same reason: an
 * Architect is a trusted role, not trusted code.
 *
 * The subset is deliberately small. Everything it does not recognise stays
 * exactly as it was typed, so the years of statements already written as plain
 * prose render as plain prose — a single newline is still a line break, and a
 * blank line still starts a paragraph.
 *
 * What it does not do, on purpose: links, images, tables, raw HTML, and nesting
 * inside emphasis. A problem statement that needs a table is a problem
 * statement that needs rewriting, and a clickable link inside a timed
 * assessment is a way out of the window rather than a feature.
 */

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "code"; value: string };

export type BlockNode =
  | { kind: "heading"; level: 1 | 2 | 3; content: InlineNode[] }
  | { kind: "paragraph"; content: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "quote"; content: InlineNode[] }
  | { kind: "code"; language: string | null; value: string }
  | { kind: "rule" };

/** Inline code first, so `**` inside a span of code is not emphasis. */
const INLINE_PATTERN = /`([^`\n]+)`|\*\*([^\n]+?)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;

const FENCE = /^```([A-Za-z0-9+#-]*)\s*$/;
// Up to six hashes are recognised and the level is capped at three. Three
// sizes are all a problem statement has room for, and refusing `####` outright
// would render it as a paragraph beginning with four hashes.
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;

function pushText(nodes: InlineNode[], value: string): void {
  if (value === "") return;
  const last = nodes[nodes.length - 1];
  // Adjacent runs are merged so a paragraph is one text node rather than one
  // per gap between markers, which keeps the rendered output free of the empty
  // spans an unmerged walk produces.
  if (last?.kind === "text") last.value += value;
  else nodes.push({ kind: "text", value });
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let index = 0;

  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(source);
  while (match !== null) {
    pushText(nodes, source.slice(index, match.index));

    const [whole, code, strong, star, underscore] = match;
    if (code !== undefined) nodes.push({ kind: "code", value: code });
    else if (strong !== undefined) nodes.push({ kind: "strong", value: strong });
    else if (star !== undefined) nodes.push({ kind: "em", value: star });
    else if (underscore !== undefined) nodes.push({ kind: "em", value: underscore });

    index = match.index + whole.length;
    match = INLINE_PATTERN.exec(source);
  }

  pushText(nodes, source.slice(index));
  return nodes;
}

/**
 * Consecutive lines of one kind become one block.
 *
 * Paragraph lines keep the newlines between them: an Architect who laid a
 * statement out by hand meant those breaks, and collapsing them the way a
 * Markdown renderer normally would reflows every statement written before this
 * existed.
 */
export function parseMarkdownLite(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence) {
      const language = fence[1] === undefined || fence[1] === "" ? null : fence[1];
      const body: string[] = [];
      index += 1;
      // An unterminated fence runs to the end rather than being abandoned: the
      // Architect is mid-edit, and dropping the block would blank the panel.
      while (index < lines.length && !FENCE.test((lines[index] ?? "").trim())) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, value: body.join("\n") });
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      const hashes = heading[1] ?? "#";
      const level = hashes.length === 1 ? 1 : hashes.length === 2 ? 2 : 3;
      blocks.push({ kind: "heading", level, content: parseInline(heading[2] ?? "") });
      index += 1;
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    const ordered = ORDERED.exec(trimmed);
    if (bullet || ordered) {
      const isOrdered = bullet === null;
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        const item = isOrdered ? ORDERED.exec(candidate) : BULLET.exec(candidate);
        if (!item) break;
        items.push(parseInline(item[1] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    if (QUOTE.test(trimmed)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const candidate = QUOTE.exec((lines[index] ?? "").trim());
        if (!candidate) break;
        quoted.push(candidate[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "quote", content: parseInline(quoted.join("\n")) });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      const candidateTrimmed = candidate.trim();
      if (
        candidateTrimmed === "" ||
        FENCE.test(candidateTrimmed) ||
        RULE.test(candidateTrimmed) ||
        HEADING.test(candidateTrimmed) ||
        BULLET.test(candidateTrimmed) ||
        ORDERED.test(candidateTrimmed) ||
        QUOTE.test(candidateTrimmed)
      ) {
        break;
      }
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

/** The one-line hint shown under an authoring field, so the subset is discoverable. */
export const MARKDOWN_LITE_HINT =
  "Supports # headings, **bold**, *italic*, `code`, ``` code blocks, - lists and > quotes.";
