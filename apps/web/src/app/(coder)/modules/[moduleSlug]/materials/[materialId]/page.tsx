import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Stack, Text } from "@chakra-ui/react";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { BackLink } from "@/components/layout/back-link";
import { MaterialLayout } from "@/components/content/material-layout";
import { ModuleContents } from "@/components/content/module-contents";
import { NextItemLink } from "@/components/content/next-item-link";
import { PracticeActivity } from "@/components/content/practice-activity";
import { isEmptyDocument } from "@/components/content/rich-text";
import { RichTextView } from "@/components/content/rich-text-view";
import { CONTENTS_PANEL_COOKIE, parseContentsPanel } from "@/lib/contents-panel";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { sectionLabel } from "@/lib/section-label";
import { getMaterial } from "@/server/services/materials";
import { getModule } from "@/server/services/modules";
import { nextModuleItem } from "@/server/services/module-progression";
import { scopeForMaterial } from "@/server/services/content-scope";

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

  // Resolved here rather than in `getMaterial`: what comes after a Material is
  // a property of the Module, not of the Material, and every other caller of
  // that service would be paying for a walk of the whole tree it never reads.
  const scope = await scopeForMaterial(materialId);
  // By id rather than the slug in the URL: the sidebar must list the Module
  // this Material is actually in, whatever the address says.
  const [progression, module] = await Promise.all([
    nextModuleItem(session.user, scope.moduleId, { kind: "MATERIAL", id: materialId }),
    getModule(session.user, { id: scope.moduleId }),
  ]);
  const contentsShown = parseContentsPanel((await cookies()).get(CONTENTS_PANEL_COOKIE)?.value);

  return (
    <PageContainer width="wide">
      <MaterialLayout
        initialShown={contentsShown}
        contents={<ModuleContents module={module} current={{ kind: "MATERIAL", id: materialId }} />}
        back={<BackLink href={routes.module(moduleSlug)} label="Back to module" />}
      >
        <PageHeader
          kicker={progression.current ? sectionLabel(progression.current) : undefined}
          title={material.title}
        />

        <Stack gap="8">
          {isEmptyDocument(material.content) ? (
            <Text color="fg.muted">This material has no content yet.</Text>
          ) : (
            <RichTextView document={material.content} />
          )}

          {material.practiceActivities.length > 0 ? (
            <Stack gap="4">
              <Text textStyle="display" fontSize="sm" color="accent.fg">
                Practice
              </Text>
              {material.practiceActivities.map((activity) => (
                <PracticeActivity key={activity.id} activity={activity} />
              ))}
            </Stack>
          ) : null}

          {/* The SRS asks for explanation, example, practice, next material as
              one progression. This is the last of those four. */}
          <NextItemLink progression={progression} />
        </Stack>
      </MaterialLayout>
    </PageContainer>
  );
}
