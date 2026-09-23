import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@chakra-ui/react";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { NextItemLink } from "@/components/content/next-item-link";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { getAssessment } from "@/server/services/assessments";
import { nextModuleItem } from "@/server/services/module-progression";
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

  // The sequence runs through Assessments as well as Materials, so the way on
  // is offered here too — otherwise the chain stops at the first exam and the
  // Coder is back to finding their place on the overview.
  const progression = await nextModuleItem(session.user, response.assessment.moduleId, {
    kind: "ASSESSMENT",
    id: assessmentId,
  });

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" alignSelf="start" mb="4">
        <NextLink href={routes.module(moduleSlug)}>
          <ChevronLeft aria-hidden />
          Back to module
        </NextLink>
      </Button>

      <AssessmentScreen assessment={response.assessment} />

      <Box mt="8">
        <NextItemLink progression={progression} />
      </Box>
    </PageContainer>
  );
}
