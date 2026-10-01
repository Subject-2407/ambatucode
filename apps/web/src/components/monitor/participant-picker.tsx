"use client";

import { useMemo, useState } from "react";
import { Box, Checkbox, HStack, Stack, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { ParticipantView } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toaster } from "@/components/ui/toaster";
import { useApprovedCoders } from "@/hooks/use-session-candidates";
import { useReplaceParticipants } from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";

/**
 * Choosing the Coders a session limited to a list is for.
 *
 * The selection is a draft until it is saved, and says so. It used to be
 * seeded once, at mount — usually before the current list had arrived — so it
 * opened empty, and saving it as found wiped the list. It now follows the
 * saved list until the Architect changes something, and stops following it
 * from then on so a refresh cannot undo their edits.
 *
 * A session open to everyone enrolled has no list to choose, so this is only
 * shown for one limited to chosen Coders.
 */
export function ParticipantPicker({
  sessionId,
  moduleId,
  participants,
}: {
  sessionId: string;
  moduleId: string;
  /** The session's participants as last read, used to seed the selection. */
  participants: ParticipantView[];
}) {
  const replace = useReplaceParticipants(sessionId);
  const coders = useApprovedCoders(moduleId);
  const [search, setSearch] = useState("");

  const saved = useMemo(
    () => new Set(participants.filter((participant) => participant.isListed).map((p) => p.userId)),
    [participants],
  );
  /** Null while following the saved list; the Architect's edits once they make one. */
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const selected = draft ?? saved;
  const dirty = draft !== null;

  const enrolled = useMemo(() => coders.data ?? [], [coders.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return enrolled;
    return enrolled.filter(
      (enrollment) =>
        enrollment.coder.displayName.toLowerCase().includes(needle) ||
        enrollment.coder.username.toLowerCase().includes(needle),
    );
  }, [enrolled, search]);

  function change(next: ReadonlySet<string>) {
    setDraft(next);
  }

  function toggle(userId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(userId);
    else next.delete(userId);
    change(next);
  }

  /** Adds what the search shows, so "search, select all" picks out a group. */
  function selectShown() {
    const next = new Set(selected);
    for (const enrollment of filtered) next.add(enrollment.coder.id);
    change(next);
  }

  async function save() {
    try {
      await replace.mutateAsync({ mode: "SELECTED", userIds: [...selected] });
      setDraft(null);
      toaster.success({ title: "Participants saved" });
    } catch (error) {
      toaster.error({
        title: "Could not save the participants",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (coders.isPending) return <Skeleton height="12rem" />;
  if (coders.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        The enrolled Coders could not be loaded.
      </Text>
    );
  }

  return (
    <Stack gap="4">
      <HStack gap="2" wrap="wrap">
        <Button size="sm" variant="outline" onClick={selectShown} disabled={filtered.length === 0}>
          {search.trim() === "" ? "Select all" : "Select these"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => change(new Set())}>
          Clear
        </Button>
        <Text fontSize="xs" color="fg.muted">
          {selected.size} of {enrolled.length} chosen
        </Text>
      </HStack>

      <HStack gap="2">
        <Box color="fg.muted" aria-hidden>
          <Search size={16} />
        </Box>
        <Input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search by name or username"
          size="sm"
          aria-label="Search enrolled Coders"
        />
      </HStack>

      <Stack gap="2" maxHeight="20rem" overflowY="auto">
        {filtered.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {enrolled.length === 0
              ? "No approved enrollments in this module yet."
              : "Nobody matches that search."}
          </Text>
        ) : (
          filtered.map((enrollment) => (
            <Checkbox.Root
              key={enrollment.coder.id}
              checked={selected.has(enrollment.coder.id)}
              colorPalette="accent"
              onCheckedChange={(details) => toggle(enrollment.coder.id, details.checked === true)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>
                {enrollment.coder.displayName}
                <Text as="span" fontSize="xs" color="fg.muted" ms="2">
                  {enrollment.coder.username}
                </Text>
              </Checkbox.Label>
            </Checkbox.Root>
          ))
        )}
      </Stack>

      <HStack gap="3" wrap="wrap">
        <Button size="sm" onClick={() => void save()} loading={replace.isPending} disabled={!dirty}>
          Save participants
        </Button>
        {dirty ? (
          <>
            <Text fontSize="xs" color="fg.warning">
              Unsaved changes
            </Text>
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              Undo
            </Button>
          </>
        ) : null}
      </HStack>
    </Stack>
  );
}
