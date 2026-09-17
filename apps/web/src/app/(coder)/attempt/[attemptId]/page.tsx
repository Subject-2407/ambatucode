import type { Metadata } from "next";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { getAttempt } from "@/server/services/attempts";
import { getModule } from "@/server/services/modules";
import { AttemptWorkspace } from "./attempt-workspace";

export const metadata: Metadata = { title: "Assessment" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ attemptId: string }> };

/**
 * The attempt workspace.
 *
 * The attempt is loaded here rather than in the browser so the editor opens
 * with the Coder's draft already in it — on a reconnect after a dropped
 * connection, a blank editor for even a moment is alarming in a way no spinner
 * fixes. The module is read alongside it only for its slug, which is what the
 * Coder-facing links back out of the workspace are addressed by.
 */
export default async function AttemptPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { attemptId } = await params;

  const attempt = await getAttempt(session.user, attemptId).catch((error: unknown) =>
    handlePageError(error),
  );
  const module = await getModule(session.user, { id: attempt.assessment.moduleId }).catch(
    (error: unknown) => handlePageError(error),
  );

  return <AttemptWorkspace attempt={attempt} moduleSlug={module.slug} />;
}
