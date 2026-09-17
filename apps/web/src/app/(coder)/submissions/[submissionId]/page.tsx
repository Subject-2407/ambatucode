import type { Metadata } from "next";
import { prisma } from "@ambatucode/db";
import type { SubmissionCoderView } from "@ambatucode/shared";
import { requirePageSession } from "@/lib/require-page-session";
import { handlePageError } from "@/lib/page-errors";
import { getSubmission } from "@/server/services/submissions";
import { SubmissionDetail } from "./submission-detail";

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

  return (
    <SubmissionDetail submission={loaded.submission} assessmentTitle={loaded.assessmentTitle} />
  );
}

async function load(
  actor: Parameters<typeof getSubmission>[0],
  submissionId: string,
): Promise<{ submission: SubmissionCoderView; assessmentTitle: string }> {
  try {
    const submission = (await getSubmission(actor, submissionId)) as SubmissionCoderView;
    const row = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { assessment: { select: { title: true } } },
    });
    return { submission, assessmentTitle: row?.assessment.title ?? "Submission" };
  } catch (error) {
    handlePageError(error);
  }
}
