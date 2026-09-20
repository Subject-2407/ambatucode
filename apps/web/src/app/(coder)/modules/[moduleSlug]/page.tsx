import type { ReactNode } from "react";
import type { Metadata } from "next";
import NextLink from "next/link";
import { Box, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight, ClipboardCheck, FileText, Lock, Terminal } from "lucide-react";
import type { AssessmentSummary, ModuleDetail, ModuleSectionView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { ModuleLeaderboards } from "@/components/gamification/module-leaderboards";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { pixelSkin } from "@/theme/pixel";
import { handlePageError } from "@/lib/page-errors";
import { requirePageSession } from "@/lib/require-page-session";
import { routes } from "@/lib/routes";
import { getModule } from "@/server/services/modules";
import { EnrollButton } from "../enroll-button";

export const metadata: Metadata = { title: "Module" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ moduleSlug: string }> };

/**
 * The Module a Coder opens.
 *
 * Fetched in the Server Component rather than through the API client: this is
 * the first paint of the page, and a loopback HTTP request to our own route
 * handler would only add a round trip and a cookie to forward.
 */
export default async function ModuleOverviewPage({ params }: PageProps) {
  const session = await requirePageSession("CODER");
  const { moduleSlug } = await params;

  const module = await getModule(session.user, { slug: moduleSlug }).catch((error: unknown) =>
    handlePageError(error),
  );

  return (
    // The overview and the board it ranks are read together, so the page is
    // locked to the window and each column scrolls on its own. Scrolling the
    // whole page to reach the leaderboard meant losing sight of the sections.
    <PageContainer backdrop="constellation" fill={module.viewer.canRead}>
      <PageHeader
        title={module.title}
        description={module.description ?? undefined}
        action={
          module.visibility === "CLOSED" ? (
            <Badge tone="warning">
              <Lock size={12} aria-hidden /> Closed
            </Badge>
          ) : (
            <Badge>Public</Badge>
          )
        }
      />

      {module.viewer.canRead ? (
        <Grid
          templateColumns={{ base: "1fr", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" }}
          gap={{ base: "8", lg: "6" }}
          flex={{ md: "1" }}
          minHeight={{ md: "0" }}
        >
          {/* `minHeight: 0` on both: a grid item's default minimum is its
              content, so without it neither column can be shorter than what is
              inside it and the page scrolls after all. */}
          <Column>
            <SectionTree module={module} />
          </Column>

          {/* Gamification belongs to learning, so it lives on the module page
              and never inside the attempt workspace. */}
          <Column>
            <Stack gap="3">
              <Text fontSize="sm" textStyle="display">
                Leaderboard
              </Text>
              <ModuleLeaderboards
                moduleId={module.id}
                viewerId={session.user.id}
                sections={module.sections.map((section) => ({
                  id: section.id,
                  title: section.title,
                }))}
              />
            </Stack>
          </Column>
        </Grid>
      ) : (
        <AccessPanel module={module} />
      )}
    </PageContainer>
  );
}

/** One scrolling half of the overview. See the grid above for why. */
function Column({ children }: { children: ReactNode }) {
  return (
    <Box
      minHeight={{ md: "0" }}
      overflowY={{ base: "visible", md: "auto" }}
      // Room for the scrollbar so a row's text does not sit under it.
      pe={{ md: "2" }}
    >
      {children}
    </Box>
  );
}

/**
 * What a Coder sees before they belong to the module. The tree is absent
 * because the server did not send it, not because it was filtered here.
 */
function AccessPanel({ module }: { module: ModuleDetail }) {
  const pending = module.viewer.enrollmentStatus === "PENDING";

  return (
    <EmptyState
      sprite="lock"
      title={pending ? "Waiting for approval" : "Enroll to read this module"}
      description={
        pending
          ? "The Architect has your request. The materials open as soon as it is approved."
          : module.visibility === "CLOSED"
            ? "This is a Closed module, so the Architect approves each request."
            : "Enrolling is immediate on a Public module."
      }
      action={<EnrollButton module={module} />}
    />
  );
}

function SectionTree({ module }: { module: ModuleDetail }) {
  if (module.sections.length === 0) {
    return (
      <EmptyState
        sprite="doc"
        title="Nothing published yet"
        description="The Architect has not added any sections to this module."
      />
    );
  }

  return (
    <Stack gap="6">
      {module.sections.map((section, index) => (
        <SectionBlock key={section.id} section={section} index={index} moduleSlug={module.slug} />
      ))}
    </Stack>
  );
}

function SectionBlock({
  section,
  index,
  moduleSlug,
}: {
  section: ModuleSectionView;
  index: number;
  moduleSlug: string;
}) {
  return (
    <Stack gap="3">
      <HStack gap="3" align="baseline">
        {/* The number is real information here — a Section is an ordered step
            through the Module, not a card in an unordered grid. */}
        <Text textStyle="display" fontSize="xs" color="accent.fg">
          {String(index + 1).padStart(2, "0")}
        </Text>
        <Text textStyle="display" fontSize="md">
          {section.title}
        </Text>
      </HStack>

      {section.materials.length === 0 && section.assessments.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" ps="8">
          Nothing in this section yet.
        </Text>
      ) : (
        <Stack gap="2">
          {section.materials.map((material) => (
            <ItemLink key={material.id} href={routes.material(moduleSlug, material.id)}>
              <HStack gap="3" minWidth="0">
                <FileText size={16} aria-hidden />
                <Text truncate>{material.title}</Text>
                {material.practiceCount > 0 ? (
                  <Badge tone="accent">
                    <Terminal size={12} aria-hidden /> {material.practiceCount}
                  </Badge>
                ) : null}
              </HStack>
            </ItemLink>
          ))}

          {section.assessments.map((assessment) => (
            <ItemLink
              key={assessment.id}
              href={routes.assessment(moduleSlug, assessment.id)}
              tone="assessment"
            >
              <HStack gap="3" minWidth="0">
                <ClipboardCheck size={16} aria-hidden />
                <Text truncate>{assessment.title}</Text>
                <AssessmentTimingBadge assessment={assessment} />
              </HStack>
            </ItemLink>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Materials and Assessments sit in one list because that is the order the
 * Architect arranged them in, and a Coder works through a Section top to
 * bottom. The icon and the timing badge are what tell them apart — reading
 * an explanation and sitting an exam should never look identical.
 */
function ItemLink({
  href,
  tone = "material",
  children,
}: {
  href: string;
  /**
   * Materials are quiet rows; an Assessment is the gate at the end of the
   * Section and carries the heavy crimson frame. Crimson means consequence
   * throughout the product, and this is the one link on the page that spends a
   * formal attempt.
   */
  tone?: "material" | "assessment";
  children: ReactNode;
}) {
  if (tone === "assessment") {
    return (
      <PixelFrame tone="danger" _hover={{ bg: "danger.fg" }}>
        <Box asChild px="4" py="3">
          <NextLink href={href}>
            <Flex align="center" justify="space-between" gap="3">
              {children}
              <ChevronRight size={16} aria-hidden />
            </Flex>
          </NextLink>
        </Box>
      </PixelFrame>
    );
  }

  return (
    <Box
      asChild
      {...pixelSkin("var(--amb-colors-border-default)", "var(--amb-colors-bg-surface)", 2)}
      px="4"
      py="3"
      _hover={{
        background: "var(--amb-colors-accent-solid)",
        _before: { background: "var(--amb-colors-bg-subtle)" },
      }}
    >
      <NextLink href={href}>
        <Flex align="center" justify="space-between" gap="3">
          {children}
          <ChevronRight size={16} aria-hidden />
        </Flex>
      </NextLink>
    </Box>
  );
}

function AssessmentTimingBadge({ assessment }: { assessment: AssessmentSummary }) {
  if (assessment.timeMode === "UNTIMED") return <Badge tone="neutral">Untimed</Badge>;
  return (
    <Badge tone="warning">
      {assessment.durationMinutes} min ·{" "}
      {assessment.executionMode === "LIVE" ? "Live" : "Individual"}
    </Badge>
  );
}
