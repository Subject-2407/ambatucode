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
          // Close to even. At 1.6:1 the board was a column of truncated names
          // beside a column of half-empty rows — a leaderboard that cannot show
          // a name and a score on one line is not ranking anything legibly.
          templateColumns={{ base: "1fr", lg: "minmax(0, 1.1fr) minmax(0, 1fr)" }}
          // And a gutter wide enough to read as two panels rather than as one
          // list that happens to have a table stuck to its right edge.
          gap={{ base: "8", lg: "10" }}
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
            <MaterialLink key={material.id} href={routes.material(moduleSlug, material.id)}>
              <HStack gap="3" minWidth="0">
                <FileText size={16} aria-hidden />
                <Text truncate>{material.title}</Text>
                {material.practiceCount > 0 ? (
                  <Badge tone="accent">
                    <Terminal size={12} aria-hidden /> {material.practiceCount}
                  </Badge>
                ) : null}
              </HStack>
            </MaterialLink>
          ))}

          {/* Set apart from the rows above rather than continuing them. An
              Assessment is the gate at the end of the Section, and it was
              reading as the next line in a list of things to click. */}
          {section.assessments.map((assessment, index) => (
            <Box key={assessment.id} mt={index === 0 ? "2" : "0"}>
              <AssessmentCard
                href={routes.assessment(moduleSlug, assessment.id)}
                assessment={assessment}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A Material: a quiet row. It is one of many in a Section and a Coder reads
 * down them, so anything louder would turn a reading list into a wall.
 */
function MaterialLink({ href, children }: { href: string; children: ReactNode }) {
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

/**
 * An Assessment: a card, not a row.
 *
 * It used to be the same row with a coloured edge, which made the difference a
 * colour — and a colour is exactly what a Coder scanning a Section at speed
 * does not stop for. Four things separate it now: a tinted surface rather than
 * the page's own, the full-weight frame instead of the rows' 2px one, more
 * padding on every side, and a kicker naming what it is.
 *
 * Lagoon rather than crimson. Crimson is the product's alarm colour — it is
 * what Leave, a failed case and a destructive dialog wear — and spending it on
 * every Assessment in a Section made the ordinary next step in a Module read
 * as a warning.
 *
 * The timing badge moves to the right, beside the chevron. Next to the title it
 * pushed a long name into truncation on the one link in the Section where the
 * name matters most.
 */
function AssessmentCard({ href, assessment }: { href: string; assessment: AssessmentSummary }) {
  return (
    <PixelFrame
      tone="info"
      surface="bg.info"
      _hover={{ bg: "info.solid", _dark: { bg: "info.solid" } }}
    >
      {/* Wider than it is tall: the notch bites a square out of each corner,
          and at px="4" the icon on the left and the chevron on the right sat
          inside the bite. */}
      <Box asChild px="6" py="4">
        <NextLink href={href}>
          <Flex align="center" justify="space-between" gap="4">
            <HStack gap="3" minWidth="0">
              <ClipboardCheck size={18} aria-hidden />
              <Stack gap="0.5" minWidth="0">
                <Text textStyle="display" fontSize="3xs" color="fg.info">
                  Assessment
                </Text>
                <Text truncate fontWeight="medium">
                  {assessment.title}
                </Text>
              </Stack>
            </HStack>

            <HStack gap="3" flexShrink="0">
              <AssessmentTimingBadge assessment={assessment} />
              <ChevronRight size={16} aria-hidden />
            </HStack>
          </Flex>
        </NextLink>
      </Box>
    </PixelFrame>
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
