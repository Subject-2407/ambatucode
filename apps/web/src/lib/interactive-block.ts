import type { InteractiveBlockAttrs } from "@ambatucode/shared";
import {
  BLOCK_CONTEXT_MESSAGE,
  BLOCK_ERROR_MESSAGE,
  BLOCK_RESIZE_MESSAGE,
} from "@ambatucode/shared";

/**
 * Assembles an Interactive Block's three authored fields into the single
 * document that runs inside its frame.
 *
 * Everything here follows from one rule: the content is authored by a trusted
 * role but is not trusted code. A compromised or careless Architect account
 * must not be able to act on behalf of every Coder who opens the Material.
 *
 * The document is built in the browser and handed to an iframe's `srcDoc` and
 * nowhere else. It is never built on the server, never interpolated into the
 * app's own markup, and never rendered through `dangerouslySetInnerHTML` —
 * this is precisely the feature that would tempt someone into it.
 */

/**
 * The sandbox flags, in one place so the reader and the authoring preview
 * cannot drift apart.
 *
 * The omissions are the feature. Without `allow-same-origin` the frame gets a
 * unique opaque origin and is walled off from the application entirely; adding
 * it — even "just for the preview" — would hand authored JavaScript the
 * reader's session, and there is no version of that which is fine. `allow-forms`
 * would permit a credential form that looks like it belongs to the platform,
 * `allow-modals` dialogs indistinguishable from platform dialogs, `allow-popups`
 * windows outside the frame's containment, `allow-top-navigation` navigating a
 * Coder away mid-Material, and `allow-downloads` pushing files at the reader.
 */
export const INTERACTIVE_BLOCK_SANDBOX = "allow-scripts";

/**
 * The policy that makes offline-first true and exfiltration impossible.
 *
 * `default-src 'none'` is the load-bearing part: no fetch, no XMLHttpRequest,
 * no WebSocket, no remote image, no CDN, no font from a foundry. Imagery and
 * fonts must therefore be data URIs, which is also exactly what lets the
 * platform run on a lab network with no route to the internet.
 *
 * `'unsafe-inline'` for script and style is deliberate and safe here: inline
 * script is the entire point of the feature, and the origin it runs in owns
 * nothing — no cookies, no storage, no reachable DOM but its own.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * Ends the `<style>` element early if left alone.
 *
 * The HTML tokenizer treats a style element's contents as raw text and stops at
 * the first `</style`, dropping everything after it into the document as
 * markup. A backslash breaks the match without changing what the CSS means:
 * inside a string `\/` is still `/`, and outside one `</style` was never valid
 * CSS to begin with.
 */
function escapeStyleClose(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/**
 * The same trap for `<script>`, and the one far likelier to be hit.
 *
 * An Architect writing `const tag = "</script>"` in a string is doing nothing
 * unusual, and without this the element closes there and the remainder of their
 * program lands in the page as text. `<\/script` is the standard escape: in
 * JavaScript `\/` is just `/`, so the string keeps its value.
 */
function escapeScriptClose(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

/**
 * A small reset, kept small on purpose — authored CSS should not have to fight
 * the platform for control of its own frame.
 *
 * The transparent background lets the block sit on the Material's surface, and
 * `color-scheme` plus the `data-theme` attribute give authored CSS a documented
 * hook for dark mode: `[data-theme="dark"] { ... }`.
 */
function platformReset(theme: "light" | "dark"): string {
  return `
    :root { color-scheme: ${theme}; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.55;
      color: ${theme === "dark" ? "#e6e6e6" : "#1a1a1a"};
    }
    * { box-sizing: border-box; }
    img, svg, canvas, video { max-width: 100%; }
  `;
}

/**
 * The frame's half of the bridge. Architects never write this, and never have
 * to know it exists.
 *
 * It is injected before the authored JavaScript so a block that throws on its
 * first line still reports its height and its error. Everything it posts goes
 * out with `targetOrigin: "*"` because an opaque origin cannot be named as a
 * target — which is the same reason the inbound payload is limited to theme
 * and reduced motion.
 */
function preludeScript(theme: "light" | "dark", reducedMotion: boolean): string {
  return `
(function () {
  var RESIZE = ${JSON.stringify(BLOCK_RESIZE_MESSAGE)};
  var CONTEXT = ${JSON.stringify(BLOCK_CONTEXT_MESSAGE)};
  var ERROR = ${JSON.stringify(BLOCK_ERROR_MESSAGE)};

  function publish(context) {
    window.AmbatucodeBlock = Object.freeze({
      theme: context.theme,
      reducedMotion: context.reducedMotion,
    });
  }
  publish({ theme: ${JSON.stringify(theme)}, reducedMotion: ${JSON.stringify(reducedMotion)} });

  function send(message) {
    try {
      parent.postMessage(message, "*");
    } catch (error) {
      /* A frame with no parent is the authoring preview mid-teardown. */
    }
  }

  var lastHeight = -1;
  var pending = false;
  function measure() {
    pending = false;
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (height === lastHeight) return;
    lastHeight = height;
    send({ type: RESIZE, height: height });
  }
  function scheduleMeasure() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(measure);
  }

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(scheduleMeasure).observe(document.documentElement);
  }
  window.addEventListener("load", scheduleMeasure);
  scheduleMeasure();

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== CONTEXT) return;
    if (data.theme !== "light" && data.theme !== "dark") return;
    document.documentElement.setAttribute("data-theme", data.theme);
    document.documentElement.style.colorScheme = data.theme;
    publish({ theme: data.theme, reducedMotion: data.reducedMotion === true });
    scheduleMeasure();
  });

  // A block has no console of its own. Without this an Architect debugging one
  // is entirely blind, so failures are forwarded to the authoring dialog.
  window.addEventListener("error", function (event) {
    send({ type: ERROR, message: String(event.message || "Script error").slice(0, 2000) });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    var text = reason && reason.message ? reason.message : String(reason);
    send({ type: ERROR, message: ("Unhandled rejection: " + text).slice(0, 2000) });
  });
})();
  `.trim();
}

export type AssembleOptions = {
  theme: "light" | "dark";
  reducedMotion: boolean;
};

/**
 * Builds the document in the documented order: head metadata and policy first,
 * then the platform reset, then authored CSS, then authored HTML, then the
 * prelude, and the authored program last.
 *
 * The prelude runs before the authored JavaScript so the height bridge and the
 * error reporting are already installed when the block's own code starts —
 * including when that code throws immediately.
 */
export function assembleInteractiveBlock(
  block: Pick<InteractiveBlockAttrs, "html" | "css" | "js">,
  options: AssembleOptions,
): string {
  const { theme, reducedMotion } = options;

  return [
    "<!doctype html>",
    `<html data-theme="${theme}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
    `<style>${platformReset(theme)}</style>`,
    `<style>${escapeStyleClose(block.css)}</style>`,
    "</head>",
    "<body>",
    block.html,
    `<script>${preludeScript(theme, reducedMotion)}</script>`,
    `<script>${escapeScriptClose(block.js)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
