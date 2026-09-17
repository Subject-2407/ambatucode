"use client";

import { useId, useMemo, useState } from "react";
import { Stack } from "@chakra-ui/react";
import type { LeaderboardScope } from "@ambatucode/shared";
import { TabBar, TabPanel, type TabItem } from "@/components/ui/tabs";
import { LeaderboardPanel } from "./leaderboard-panel";

/**
 * The module's leaderboard, with a tab per section.
 *
 * Section boards exist because a module runs for a term and the module board
 * quickly becomes a record of who joined earliest. A section board is the one
 * a Coder can still move on this week.
 *
 * Only the selected board is mounted, so opening the module does not join a
 * socket room for every section in it.
 */
export function ModuleLeaderboards({
  moduleId,
  viewerId,
  sections,
}: {
  moduleId: string;
  viewerId: string;
  sections: ReadonlyArray<{ id: string; title: string }>;
}) {
  const [selected, setSelected] = useState(moduleId);
  const panelId = useId();

  const tabs = useMemo<TabItem[]>(
    () => [
      { value: moduleId, label: "Whole module" },
      ...sections.map((section) => ({ value: section.id, label: section.title })),
    ],
    [moduleId, sections],
  );

  const scope: LeaderboardScope = selected === moduleId ? "MODULE" : "SECTION";

  return (
    <Stack gap="4">
      {sections.length > 0 ? (
        <TabBar
          items={tabs}
          value={selected}
          onValueChange={setSelected}
          controls={panelId}
          aria-label="Leaderboard"
        />
      ) : null}
      <TabPanel id={panelId} value={selected}>
        <LeaderboardPanel
          // Remounting on scope change drops the previous board's socket room
          // rather than leaving the socket in two at once.
          key={selected}
          scope={scope}
          scopeId={selected}
          viewerId={viewerId}
        />
      </TabPanel>
    </Stack>
  );
}
