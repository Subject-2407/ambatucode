"use client";

import { Flex, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Trophy } from "lucide-react";
import type { AuthenticatedUser } from "@ambatucode/shared";
import {
  AchievementShowcase,
  achievementTally,
} from "@/components/gamification/achievement-showcase";
import { ROLE_LABEL } from "@/components/layout/navigation";
import { Badge } from "@/components/ui/badge";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { useAchievements } from "@/hooks/use-achievements";
import { formatDateTime } from "@/lib/format-date";
import { pixelSkin } from "@/theme/pixel";

/**
 * Who you are, and what you have done, on one screen with no tabs.
 *
 * Achievements used to have their own rail slot, which made the rail carry two
 * entries about the same person. Then they sat behind a second tab here, which
 * cost a click to reach the half of the screen most visits are for, and split
 * apart two things that read as one: a profile is the person *and* what the
 * person has done. So the identity card sits on top, carrying the overall
 * count, and the shelf follows it.
 */

const ACHIEVEMENTS_HEADING_ID = "profile-achievements";

function initialOf(displayName: string): string {
  // Array.from rather than charAt: a name that opens with an emoji or any
  // other astral character would otherwise be cut in half.
  return (Array.from(displayName.trim())[0] ?? "?").toUpperCase();
}

function Avatar({ displayName }: { displayName: string }) {
  return (
    // Decorative: the name it stands for is printed right beside it.
    <Flex
      aria-hidden
      width="14"
      height="14"
      flexShrink={0}
      align="center"
      justify="center"
      {...pixelSkin("var(--amb-colors-accent-solid)", "var(--amb-colors-accent-subtle)")}
      color="accent.fg"
      textStyle="display"
      fontSize="xl"
    >
      {initialOf(displayName)}
    </Flex>
  );
}

function AchievementCount({ userId }: { userId: string }) {
  // The same query the showcase below makes, so react-query serves both from
  // one request.
  const { data } = useAchievements(userId);
  // Nothing while pending or failed: the showcase owns the loading and error
  // states, and a placeholder here would only say the same thing twice.
  if (data === undefined) return null;
  const { earned, total } = achievementTally(data);
  return (
    <HStack gap="2" color="fg.muted">
      <Trophy size={16} aria-hidden />
      <Text fontSize="sm">
        {earned} of {total} achievements earned
      </Text>
    </HStack>
  );
}

export function ProfileScreen({
  user,
  expiresAt,
}: {
  user: AuthenticatedUser;
  /** Serialized, because this crosses the server/client boundary as props. */
  expiresAt: string;
}) {
  return (
    <Stack gap="8">
      <PixelFrame pad="5">
        <Stack direction={{ base: "column", sm: "row" }} gap="4" align={{ sm: "center" }}>
          <Avatar displayName={user.displayName} />
          <Stack gap="1.5" minWidth="0">
            <HStack gap="2" wrap="wrap">
              <Text textStyle="display" fontSize="md" wordBreak="break-word">
                {user.displayName}
              </Text>
              {/* A label, not a state, so no status square. */}
              <Badge tone="accent" plain>
                {ROLE_LABEL[user.role]}
              </Badge>
            </HStack>
            <Text textStyle="data" fontSize="sm" color="fg.muted" wordBreak="break-all">
              @{user.username}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Session ends <time dateTime={expiresAt}>{formatDateTime(expiresAt)}</time>
            </Text>
            <AchievementCount userId={user.id} />
          </Stack>
        </Stack>
      </PixelFrame>

      <Stack as="section" aria-labelledby={ACHIEVEMENTS_HEADING_ID} gap="4">
        <Heading as="h2" id={ACHIEVEMENTS_HEADING_ID} textStyle="display" fontSize="sm">
          Achievements
        </Heading>
        <AchievementShowcase userId={user.id} />
      </Stack>
    </Stack>
  );
}
