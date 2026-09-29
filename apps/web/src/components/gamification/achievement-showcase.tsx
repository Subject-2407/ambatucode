"use client";

import { useId, useMemo, useState } from "react";
import { Box, Flex, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock, Trophy } from "lucide-react";
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
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";
import { useAchievements } from "@/hooks/use-achievements";
import { AchievementIcon } from "./achievement-icon";

/**
 * Achievements a Coder has earned, and the ones still out there.
 *
 * Called Achievements everywhere a Coder reads it. The screen said "titles"
 * in one line and "Achievements" in the tab above it, which left a reader
 * wondering whether they were two different things.
 *
 * Locked achievements are shown with their full description rather than hidden
 * behind question marks. An achievement nobody can read is not a goal, it is a
 * surprise — and the descriptions say things like "submit without running your
 * code first", which is the sort of thing worth reading beforehand.
 */

const ALL = "ALL";

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

function entriesFor(showcase: AchievementShowcaseView, category: string): Entry[] {
  const earned: Entry[] = showcase.earned.map((achievement) => ({ kind: "earned", achievement }));
  const locked: Entry[] = showcase.locked.map((achievement) => ({ kind: "locked", achievement }));
  // Earned first: the showcase is a trophy shelf before it is a to-do list.
  const all = [...earned, ...locked];
  return category === ALL
    ? all
    : all.filter((entry) => entry.achievement.category === (category as AchievementCategory));
}

export function AchievementShowcase({ userId }: { userId: string }) {
  const [category, setCategory] = useState<string>(ALL);
  const panelId = useId();
  const { data, isPending, isError, error, refetch } = useAchievements(userId);

  const tabs = useMemo<TabItem[]>(
    () => [
      { value: ALL, label: "All" },
      ...ACHIEVEMENT_CATEGORIES.map((value) => ({
        value,
        label: ACHIEVEMENT_CATEGORY_LABEL[value],
      })),
    ],
    [],
  );

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (isPending || data === undefined) {
    return (
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="3">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height="6rem" borderRadius="0" />
        ))}
      </Grid>
    );
  }

  const entries = entriesFor(data, category);

  return (
    <Stack gap="4">
      <HStack gap="3" wrap="wrap">
        <Trophy size={18} aria-hidden />
        <Text fontSize="sm" color="fg.muted">
          {data.earned.length} of {data.earned.length + data.locked.length} achievements earned
        </Text>
      </HStack>

      <TabBar
        items={tabs}
        value={category}
        onValueChange={setCategory}
        controls={panelId}
        aria-label="Category"
      />

      <TabPanel id={panelId} value={category}>
        {entries.length === 0 ? (
          <EmptyState sprite="trophy" title="No achievements in this category" />
        ) : (
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="3">
            {entries.map((entry) =>
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
        )}
      </TabPanel>
    </Stack>
  );
}
