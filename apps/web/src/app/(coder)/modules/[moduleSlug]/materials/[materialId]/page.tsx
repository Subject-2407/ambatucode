import type { Metadata } from "next";
import NextLink from "next/link";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { PracticeActivity } from "@/components/content/practice-activity";
import { isEmptyDocument } from "@/components/content/rich-text";
import { RichTextView } from "@/components/content/rich-text-view";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { getMaterial } from "@/server/services/materials";

export const metadata: Metadata = { title: "Material" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleSlug: string; materialId: string }> };

/**
 * A Material, with its Practice Activities in place.
 *
 * The activities sit inline rather than on a page of their own: the SRS asks
 * for explanation, example, practice, next material as one progression, and
 * sending a Coder elsewhere to try what they just read breaks it.
 */
export default async function MaterialPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { moduleSlug, materialId } = await params;

  const material = await getMaterial(session.user, materialId).catch((error: unknown) =>
    // Not enrolled is not a dead end — it is a redirect to the page that says
    // so and offers the way in.
    handlePageError(error, routes.module(moduleSlug)),
  );

  return (
    <PageContainer>
      <Stack gap="2" mb="2">
        <Button asChild variant="ghost" size="sm" alignSelf="start">
          <NextLink href={routes.module(moduleSlug)}>
            <ChevronLeft aria-hidden />
            Back to module
          </NextLink>
        </Button>
      </Stack>

      <PageHeader title={material.title} />

      <Stack gap="8">
        {isEmptyDocument(material.content) ? (
          <Text color="fg.muted">This material has no content yet.</Text>
        ) : (
          <RichTextView document={material.content} />
        )}

        {material.practiceActivities.length > 0 ? (
          <Stack gap="4">
            <HStack gap="2">
              <Text fontWeight="semibold">Practice</Text>
              <Text fontSize="sm" color="fg.muted">
                Try it out — nothing here is graded.
              </Text>
            </HStack>
            {material.practiceActivities.map((activity) => (
              <PracticeActivity key={activity.id} activity={activity} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </PageContainer>
  );
}
