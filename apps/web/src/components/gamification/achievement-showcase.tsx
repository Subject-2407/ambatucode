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
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";
import { useAchievements } from "@/hooks/use-achievements";
import { AchievementIcon } from "./achievement-icon";

/**
 * Titles a Coder has earned, and the ones still out there.
 *
 * Locked titles are shown with their full description rather than hidden
 * behind question marks. An achievement nobody can read is not a goal, it is a
 * surprise — and the descriptions say things like "submit without running your
 * code first", which is the sort of thing worth reading beforehand.
 */

const ALL = "ALL";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
      borderWidth="1px"
      borderRadius="lg"
      borderColor={earned ? "accent.solid" : "border.default"}
      // Locked is a dashed outline and a muted icon, not a faded card: the
      // description is the goal, and fading it would fail contrast for the
      // very text a Coder is meant to read.
      borderStyle={earned ? "solid" : "dashed"}
      bg={earned ? "bg.surface" : "bg.subtle"}
      align="start"
    >
      <Box color={earned ? "accent.solid" : "fg.muted"} paddingTop="0.5" flexShrink={0}>
        {earned ? (
          <AchievementIcon iconKey={achievement.iconKey} size={22} />
        ) : (
          <Lock size={22} aria-hidden />
        )}
      </Box>
      <Stack gap="1" minWidth="0">
        <HStack gap="2" wrap="wrap">
          <Text fontWeight="medium">{achievement.name}</Text>
          {/* Never colour alone: the state is spelled out. */}
          <Badge tone={earned ? "success" : "neutral"} size="sm">
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
          <Skeleton key={key} height="6rem" borderRadius="lg" />
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
          {data.earned.length} of {data.earned.length + data.locked.length} titles earned
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
          <EmptyState
            icon={<Trophy aria-hidden />}
            title="Nothing here yet"
            description="Titles in this category appear once there is work to earn them on."
          />
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
