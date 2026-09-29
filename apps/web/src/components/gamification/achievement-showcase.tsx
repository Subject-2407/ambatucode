"use client";

import { useId } from "react";
import { Box, Flex, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABEL,
  type AchievementCategory,
  type AchievementShowcaseView,
  type AchievementView,
  type UserAchievementView,
} from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { pixelSkin } from "@/theme/pixel";
import { formatDate } from "@/lib/format-date";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAchievements } from "@/hooks/use-achievements";
import { AchievementIcon } from "./achievement-icon";

/**
 * Achievements a Coder has earned, and the ones still out there.
 *
 * Called Achievements everywhere a Coder reads it. The screen said "titles"
 * in one line and "Achievements" in the tab above it, which left a reader
 * wondering whether they were two different things.
 *
 * Grouped under a heading per category rather than behind a tab per category.
 * A row of ten tabs overflowed a phone, and even where it fitted it hid nine
 * tenths of the shelf behind clicks. Headings keep the grouping and let the
 * whole catalogue be read in one scroll; each carries its own count, so how
 * far along a category is reads at a glance.
 *
 * Locked achievements are shown with their full description rather than hidden
 * behind question marks. An achievement nobody can read is not a goal, it is a
 * surprise, and the descriptions say things like "without running your code
 * first", which is the sort of thing worth reading beforehand.
 *
 * The overall "N of M" line is not drawn here. It belongs to the profile's
 * identity card, next to the person it describes; `achievementTally` gives it
 * the same numbers this component groups.
 */

export type AchievementTally = { earned: number; total: number };

export function achievementTally(showcase: AchievementShowcaseView): AchievementTally {
  return {
    earned: showcase.earned.length,
    total: showcase.earned.length + showcase.locked.length,
  };
}

function AchievementCard({
  achievement,
  awardedAt,
}: {
  achievement: AchievementView;
  awardedAt?: string;
}) {
  const earned = awardedAt !== undefined;
  return (
    <Flex
      gap="3"
      padding="4"
      // An earned achievement is one of only two things in the product allowed
      // to be gold; the other is the frame around Architect-authored content.
      // Keeping it that scarce is what makes gold mean "you earned this" on
      // sight.
      //
      // Locked wears the same notched edge in the muted ink, on the subtle
      // ground, with a lock for an icon — not a faded card: the description is
      // the goal, and fading it would fail contrast for the very text a Coder
      // is meant to read. The dashed rounded box this replaces was the one
      // shape on the screen that was not drawn on the pixel grid.
      {...pixelSkin(
        earned ? "var(--amb-colors-gold-solid)" : "var(--amb-colors-border-muted)",
        earned ? "var(--amb-colors-bg-surface)" : "var(--amb-colors-bg-subtle)",
        3,
      )}
      align="start"
    >
      <Box color={earned ? "gold.fg" : "fg.muted"} paddingTop="0.5" flexShrink={0}>
        {earned ? (
          <AchievementIcon iconKey={achievement.iconKey} size={22} />
        ) : (
          <Lock size={22} aria-hidden />
        )}
      </Box>
      <Stack gap="1" minWidth="0">
        <HStack gap="2" wrap="wrap">
          <Text textStyle="display" fontSize="sm">
            {achievement.name}
          </Text>
          {/* Never colour alone: the state is spelled out. */}
          <Badge tone={earned ? "gold" : "neutral"} size="sm">
            {earned ? "Earned" : "Locked"}
          </Badge>
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {achievement.description}
        </Text>
        {earned ? (
          <Text fontSize="xs" color="fg.muted">
            Earned {formatDate(awardedAt)}
          </Text>
        ) : null}
      </Stack>
    </Flex>
  );
}

type Entry =
  | { kind: "earned"; achievement: UserAchievementView }
  | { kind: "locked"; achievement: AchievementView };

type Shelf = { category: AchievementCategory; entries: Entry[]; earned: number };

function shelvesFor(showcase: AchievementShowcaseView): Shelf[] {
  // Earned first within each category: the showcase is a trophy shelf before
  // it is a to-do list.
  const all: Entry[] = [
    ...showcase.earned.map((achievement): Entry => ({ kind: "earned", achievement })),
    ...showcase.locked.map((achievement): Entry => ({ kind: "locked", achievement })),
  ];
  return ACHIEVEMENT_CATEGORIES.map((category) => {
    const entries = all.filter((entry) => entry.achievement.category === category);
    const earned = entries.filter((entry) => entry.kind === "earned").length;
    return { category, entries, earned };
  }).filter((shelf) => shelf.entries.length > 0);
}

const GRID_COLUMNS = { base: "1fr", md: "repeat(2, 1fr)" } as const;

export function AchievementShowcase({ userId }: { userId: string }) {
  const headingId = useId();
  const { data, isPending, isError, error, refetch } = useAchievements(userId);

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (isPending || data === undefined) {
    return (
      <Grid templateColumns={GRID_COLUMNS} gap="3">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height="6rem" borderRadius="0" />
        ))}
      </Grid>
    );
  }

  return (
    <Stack gap="6">
      {shelvesFor(data).map((shelf) => {
        const id = `${headingId}-${shelf.category}`;
        return (
          <Stack as="section" key={shelf.category} aria-labelledby={id} gap="3">
            <Flex justify="space-between" align="baseline" gap="3">
              <Heading as="h3" id={id} textStyle="display" fontSize="xs">
                {ACHIEVEMENT_CATEGORY_LABEL[shelf.category]}
              </Heading>
              {/* "1/5" reads as a fraction aloud, so it is spelled out for a
                  screen reader and drawn compact for everyone else. */}
              <Text textStyle="data" fontSize="xs" color="fg.muted" flexShrink={0}>
                <span aria-hidden>
                  {shelf.earned}/{shelf.entries.length}
                </span>
                <Text as="span" srOnly>
                  {shelf.earned} of {shelf.entries.length} earned
                </Text>
              </Text>
            </Flex>
            <Grid templateColumns={GRID_COLUMNS} gap="3">
              {shelf.entries.map((entry) =>
                entry.kind === "earned" ? (
                  <AchievementCard
                    key={entry.achievement.code}
                    achievement={entry.achievement}
                    awardedAt={entry.achievement.awardedAt}
                  />
                ) : (
                  <AchievementCard key={entry.achievement.code} achievement={entry.achievement} />
                ),
              )}
            </Grid>
          </Stack>
        );
      })}
    </Stack>
  );
}
