"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import NextLink from "next/link";
import { Box, Flex, Grid, HStack, Stack, Text, chakra } from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Columns2,
  FileText,
  LayoutGrid,
  Rows3,
  Terminal,
} from "lucide-react";
import type { AssessmentSummary, ModuleDetail, ModuleSectionView } from "@ambatucode/shared";
import { PageContainer, PageHeader, type PageWidth } from "@/components/layout/app-shell";
import { TimingBadge } from "@/components/assessment/timing-badge";
import { ModuleLeaderboardDrawer } from "@/components/gamification/module-leaderboards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { moduleViewCookie, type ModuleView } from "@/lib/module-view";
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
 * A Module's contents, laid out the way this Coder prefers to read them.
 *
 * Three layouts rather than one, because Modules differ: a short one reads
 * best as a single list, a long one is easier to take in as a grid of Section
 * cards, and on a wide screen the list beside a panel about the Module uses
 * the space a single column leaves empty. The choice is the Coder's, and it is
 * remembered for every Module.
 *
 * Every layout shows the same Sections in the same order with the same
 * folding; only the arrangement changes. On a phone all three collapse into one
 * column, so the switch is not offered there.
 */

const VIEW_WIDTH: Readonly<Record<ModuleView, PageWidth>> = {
  list: "reading",
  columns: "wide",
  grid: "wide",
};

const VIEW_OPTIONS: ReadonlyArray<{ value: ModuleView; label: string; icon: ReactNode }> = [
  { value: "list", label: "One column", icon: <Rows3 aria-hidden /> },
  { value: "columns", label: "Two columns", icon: <Columns2 aria-hidden /> },
  { value: "grid", label: "Grid", icon: <LayoutGrid aria-hidden /> },
];

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

function moduleTotals(module: ModuleDetail) {
  let materials = 0;
  let practice = 0;
  let assessments = 0;
  for (const section of module.sections) {
    materials += section.materials.length;
    assessments += section.assessments.length;
    for (const material of section.materials) practice += material.practiceCount;
  }
  return { sections: module.sections.length, materials, practice, assessments };
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

export function ModuleOverview({
  module,
  viewerId,
  initialView,
}: {
  module: ModuleDetail;
  viewerId: string;
  /** From the cookie, so the server already rendered this layout. */
  initialView: ModuleView;
}) {
  const [view, setView] = useState<ModuleView>(initialView);
  const [folded, setFolded] = useSectionFolds(module.id);

  const chooseView = useCallback((next: ModuleView) => {
    setView(next);
    document.cookie = moduleViewCookie(next);
  }, []);

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

  const totals = moduleTotals(module);
  // Beside the Sections, the description lives in the panel; saying it in the
  // header as well would print the same paragraph twice on one screen.
  const description = view === "columns" ? undefined : (module.description ?? undefined);

  return (
    <PageContainer width={VIEW_WIDTH[view]} backdrop="constellation">
      {/* No Public or Closed badge. Once a Coder is inside, how they got in no
          longer matters. */}
      <PageHeader
        title={module.title}
        description={description}
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
          <Toolbar
            summary={[
              plural(totals.sections, "section", "sections"),
              plural(totals.materials, "material", "materials"),
              plural(totals.assessments, "assessment", "assessments"),
            ].join(" · ")}
            view={view}
            onViewChange={chooseView}
            allFolded={allFolded}
            onToggleAll={toggleAll}
          />

          {view === "grid" ? (
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
              gap="4"
              alignItems="start"
            >
              {module.sections.map((section, index) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  number={index + 1}
                  moduleSlug={module.slug}
                  open={!folded.has(section.id)}
                  onToggle={() => toggle(section.id)}
                />
              ))}
            </Grid>
          ) : view === "columns" ? (
            <Grid
              templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 20rem" }}
              gap="8"
              alignItems="start"
            >
              <SectionList module={module} folded={folded} onToggle={toggle} />
              <ModuleAside module={module} totals={totals} />
            </Grid>
          ) : (
            <SectionList module={module} folded={folded} onToggle={toggle} />
          )}
        </Stack>
      )}
    </PageContainer>
  );
}

function Toolbar({
  summary,
  view,
  onViewChange,
  allFolded,
  onToggleAll,
}: {
  summary: string;
  view: ModuleView;
  onViewChange: (view: ModuleView) => void;
  allFolded: boolean;
  onToggleAll: () => void;
}) {
  return (
    <Flex align="center" justify="space-between" gap="3" wrap="wrap">
      <Text fontSize="sm" color="fg.muted">
        {summary}
      </Text>

      <HStack gap="3">
        {/* Words only: at this size the two-chevron icon read as a close cross. */}
        <Button variant="ghost" size="sm" onClick={onToggleAll} color="fg.muted">
          {allFolded ? "Expand all" : "Collapse all"}
        </Button>
        {/* Not on a phone: every layout is one column there, so the switch
            would change nothing a Coder could see. */}
        <Box display={{ base: "none", md: "block" }}>
          <ViewSwitch value={view} onChange={onViewChange} />
        </Box>
      </HStack>
    </Flex>
  );
}

/**
 * Three toggle buttons in one notched strip, the chosen one filled.
 *
 * Pressed buttons rather than a radio group, because each is an immediate
 * action with a visible result, and `aria-pressed` says which is on in a way
 * every screen reader announces.
 */
function ViewSwitch({
  value,
  onChange,
}: {
  value: ModuleView;
  onChange: (view: ModuleView) => void;
}) {
  return (
    <HStack
      role="group"
      aria-label="Layout"
      gap="0.5"
      padding="1"
      {...pixelSkin("var(--amb-colors-border-muted)", "var(--amb-colors-bg-surface)", 2)}
    >
      {VIEW_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <chakra.button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            width="8"
            height="8"
            cursor="pointer"
            color={active ? "accent.contrast" : "fg.muted"}
            bg={active ? "accent.solid" : "transparent"}
            _hover={active ? undefined : { color: "fg.default", bg: "bg.subtle" }}
            _icon={{ width: "4", height: "4" }}
          >
            {option.icon}
          </chakra.button>
        );
      })}
    </HStack>
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
              ruled
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
  ruled = false,
}: {
  section: ModuleSectionView;
  number: number;
  open: boolean;
  onToggle: () => void;
  controls: string;
  /** A hard line under the header, for the list layouts where nothing frames the Section. */
  ruled?: boolean;
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
        borderBottomWidth={ruled ? `${PIXEL / 2}px` : "0"}
        borderColor="border.muted"
        _hover={{ color: "accent.fg", borderColor: "accent.solid" }}
      >
        {/* The number is real information: a Section is an ordered step
            through the Module, not a card in an unordered pile. */}
        <Text as="span" textStyle="display" fontSize="xs" color="accent.fg" flexShrink="0">
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

/**
 * A Section as a card in the grid.
 *
 * Its items are plain rows rather than the list's framed ones: a frame inside
 * a frame inside a grid is three edges deep, and at a third of the width the
 * edges would take more room than the titles. An Assessment keeps its colour
 * and its kicker, so it is still the gate at the end.
 */
function SectionCard({
  section,
  number,
  moduleSlug,
  open,
  onToggle,
}: {
  section: ModuleSectionView;
  number: number;
  moduleSlug: string;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = `section-${section.id}`;
  const empty = section.materials.length === 0 && section.assessments.length === 0;

  return (
    <PixelFrame as="section" tone="muted" pad="4">
      <Stack gap="2">
        <SectionHeader
          section={section}
          number={number}
          open={open}
          onToggle={onToggle}
          controls={bodyId}
        />
        <Stack id={bodyId} hidden={!open} display={open ? "flex" : "none"} gap="1">
          {empty ? (
            <Text fontSize="sm" color="fg.muted">
              Nothing in this section yet.
            </Text>
          ) : null}
          {section.materials.map((material) => (
            <CompactItem
              key={material.id}
              href={routes.material(moduleSlug, material.id)}
              icon={<FileText size={14} aria-hidden />}
              title={material.title}
            />
          ))}
          {section.assessments.map((assessment) => (
            <CompactItem
              key={assessment.id}
              href={routes.assessment(moduleSlug, assessment.id)}
              icon={<ClipboardCheck size={14} aria-hidden />}
              title={assessment.title}
              assessment
            />
          ))}
        </Stack>
      </Stack>
    </PixelFrame>
  );
}

function CompactItem({
  href,
  icon,
  title,
  assessment = false,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  assessment?: boolean;
}) {
  return (
    <Box
      asChild
      display="block"
      paddingX="2"
      paddingY="2"
      bg={assessment ? "bg.info" : undefined}
      color={assessment ? "fg.info" : "fg.default"}
      _hover={{ bg: assessment ? "info.subtle" : "bg.subtle", color: "fg.default" }}
    >
      <NextLink href={href}>
        <HStack gap="2.5" minWidth="0">
          <Box flexShrink="0">{icon}</Box>
          <Text fontSize="sm" truncate flex="1" minWidth="0">
            {title}
          </Text>
          {assessment ? (
            <Badge tone="info" size="sm" flexShrink="0">
              Assessment
            </Badge>
          ) : null}
          <Box flexShrink="0" color="fg.muted">
            <ChevronRight size={14} aria-hidden />
          </Box>
        </HStack>
      </NextLink>
    </Box>
  );
}

/**
 * What the Module is, beside what is in it. Sticky, so it stays in view while a
 * long list of Sections scrolls past.
 */
function ModuleAside({
  module,
  totals,
}: {
  module: ModuleDetail;
  totals: ReturnType<typeof moduleTotals>;
}) {
  const facts: ReadonlyArray<readonly [string, string]> = [
    ["Architect", module.owner.displayName],
    ["Sections", String(totals.sections)],
    ["Materials", String(totals.materials)],
    ["Practice activities", String(totals.practice)],
    ["Assessments", String(totals.assessments)],
  ];

  return (
    // First on a phone, where the two columns stack: what the Module is comes
    // before the list of what is in it.
    <Box position={{ lg: "sticky" }} top={{ lg: "8" }} order={{ base: -1, lg: 0 }}>
      <PixelFrame pad="5">
        <Stack gap="4">
          <Text textStyle="display" fontSize="xs">
            About this module
          </Text>
          {module.description ? (
            <Text fontSize="sm" color="fg.muted" lineHeight="tall">
              {module.description}
            </Text>
          ) : null}
          <Stack as="dl" gap="2" fontSize="sm">
            {facts.map(([label, value]) => (
              <Flex key={label} justify="space-between" gap="3">
                <Text as="dt" color="fg.muted">
                  {label}
                </Text>
                <Text as="dd" textStyle="data" textAlign="end">
                  {value}
                </Text>
              </Flex>
            ))}
          </Stack>
        </Stack>
      </PixelFrame>
    </Box>
  );
}
