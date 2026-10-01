"use client";

import { memo, useMemo, useRef, useState } from "react";
import { Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp } from "lucide-react";
import type { MonitorEventPayload } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import {
  EVENT_CATEGORY_LABEL,
  countByCategory,
  describeEvent,
  filterEvents,
  type EventCategory,
} from "@/lib/monitor-events";

/**
 * The session's log, read like one.
 *
 * It used to be a narrow column beside the participant grid: a badge and a
 * name per row, every type of event interleaved, the detail that made an entry
 * meaningful left out. It is now a table of its own — time, participant,
 * event, detail — narrowed by what kind of event and by whom, because the
 * question is nearly always a specific one: who left the window, what happened
 * to this Coder.
 *
 * New events arrive at the top. While the Architect is scrolled down reading,
 * the list holds still and counts what has arrived, rather than shoving the
 * row they were reading out from under them.
 */

const ROW_HEIGHT = 44;
const CATEGORIES: readonly (EventCategory | "ALL")[] = [
  "ALL",
  "ANTI_CHEAT",
  "CONNECTION",
  "ATTEMPT",
  "SESSION",
];
/** Columns: time, participant, event, detail. Detail folds away on a narrow screen. */
const COLUMNS = {
  base: "4.5rem minmax(0, 1fr) minmax(0, 1.2fr)",
  md: "5.5rem minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.4fr)",
};

export function ActivityLog({
  events,
  participants,
  nameFor,
  userId,
  onUserIdChange,
}: {
  /** Newest first. */
  events: MonitorEventPayload[];
  /** Who the Coder filter offers, in display order. */
  participants: readonly { userId: string; displayName: string }[];
  nameFor: (userId: string | null) => string;
  /** The Coder the log is narrowed to; held by the screen so a card can set it. */
  userId: string | null;
  onUserIdChange: (userId: string | null) => void;
}) {
  const [category, setCategory] = useState<EventCategory | "ALL">("ALL");
  /** The list as it stood when the Architect scrolled away from the top. */
  const [held, setHeld] = useState<MonitorEventPayload[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const forCoder = useMemo(
    () => filterEvents(events, { category: "ALL", userId }),
    [events, userId],
  );
  const counts = useMemo(() => countByCategory(forCoder), [forCoder]);
  const latest = useMemo(
    () => filterEvents(forCoder, { category, userId: null }),
    [category, forCoder],
  );
  const shown = held ?? latest;
  const arrived = held === null ? 0 : latest.length - held.length;

  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  function release() {
    setHeld(null);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function choose(next: EventCategory | "ALL") {
    setCategory(next);
    setHeld(null);
  }

  return (
    <Stack gap="3">
      <HStack justify="space-between" gap="3" wrap="wrap" align="end">
        <HStack gap="1.5" wrap="wrap" role="group" aria-label="Kind of event">
          {CATEGORIES.map((value) => (
            <Button
              key={value}
              size="xs"
              variant={category === value ? "solid" : "outline"}
              aria-pressed={category === value}
              onClick={() => choose(value)}
            >
              {value === "ALL" ? "All" : EVENT_CATEGORY_LABEL[value]}
              <Text as="span" textStyle="data" opacity={0.8}>
                {counts[value]}
              </Text>
            </Button>
          ))}
        </HStack>
        <Box minWidth="12rem">
          <SelectField
            label="Participant"
            value={userId ?? ""}
            onChange={(value) => {
              onUserIdChange(value === "" ? null : value);
              setHeld(null);
            }}
            options={[
              { value: "", label: "Everyone" },
              ...participants.map((participant) => ({
                value: participant.userId,
                label: participant.displayName,
              })),
            ]}
          />
        </Box>
      </HStack>

      <Box borderWidth="1px" borderColor="border.default" minWidth="0">
        <Grid
          templateColumns={COLUMNS}
          gap="3"
          px="3"
          py="2"
          bg="bg.subtle"
          borderBottomWidth="1px"
          borderColor="border.default"
          role="row"
        >
          {["Time", "Participant", "Event", "Detail"].map((heading, index) => (
            <Text
              key={heading}
              role="columnheader"
              textStyle="display"
              fontSize="2xs"
              color="fg.muted"
              display={index === 3 ? { base: "none", md: "block" } : undefined}
            >
              {heading}
            </Text>
          ))}
        </Grid>

        {arrived > 0 ? (
          <HStack
            justify="center"
            py="1.5"
            bg="accent.subtle"
            borderBottomWidth="1px"
            borderColor="border.default"
          >
            <Button size="xs" variant="ghost" onClick={release}>
              <ArrowUp aria-hidden />
              {arrived} new {arrived === 1 ? "event" : "events"} — show latest
            </Button>
          </HStack>
        ) : null}

        {shown.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" px="3" py="6" textAlign="center">
            {events.length === 0
              ? "Nothing has happened in this session yet."
              : "No events match these filters."}
          </Text>
        ) : (
          <Box
            ref={scrollRef}
            height="30rem"
            overflowY="auto"
            role="log"
            aria-label="Session activity"
            onScroll={(event) => {
              const away = event.currentTarget.scrollTop > ROW_HEIGHT;
              if (away && held === null) setHeld(latest);
              else if (!away && held !== null) setHeld(null);
            }}
          >
            <Box position="relative" height={`${String(virtualizer.getTotalSize())}px`}>
              {virtualizer.getVirtualItems().map((item) => {
                const event = shown[item.index];
                if (!event) return null;
                return (
                  <Box
                    key={event.id}
                    position="absolute"
                    top="0"
                    insetStart="0"
                    width="100%"
                    height={`${String(item.size)}px`}
                    transform={`translateY(${String(item.start)}px)`}
                  >
                    <LogRow event={event} name={nameFor(event.userId)} />
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

const LogRow = memo(function LogRow({ event, name }: { event: MonitorEventPayload; name: string }) {
  const description = describeEvent(event);
  const at = new Date(event.occurredAt);
  return (
    <Grid
      templateColumns={COLUMNS}
      gap="3"
      alignItems="center"
      height="100%"
      px="3"
      borderBottomWidth="1px"
      borderColor="border.muted"
      _hover={{ bg: "bg.subtle" }}
      role="row"
    >
      <Text
        fontSize="xs"
        color="fg.muted"
        textStyle="data"
        title={at.toLocaleString()}
        fontVariantNumeric="tabular-nums"
      >
        {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </Text>
      <Text fontSize="sm" truncate color={event.userId === null ? "fg.muted" : undefined}>
        {name}
      </Text>
      <Box minWidth="0">
        <Badge tone={description.tone} maxWidth="100%" title={description.detail ?? undefined}>
          <Text as="span" truncate>
            {description.label}
          </Text>
        </Badge>
      </Box>
      <Text
        fontSize="xs"
        color="fg.muted"
        truncate
        display={{ base: "none", md: "block" }}
        title={description.detail ?? undefined}
      >
        {description.detail ?? "—"}
      </Text>
    </Grid>
  );
});
