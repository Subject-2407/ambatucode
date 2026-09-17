import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { getAssessment } from "@/server/services/assessments";
import { AssessmentScreen } from "./assessment-screen";

export const metadata: Metadata = { title: "Assessment" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleSlug: string; assessmentId: string }> };

/**
 * The Assessment detail and Start screen.
 *
 * `getAssessment` answers with one of two shapes and says which. A Coder can
 * only ever receive the Coder view, and the guard below is a type narrowing
 * rather than a security check — the service decided that already, based on
 * who owns the Module.
 */
export default async function AssessmentPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { moduleSlug, assessmentId } = await params;

  const response = await getAssessment(session.user, assessmentId).catch((error: unknown) =>
    handlePageError(error, routes.module(moduleSlug)),
  );
  if (response.view !== "CODER") notFound();

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="4">
        <NextLink href={routes.module(moduleSlug)}>
          <ChevronLeft aria-hidden />
          Back to module
        </NextLink>
      </Button>

      <AssessmentScreen assessment={response.assessment} />
    </PageContainer>
  );
}
