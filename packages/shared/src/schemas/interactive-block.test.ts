import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCK_HEIGHT,
  MAX_BLOCKS_PER_MATERIAL,
  MAX_BLOCK_BYTES_PER_MATERIAL,
  MAX_BLOCK_JS_BYTES,
  describeInteractiveBlockProblems,
  documentHasInteractiveBlock,
  findInteractiveBlockNodes,
  interactiveBlockAttrsSchema,
  utf8ByteLength,
  validateInteractiveBlocks,
  type RichTextDocument,
  type RichTextNode,
} from "./content";

function blockNode(attrs: Record<string, unknown>): RichTextNode {
  return { type: "interactiveBlock", attrs };
}

function doc(...content: RichTextNode[]): RichTextDocument {
  return { type: "doc", content };
}

function validBlock(id: string, overrides: Record<string, unknown> = {}): RichTextNode {
  return blockNode({ id, title: "Binary search", html: "<div id=x></div>", ...overrides });
}

describe("utf8ByteLength", () => {
  it("counts bytes rather than characters", () => {
    // The whole reason the limits are byte-counted: this string is 2 characters
    // and 7 bytes, so a character-counted cap would let through more than three
    // times the payload it was written to allow.
    expect("日🙂".length).toBe(3);
    expect(utf8ByteLength("日🙂")).toBe(7);
  });
});

describe("interactiveBlockAttrsSchema", () => {
  it("fills in every optional field so a freshly inserted block is valid", () => {
    const parsed = interactiveBlockAttrsSchema.parse({ id: "blk_1" });

    expect(parsed).toEqual({
      id: "blk_1",
      title: "",
      html: "",
      css: "",
      js: "",
      initialHeight: DEFAULT_BLOCK_HEIGHT,
    });
  });

  it("rejects an id that is not an opaque token", () => {
    // A block id reaches labels and log lines, so it may not carry markup or a
    // newline into either.
    expect(interactiveBlockAttrsSchema.safeParse({ id: "<img onerror=x>" }).success).toBe(false);
    expect(interactiveBlockAttrsSchema.safeParse({ id: "a\nb" }).success).toBe(false);
    expect(interactiveBlockAttrsSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("rejects a height outside the clamp the host would apply anyway", () => {
    expect(interactiveBlockAttrsSchema.safeParse({ id: "b", initialHeight: 10 }).success).toBe(
      false,
    );
    expect(interactiveBlockAttrsSchema.safeParse({ id: "b", initialHeight: 99_999 }).success).toBe(
      false,
    );
  });
});

describe("findInteractiveBlockNodes", () => {
  it("finds blocks nested inside other nodes", () => {
    const document = doc(
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      validBlock("top"),
      {
        type: "blockquote",
        content: [{ type: "listItem", content: [validBlock("buried")] }],
      },
    );

    expect(findInteractiveBlockNodes(document).map((node) => node.attrs?.id)).toEqual([
      "top",
      "buried",
    ]);
    expect(documentHasInteractiveBlock(document)).toBe(true);
  });

  it("reports nothing for a document of plain prose", () => {
    expect(documentHasInteractiveBlock(doc({ type: "paragraph" }))).toBe(false);
  });
});

describe("validateInteractiveBlocks", () => {
  it("accepts a document whose blocks are well formed", () => {
    const result = validateInteractiveBlocks(doc(validBlock("one"), validBlock("two")));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks.map((block) => block.id)).toEqual(["one", "two"]);
  });

  it("rejects a block whose JavaScript is over the per-field limit", () => {
    const oversized = "a".repeat(MAX_BLOCK_JS_BYTES + 1);
    const result = validateInteractiveBlocks(doc(validBlock("fat", { js: oversized })));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(1);
      // Naming the block is the point: an Architect with twenty of them needs
      // to know which one to trim.
      expect(result.problems[0]?.blockId).toBe("fat");
      expect(describeInteractiveBlockProblems(result.problems)).toContain("block fat:");
    }
  });

  it("measures the per-field limit in bytes, not characters", () => {
    // Each emoji is 4 bytes, so this is a quarter of the character count and
    // comfortably over the byte budget. A `String.length` check would pass it.
    const emoji = "🙂".repeat(MAX_BLOCK_JS_BYTES / 4 + 1);

    expect(emoji.length).toBeLessThan(MAX_BLOCK_JS_BYTES);
    expect(validateInteractiveBlocks(doc(validBlock("multibyte", { js: emoji }))).ok).toBe(false);
  });

  it("rejects malformed attrs and says which block", () => {
    const result = validateInteractiveBlocks(
      doc(blockNode({ id: "ok", html: "<p>fine</p>" }), blockNode({ id: "bad", js: 42 })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.map((problem) => problem.blockId)).toContain("bad");
  });

  it("rejects a block carrying no id at all, pointing at its position", () => {
    const result = validateInteractiveBlocks(doc(validBlock("first"), blockNode({})));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]?.blockId).toBeNull();
      expect(result.problems[0]?.index).toBe(1);
    }
  });

  it("rejects two blocks sharing an id", () => {
    const result = validateInteractiveBlocks(doc(validBlock("same"), validBlock("same")));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/share this id/);
  });

  it("rejects a block that carries child content", () => {
    const result = validateInteractiveBlocks(
      doc({
        type: "interactiveBlock",
        attrs: { id: "leafy" },
        content: [{ type: "text", text: "invisible" }],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/cannot contain other content/);
  });

  it("rejects more blocks than a material may hold", () => {
    const tooMany = Array.from({ length: MAX_BLOCKS_PER_MATERIAL + 1 }, (_, index) =>
      validBlock(`b${index}`),
    );
    const result = validateInteractiveBlocks(doc(...tooMany));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/at most/);
  });

  it("rejects blocks that individually fit but together blow the material budget", () => {
    // Each block is under every per-field limit; five of them are not under the
    // per-material total. Without the second check a Material could carry
    // twenty times the intended payload one legal block at a time.
    const chunk = "x".repeat(MAX_BLOCK_BYTES_PER_MATERIAL / 4);
    const blocks = Array.from({ length: 5 }, (_, index) =>
      validBlock(`big${index}`, { js: chunk }),
    );
    const result = validateInteractiveBlocks(doc(...blocks));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/budget for one material/);
  });
});
