import { describe, expect, it } from "vitest";
import { BLOCK_CONTEXT_MESSAGE, BLOCK_RESIZE_MESSAGE } from "@ambatucode/shared";
import { INTERACTIVE_BLOCK_SANDBOX, assembleInteractiveBlock } from "./interactive-block";

/**
 * These are security tests wearing correctness clothes. Each one guards a rule
 * that, if it slipped, would let Architect-authored content reach somewhere it
 * must never reach.
 */

const empty = { html: "", css: "", js: "" };

function assemble(block: Partial<typeof empty>, theme: "light" | "dark" = "light") {
  return assembleInteractiveBlock({ ...empty, ...block }, { theme, reducedMotion: false });
}

describe("sandbox flags", () => {
  it("grants scripts and nothing else", () => {
    // The omissions are the whole design. `allow-same-origin` in particular
    // would hand authored JavaScript the reader's session and defeat every
    // other control at once.
    expect(INTERACTIVE_BLOCK_SANDBOX).toBe("allow-scripts");
  });
});

describe("assembleInteractiveBlock", () => {
  it("denies every network source by default", () => {
    const document = assemble({});

    // Without this a block could fetch, open a socket, or pull an image from a
    // CDN — which would both exfiltrate and break the offline-first promise.
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("frame-src 'none'");
    // Images and fonts are data URIs precisely because the network is closed.
    expect(document).toContain("img-src data: blob:");
    expect(document).toContain("font-src data:");
  });

  it("escapes a closing script tag inside authored JavaScript", () => {
    // An Architect writing this string is doing nothing unusual. Left alone,
    // the script element ends at their string and the rest of their program
    // lands in the page as markup.
    const js = 'const tag = "</script><img src=x onerror=alert(1)>";';
    const document = assemble({ js });

    expect(document).not.toContain("</script><img");
    expect(document).toContain('"<\\/script>');
    // Exactly the two script elements the platform opened: the prelude and the
    // authored program. A third would mean the escape failed.
    expect(document.match(/<\/script>/g)).toHaveLength(2);
  });

  it("escapes a closing style tag inside authored CSS", () => {
    const css = 'body::after { content: "</style><script>alert(1)</script>"; }';
    const document = assemble({ css });

    expect(document).not.toContain("</style><script>alert(1)");
    expect(document).toContain("<\\/style>");
  });

  it("is case-insensitive about the closing tags it escapes", () => {
    // The HTML tokenizer does not care about case, so neither may the escape.
    const document = assemble({ js: 'x = "</SCRIPT>";', css: 'y: "</STYLE>";' });

    expect(document).not.toContain("</SCRIPT>");
    expect(document).not.toContain("</STYLE>");
  });

  it("keeps authored content byte for byte when there is nothing to escape", () => {
    // No sanitizing, no stripping, no rewriting. Isolation is what makes the
    // content safe; filtering it would break real authoring and deliver none
    // of the assurance it appears to.
    const html = '<div class="stage" onclick="go()"><b>Step 1</b></div>';
    const js = "document.querySelector('.stage').textContent = 'ready';";
    const document = assemble({ html, js });

    expect(document).toContain(html);
    expect(document).toContain(js);
  });

  it("installs the bridge before the authored program runs", () => {
    // A block that throws on its first line must still have reported a height
    // and be able to report the error.
    const document = assemble({ js: "throw new Error('early');" });
    const preludeAt = document.indexOf(BLOCK_RESIZE_MESSAGE);
    const authoredAt = document.indexOf("throw new Error('early');");

    expect(preludeAt).toBeGreaterThan(-1);
    expect(preludeAt).toBeLessThan(authoredAt);
    expect(document).toContain(BLOCK_CONTEXT_MESSAGE);
  });

  it("hands authored CSS a documented hook for dark mode", () => {
    const dark = assemble({}, "dark");

    expect(dark).toContain('<html data-theme="dark">');
    expect(dark).toContain("color-scheme: dark");
  });

  it("orders the document so the platform reset cannot outrank authored CSS", () => {
    const document = assemble({ css: ".stage { color: red }" });

    // Authored CSS comes second, so an equally specific platform rule loses to
    // it. An Architect should not have to fight the frame for their own styles.
    expect(document.indexOf("box-sizing: border-box")).toBeLessThan(
      document.indexOf(".stage { color: red }"),
    );
  });
});
