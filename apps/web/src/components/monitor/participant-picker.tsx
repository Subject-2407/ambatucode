"use client";

import { useMemo, useState } from "react";
import { Box, Checkbox, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { EnrollmentView, ParticipantView } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import { useReplaceParticipants } from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";

/**
 * Who takes part in this session.
 *
 * The list is a snapshot, not a live query: `ALL_ENROLLED` copies the Module's
 * approved Coders at the moment it is saved and does not follow later
 * enrolments. That is deliberate — a list that changed under a running session
 * would change who the warning at Start was about.
 *
 * Clearing the list is a real choice, not an empty state. A session with no
 * list is open to every enrolled Coder, which is what an ordinary Individual
 * or Untimed assessment usually wants.
 */
export function ParticipantPicker({
  sessionId,
  enrolled,
  participants,
  disabled,
}: {
  sessionId: string;
  /** Approved enrolments in the Module this session belongs to. */
  enrolled: EnrollmentView[];
  /** The session's current list, used to seed the selection. */
  participants: ParticipantView[];
  /** True once the session has started, when the list is fixed. */
  disabled: boolean;
}) {
  const replace = useReplaceParticipants(sessionId);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(participants.filter((participant) => participant.isListed).map((p) => p.userId)),
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return enrolled;
    return enrolled.filter(
      (enrollment) =>
        enrollment.coder.displayName.toLowerCase().includes(needle) ||
        enrollment.coder.username.toLowerCase().includes(needle),
    );
  }, [enrolled, search]);

  function toggle(userId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  async function save(mode: "ALL_ENROLLED" | "SELECTED") {
    try {
      await replace.mutateAsync(
        mode === "ALL_ENROLLED"
          ? { mode: "ALL_ENROLLED" }
          : { mode: "SELECTED", userIds: [...selected] },
      );
      if (mode === "ALL_ENROLLED") setSelected(new Set(enrolled.map((e) => e.coder.id)));
      toaster.success({ title: "Participant list saved" });
    } catch (error) {
      toaster.error({
        title: "Could not save the participant list",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (disabled) {
    return (
      <Text fontSize="sm" color="fg.muted">
        The participant list is fixed once a session starts.
      </Text>
    );
  }

  return (
    <Stack gap="4">
      <HStack gap="2" wrap="wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void save("ALL_ENROLLED")}
          loading={replace.isPending}
        >
          Select everyone enrolled
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
          Clear selection
        </Button>
        <Text fontSize="xs" color="fg.muted">
          {selected.size} of {enrolled.length} selected
        </Text>
      </HStack>

      <HStack gap="2">
        <Box color="fg.muted" aria-hidden>
          <Search size={16} />
        </Box>
        <Input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search participants"
          size="sm"
          aria-label="Search participants"
        />
      </HStack>

      <Stack gap="2" maxHeight="20rem" overflowY="auto">
        {filtered.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            {enrolled.length === 0
              ? "No approved enrolments in this module yet."
              : "No participant matches that search."}
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

      <HStack gap="3">
        <Button size="sm" onClick={() => void save("SELECTED")} loading={replace.isPending}>
          Save participant list
        </Button>
        <Text fontSize="xs" color="fg.muted">
          Saving an empty list opens the session to every enrolled Coder.
        </Text>
      </HStack>
    </Stack>
  );
}
