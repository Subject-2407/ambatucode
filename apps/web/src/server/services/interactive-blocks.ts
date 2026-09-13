import "server-only";
import {
  AppError,
  describeInteractiveBlockProblems,
  documentHasInteractiveBlock,
  findInteractiveBlockNodes,
  validateInteractiveBlocks,
  type RichTextDocument,
} from "@ambatucode/shared";

/**
 * The two gates an Interactive Block has to pass on the server.
 *
 * The block itself is never inspected for what it *does* — no sanitizing, no
 * stripping, no rewriting. Safety comes from where it runs, which is an
 * opaque-origin sandboxed frame with no network and no platform data. What is
 * checked here is size, shape, and where a block is allowed to exist at all.
 */

/**
 * Applied on the Architect's save and again on the way out to a reader.
 *
 * Both directions, because a column written by an older editor build is
 * exactly as untrusted as a request body — and unlike every other column, this
 * one is concatenated into a document that executes in a Coder's browser. A
 * read that quietly rendered a drifted block would turn a schema change into a
 * silent behaviour change in the one place that can least afford it.
 */
export function assertInteractiveBlocksValid(
  document: RichTextDocument,
  options: { origin: "request" | "stored" },
): void {
  const result = validateInteractiveBlocks(document);
  if (result.ok) return;

  const detail = describeInteractiveBlockProblems(result.problems);

  if (options.origin === "stored") {
    // A stored document that no longer validates is a defect in this system,
    // not something the caller did. It surfaces as INTERNAL with the reason
    // logged, and never as a half-rendered Material that hides the drift.
    throw new AppError("INTERNAL", `Stored Material.contentJson has invalid blocks: ${detail}`);
  }

  throw new AppError("VALIDATION_FAILED", `Interactive block rejected — ${detail}`, {
    blocks: result.problems,
  });
}

/**
 * Refuses a document that carries an Interactive Block at all.
 *
 * Blocks belong to Materials and nowhere else. Assessment problem statements
 * and Practice Activity prompts are read inside the timed workspace, where
 * anti-cheat and timing controls are active and there is no frame host; an
 * Architect-authored program in that context is an uncontrolled surface with
 * no instructional benefit a Material cannot already provide.
 *
 * Both of those fields are plain strings today, so this cannot fire — which is
 * the point. It exists so that the day either one becomes a rich text document,
 * the rule is already written down and already enforced rather than
 * rediscovered.
 */
export function assertNoInteractiveBlocks(document: RichTextDocument, surface: string): void {
  if (!documentHasInteractiveBlock(document)) return;

  const count = findInteractiveBlockNodes(document).length;
  throw new AppError(
    "VALIDATION_FAILED",
    `Interactive blocks belong to Materials. ${surface} cannot contain ${count === 1 ? "one" : count}.`,
  );
}
