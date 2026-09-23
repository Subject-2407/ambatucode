"use client";

import { useId, useState } from "react";
import { Box, Stack, Text } from "@chakra-ui/react";
import type { AuthenticatedUser } from "@ambatucode/shared";
import { AchievementShowcase } from "@/components/gamification/achievement-showcase";
import { ROLE_LABEL } from "@/components/layout/navigation";
import { PixelFrame } from "@/components/ui/pixel-frame";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";

/**
 * Who you are, and what you have earned — one screen, two tabs.
 *
 * Titles used to have their own rail slot. That made the rail carry two
 * entries about the same person, and left a screen whose whole content was one
 * grid. They belong together: a profile is the account *and* what the account
 * has done.
 */

const TABS: readonly TabItem[] = [
  { value: "account", label: "Account" },
  { value: "achievements", label: "Achievements" },
];

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box as="div" display={{ sm: "grid" }} gridTemplateColumns={{ sm: "10rem 1fr" }} gap="1">
      <Text as="dt" fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text as="dd" fontSize="sm" color="fg.default">
        {children}
      </Text>
    </Box>
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
  const [tab, setTab] = useState("account");
  const panelId = useId();

  return (
    <Stack gap="4">
      <TabBar
        items={TABS}
        value={tab}
        onValueChange={setTab}
        controls={panelId}
        aria-label="Profile section"
      />

      <TabPanel id={panelId} value={tab}>
        {tab === "account" ? (
          <PixelFrame pad="5">
            <Stack as="dl" gap="4">
              <DetailRow label="Display name">{user.displayName}</DetailRow>
              <DetailRow label="Username">{user.username}</DetailRow>
              <DetailRow label="Role">{ROLE_LABEL[user.role]}</DetailRow>
              <DetailRow label="Session ends">
                <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleString("en-GB")}</time>
              </DetailRow>
            </Stack>
          </PixelFrame>
        ) : (
          <AchievementShowcase userId={user.id} />
        )}
      </TabPanel>
    </Stack>
  );
}
