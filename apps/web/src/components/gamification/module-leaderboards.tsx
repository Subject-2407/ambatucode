"use client";

import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import type { LeaderboardScope } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SelectField, type SelectOption } from "@/components/ui/select";
import { LeaderboardPanel } from "./leaderboard-panel";

/**
 * The module's leaderboard, in a drawer the Coder opens when they want it.
 *
 * It used to be a second column beside the Section list, which halved the width
 * of the thing a Coder actually came to the page for and locked the page to
 * the window so both halves could scroll. Ranking is something a Coder checks,
 * not something they read alongside every Material, so it waits behind a
 * button.
 *
 * Section boards exist because a module runs for a term and the module board
 * quickly becomes a record of who joined earliest. A section board is the one
 * a Coder can still move on this week. They are picked from a list rather than
 * a row of tabs: a module with eight Sections produced a tab row wider than the
 * panel it sat in.
 *
 * Nothing is mounted until the drawer opens, and only the selected board then,
 * so opening the module does not join a socket room for every section in it.
 */
export function ModuleLeaderboardDrawer({
  moduleId,
  viewerId,
  sections,
}: {
  moduleId: string;
  viewerId: string;
  sections: ReadonlyArray<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(moduleId);

  const options = useMemo<SelectOption[]>(
    () => [
      { value: moduleId, label: "Whole module" },
      ...sections.map((section) => ({ value: section.id, label: section.title })),
    ],
    [moduleId, sections],
  );

  const scope: LeaderboardScope = selected === moduleId ? "MODULE" : "SECTION";

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trophy aria-hidden />
        Leaderboard
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Leaderboard"
        headerExtra={
          sections.length > 0 ? (
            <SelectField
              label="Ranking"
              value={selected}
              options={options}
              onChange={setSelected}
            />
          ) : null
        }
      >
        {open ? (
          <LeaderboardPanel
            // Remounting on scope change drops the previous board's socket room
            // rather than leaving the socket in two at once.
            key={selected}
            scope={scope}
            scopeId={selected}
            viewerId={viewerId}
          />
        ) : null}
      </Drawer>
    </>
  );
}
