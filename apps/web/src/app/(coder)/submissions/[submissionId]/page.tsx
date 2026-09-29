import type { Metadata } from "next";
import { prisma } from "@ambatucode/db";
import type { SubmissionCoderView } from "@ambatucode/shared";
import { requirePageSession } from "@/lib/require-page-session";
import { handlePageError } from "@/lib/page-errors";
import { getSubmission } from "@/server/services/submissions";
import { SubmissionDetail, type SubmissionContext } from "./submission-detail";

export const metadata: Metadata = { title: "Submission" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ submissionId: string }> };

/**
 * A Coder reading one of their own submissions.
 *
 * The service decides who may read it — a Coder sees their own, and anyone
 * else gets NOT_FOUND rather than a refusal that would confirm the submission
 * exists. This page only has to turn that into a 404.
 */
export default async function SubmissionPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { submissionId } = await params;

  // Loaded before any JSX exists: a refusal thrown while React is constructing
  // an element would escape the catch and reach the error boundary instead of
  // becoming the 404 it should be.
  const loaded = await load(session.user, submissionId);

  return <SubmissionDetail submission={loaded.submission} context={loaded.context} />;
}

async function load(
  actor: Parameters<typeof getSubmission>[0],
  submissionId: string,
): Promise<{ submission: SubmissionCoderView; context: SubmissionContext }> {
  try {
    // The service is the authorization. The read below only runs once it has
    // said this submission is the Coder's own, and it fetches labels for the
    // page — where it came from — none of which is grading data.
    const submission = (await getSubmission(actor, submissionId)) as SubmissionCoderView;
    const row = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        assessment: {
          select: {
            id: true,
            title: true,
            section: { select: { module: { select: { slug: true, title: true } } } },
          },
        },
        session: { select: { name: true } },
        attempt: { select: { attemptNumber: true, isOfficial: true } },
      },
    });
    return {
      submission,
      context: {
        assessmentId: row?.assessment.id ?? null,
        assessmentTitle: row?.assessment.title ?? "Submission",
        moduleSlug: row?.assessment.section.module.slug ?? null,
        moduleTitle: row?.assessment.section.module.title ?? null,
        sessionName: row?.session.name ?? null,
        attemptNumber: row?.attempt.attemptNumber ?? null,
        isOfficial: row?.attempt.isOfficial ?? false,
      },
    };
  } catch (error) {
    handlePageError(error);
  }
}
