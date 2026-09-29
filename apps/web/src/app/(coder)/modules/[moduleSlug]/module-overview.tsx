"use client";

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import NextLink from "next/link";
import { Box, Flex, HStack, Stack, Text, chakra } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, ClipboardCheck, FileText, Terminal } from "lucide-react";
import type { AssessmentSummary, ModuleDetail, ModuleSectionView } from "@ambatucode/shared";
import { PageContainer, PageHeader } from "@/components/layout/app-shell";
import { TimingBadge } from "@/components/assessment/timing-badge";
import { ModuleLeaderboardDrawer } from "@/components/gamification/module-leaderboards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { routes } from "@/lib/routes";
import {
  parseSectionFolds,
  sectionFoldsSnapshot,
  setSectionFolds,
  subscribeSectionFolds,
} from "@/lib/section-folds";
import { sectionNumberLabel } from "@/lib/section-label";
import { PIXEL, pixelSkin } from "@/theme/pixel";

/**
 * A Module's contents: its Sections in order, one centred column, each one
 * foldable.
 *
 * One layout. A grid of Section cards and a list beside an "about" panel were
 * both tried; each made the order through the Module harder to follow, and a
 * Module is read in order. Folding is what a long Module needs instead: a
 * Coder can shut the Sections they are done with and keep the page to the
 * part they are working through.
 */

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "3 materials · 1 assessment", or "Empty" when there is neither. */
function sectionCounts(section: ModuleSectionView): string {
  const parts: string[] = [];
  if (section.materials.length > 0) {
    parts.push(plural(section.materials.length, "material", "materials"));
  }
  if (section.assessments.length > 0) {
    parts.push(plural(section.assessments.length, "assessment", "assessments"));
  }
  return parts.length === 0 ? "Empty" : parts.join(" · ");
}

function moduleSummary(module: ModuleDetail): string {
  let materials = 0;
  let assessments = 0;
  for (const section of module.sections) {
    materials += section.materials.length;
    assessments += section.assessments.length;
  }
  return [
    plural(module.sections.length, "section", "sections"),
    plural(materials, "material", "materials"),
    plural(assessments, "assessment", "assessments"),
  ].join(" · ");
}

/**
 * The folded Sections for this Module. Read through a store rather than an
 * effect: the server renders every Section open, and the browser's answer
 * arrives with the first client render instead of a frame after it.
 */
function useSectionFolds(moduleId: string) {
  const raw = useSyncExternalStore(
    subscribeSectionFolds,
    () => sectionFoldsSnapshot(moduleId),
    () => null,
  );
  const folded = useMemo(() => parseSectionFolds(raw), [raw]);
  const setFolded = useCallback(
    (next: ReadonlySet<string>) => setSectionFolds(moduleId, next),
    [moduleId],
  );
  return [folded, setFolded] as const;
}

export function ModuleOverview({ module, viewerId }: { module: ModuleDetail; viewerId: string }) {
  const [folded, setFolded] = useSectionFolds(module.id);

  const toggle = useCallback(
    (sectionId: string) => {
      const next = new Set(folded);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      setFolded(next);
    },
    [folded, setFolded],
  );

  const allFolded =
    module.sections.length > 0 && module.sections.every((section) => folded.has(section.id));
  const toggleAll = useCallback(() => {
    setFolded(allFolded ? new Set() : new Set(module.sections.map((section) => section.id)));
  }, [allFolded, module.sections, setFolded]);

  return (
    <PageContainer width="reading" backdrop="constellation">
      {/* No Public or Closed badge. Once a Coder is inside, how they got in no
          longer matters. */}
      <PageHeader
        title={module.title}
        description={module.description ?? undefined}
        action={
          // Gamification belongs to learning, so it lives on the module page
          // and never inside the attempt workspace.
          <ModuleLeaderboardDrawer
            moduleId={module.id}
            viewerId={viewerId}
            sections={module.sections.map((section) => ({ id: section.id, title: section.title }))}
          />
        }
      />

      {module.sections.length === 0 ? (
        <EmptyState
          sprite="doc"
          title="Nothing published yet"
          description="The Architect has not added any sections to this module."
        />
      ) : (
        <Stack gap="5">
          <Flex align="center" justify="space-between" gap="3" wrap="wrap">
            <Text fontSize="sm" color="fg.muted">
              {moduleSummary(module)}
            </Text>
            {/* Words only: at this size the two-chevron icon read as a close cross. */}
            <Button variant="ghost" size="sm" onClick={toggleAll} color="fg.muted">
              {allFolded ? "Expand all" : "Collapse all"}
            </Button>
          </Flex>

          <SectionList module={module} folded={folded} onToggle={toggle} />
        </Stack>
      )}
    </PageContainer>
  );
}

function SectionList({
  module,
  folded,
  onToggle,
}: {
  module: ModuleDetail;
  folded: ReadonlySet<string>;
  onToggle: (sectionId: string) => void;
}) {
  return (
    <Stack gap="6">
      {module.sections.map((section, index) => {
        const open = !folded.has(section.id);
        const bodyId = `section-${section.id}`;
        return (
          <Stack key={section.id} as="section" gap="3">
            <SectionHeader
              section={section}
              number={index + 1}
              open={open}
              onToggle={() => onToggle(section.id)}
              controls={bodyId}
            />
            {/* `hidden` for assistive technology, `display` because a styled
                element's own display rule would otherwise override it. */}
            <Box id={bodyId} hidden={!open} display={open ? "block" : "none"}>
              <SectionItems section={section} moduleSlug={module.slug} />
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

/**
 * The Section's name, and the switch that folds it.
 *
 * A heading wrapping a button, which is the accordion pattern assistive
 * technology expects: the heading keeps the page's outline, and the button
 * says whether what follows is open.
 */
function SectionHeader({
  section,
  number,
  open,
  onToggle,
  controls,
}: {
  section: ModuleSectionView;
  number: number;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <Box as="h2" margin="0">
      <chakra.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        display="flex"
        alignItems="center"
        gap="3"
        width="full"
        textAlign="start"
        paddingY="2"
        cursor="pointer"
        color="fg.default"
        borderBottomWidth={`${PIXEL / 2}px`}
        borderColor="border.muted"
        _hover={{ color: "accent.fg", borderColor: "accent.solid" }}
      >
        {/* The number is real information: a Section is an ordered step
            through the Module, not a card in an unordered pile. */}
        <Text
          as="span"
          textStyle="display"
          fontSize="sm"
          color="accent.fg"
          flexShrink="0"
          minWidth="7"
        >
          {sectionNumberLabel(number)}
        </Text>
        <Text as="span" textStyle="display" fontSize="md" flex="1" minWidth="0">
          {section.title}
        </Text>
        <Text as="span" fontSize="xs" color="fg.muted" flexShrink="0">
          {sectionCounts(section)}
        </Text>
        <Box as="span" flexShrink="0" color="fg.muted" aria-hidden>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </Box>
      </chakra.button>
    </Box>
  );
}

function SectionItems({ section, moduleSlug }: { section: ModuleSectionView; moduleSlug: string }) {
  if (section.materials.length === 0 && section.assessments.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" ps="8">
        Nothing in this section yet.
      </Text>
    );
  }

  return (
    <Stack gap="2">
      {section.materials.map((material) => (
        <MaterialLink key={material.id} href={routes.material(moduleSlug, material.id)}>
          <HStack gap="3" minWidth="0">
            <FileText size={16} aria-hidden />
            <Text truncate>{material.title}</Text>
            {/* Spelled out: a terminal icon beside a bare "2" left the Coder
                to guess what was being counted. */}
            {material.practiceCount > 0 ? (
              <Badge tone="accent" plain flexShrink="0">
                <Terminal size={12} aria-hidden /> {material.practiceCount} practice
              </Badge>
            ) : null}
          </HStack>
        </MaterialLink>
      ))}

      {/* Set apart from the rows above rather than continuing them. An
          Assessment is the gate at the end of the Section, and it was reading
          as the next line in a list of things to click. */}
      {section.assessments.map((assessment, index) => (
        <Box key={assessment.id} mt={index === 0 ? "2" : "0"}>
          <AssessmentCard
            href={routes.assessment(moduleSlug, assessment.id)}
            assessment={assessment}
          />
        </Box>
      ))}
    </Stack>
  );
}

/**
 * A Material: a quiet row. It is one of many in a Section and a Coder reads
 * down them, so anything louder would turn a reading list into a wall.
 *
 * `display: block` is load-bearing on every link below. A link is inline by
 * default, and an inline box wrapped around a block has its side padding
 * applied to empty line fragments rather than to the content — which is why
 * the icon and the chevron sat against the edge of the frame.
 */
function MaterialLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Box
      asChild
      display="block"
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
 * Four things separate it from a Material: a tinted surface rather than the
 * page's own, the full-weight frame instead of the rows' 2px one, more padding
 * on every side, and a kicker naming what it is.
 *
 * Lagoon rather than crimson. Crimson is the product's alarm colour, and
 * spending it on every Assessment made the ordinary next step in a Module read
 * as a warning.
 */
function AssessmentCard({ href, assessment }: { href: string; assessment: AssessmentSummary }) {
  const timing = (
    <TimingBadge
      durationMinutes={assessment.timeMode === "UNTIMED" ? null : assessment.durationMinutes}
      executionMode={assessment.executionMode}
    />
  );

  return (
    <PixelFrame
      tone="info"
      surface="bg.info"
      _hover={{ bg: "info.solid", _dark: { bg: "info.solid" } }}
    >
      {/* Wider than it is tall: the notch bites a square out of each corner,
          and at a smaller inset the icon and the chevron sat inside the bite. */}
      <Box asChild display="block" px="6" py="4">
        <NextLink href={href}>
          <Flex align="center" justify="space-between" gap="4">
            <HStack gap="3" minWidth="0">
              <Box color="fg.info" flexShrink="0">
                <ClipboardCheck size={18} aria-hidden />
              </Box>
              <Stack gap="1" minWidth="0">
                <Text textStyle="display" fontSize="3xs" color="fg.info">
                  Assessment
                </Text>
                <Text truncate fontWeight="medium">
                  {assessment.title}
                </Text>
                {/* Under the title on a phone, where beside it the badge
                    squeezed the name down to its first three letters. */}
                <Box display={{ base: "block", sm: "none" }} pt="1">
                  {timing}
                </Box>
              </Stack>
            </HStack>

            {/* The timing badge sits by the chevron. Beside the title it pushed
                a long name into truncation on the one link in the Section where
                the name matters most. */}
            <HStack gap="3" flexShrink="0">
              <Box display={{ base: "none", sm: "block" }}>{timing}</Box>
              <ChevronRight size={16} aria-hidden />
            </HStack>
          </Flex>
        </NextLink>
      </Box>
    </PixelFrame>
  );
}
