import "server-only";
import { notFound, redirect } from "next/navigation";
import { isAppError } from "@ambatucode/shared";

/**
 * Translates a service refusal into the page-level equivalent.
 *
 * The services answer in API terms because that is what a route handler needs;
 * a Server Component has to turn the same refusal into a rendered outcome. Two
 * codes matter here and they mean different things: NOT_FOUND is the answer a
 * Coder gets for content that is not theirs to know about, and FORBIDDEN means
 * the content exists and the next step is to enroll — so it sends them to the
 * page where they can.
 *
 * Anything else is rethrown. An unexpected failure belongs in the error
 * boundary, not quietly rendered as an empty page.
 */
export function handlePageError(error: unknown, forbiddenRedirect?: string): never {
  if (isAppError(error)) {
    if (error.code === "NOT_FOUND") notFound();
    if (error.code === "FORBIDDEN" && forbiddenRedirect) redirect(forbiddenRedirect);
  }
  throw error;
}
