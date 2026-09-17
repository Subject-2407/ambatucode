import { z } from "zod";
import { MAX_BLOCK_HEIGHT, MIN_BLOCK_HEIGHT } from "./schemas/content";

/**
 * The entire message contract between an Interactive Block's frame and the
 * page hosting it. Two messages, and it does not grow without a deliberate
 * decision: every addition is a new surface between untrusted content and the
 * application.
 *
 * The parent-to-frame direction has a hard constraint that shapes what may
 * ever travel on it. The frame has an opaque origin, so it cannot be named as
 * a `targetOrigin` — anything posted into a block must go out with `"*"`, which
 * means any frame that can get a reference to that window can read it. Treat
 * anything sent into a block as published. That is why the payload is theme
 * and reduced-motion preference and nothing else: never the Coder's name, id,
 * module, progress, or any token.
 *
 * The frame-to-parent direction is attacker-controlled by definition, so it is
 * parsed with Zod before a single field is used, and the sender is identified
 * by comparing `event.source` against the frame's `contentWindow` — never by
 * origin. Every sandboxed frame on a page reports `event.origin === "null"`,
 * including a hostile one, so origin cannot distinguish them.
 */

export const BLOCK_RESIZE_MESSAGE = "ambatucode:block:resize";
export const BLOCK_CONTEXT_MESSAGE = "ambatucode:block:context";
export const BLOCK_ERROR_MESSAGE = "ambatucode:block:error";

/** Frame → parent. The height is clamped by the host regardless of what arrives. */
export const blockResizeMessageSchema = z.object({
  type: z.literal(BLOCK_RESIZE_MESSAGE),
  height: z.number().finite().min(0).max(1_000_000),
});
export type BlockResizeMessage = z.infer<typeof blockResizeMessageSchema>;

/**
 * Frame → parent. A block has no console of its own, so an Architect debugging
 * one is otherwise blind; the authoring dialog surfaces these. The reader
 * ignores them — a block that throws is the Architect's problem to fix, not a
 * notice to put in front of a Coder mid-lesson.
 */
export const blockErrorMessageSchema = z.object({
  type: z.literal(BLOCK_ERROR_MESSAGE),
  message: z.string().max(2_000),
});
export type BlockErrorMessage = z.infer<typeof blockErrorMessageSchema>;

export const blockOutboundMessageSchema = z.discriminatedUnion("type", [
  blockResizeMessageSchema,
  blockErrorMessageSchema,
]);
export type BlockOutboundMessage = z.infer<typeof blockOutboundMessageSchema>;

/** Parent → frame. Everything here is effectively public; see the note above. */
export const blockContextMessageSchema = z.object({
  type: z.literal(BLOCK_CONTEXT_MESSAGE),
  theme: z.enum(["light", "dark"]),
  reducedMotion: z.boolean(),
});
export type BlockContextMessage = z.infer<typeof blockContextMessageSchema>;

/** Keeps a frame from pushing the page to an absurd size, whatever it reports. */
export function clampBlockHeight(height: number): number {
  if (!Number.isFinite(height)) return MIN_BLOCK_HEIGHT;
  return Math.min(MAX_BLOCK_HEIGHT, Math.max(MIN_BLOCK_HEIGHT, Math.round(height)));
}
