"use client";

import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { Medal } from "lucide-react";
import type { LeaderboardRow, LeaderboardScope } from "@ambatucode/shared";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, Table } from "@/components/ui/table";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { isApiError } from "@/lib/api-client";
import { boardExtent, scoringNote, viewerNote } from "./leaderboard-copy";

/**
 * A ranking, live.
 *
 * Three things it deliberately does not do. It does not invent a rank for a
 * Coder with no official score — an empty board says so. It does not show a
 * board an Architect switched off; the server refuses that read and this
 * renders the refusal as a plain note rather than an error, because a hidden
 * leaderboard is a choice, not a fault. And it never renders during an active
 * attempt: gamification belongs to learning, and the workspace does not mount
 * this at all.
 */

/**
 * The podium's medal inks. It used to pick a tone per rank and then never apply
 * it, so first, second, and third all wore the same grey medal.
 */
const MEDAL_COLOR: Readonly<Record<number, string>> = {
  1: "warning.fg",
  2: "fg.muted",
  3: "accent.fg",
};

/** Colour is never the only signal — the rank number sits beside it. */
function RankMark({ rank }: { rank: number }) {
  const medal = MEDAL_COLOR[rank];
  return (
    <HStack gap="1.5">
      {medal === undefined ? null : (
        <Box as="span" color={medal} display="inline-flex">
          <Medal size={14} aria-hidden />
        </Box>
      )}
      <Text fontVariantNumeric="tabular-nums" fontWeight={rank <= 3 ? "semibold" : "normal"}>
        {rank}
      </Text>
    </HStack>
  );
}

function Rows({
  rows,
  viewerId,
  assessmentCount,
}: {
  rows: LeaderboardRow[];
  viewerId: string;
  assessmentCount: number;
}) {
  return (
    <Table.Body>
      {rows.map((row) => {
        const isViewer = row.userId === viewerId;
        return (
          <Table.Row key={row.userId} bg={isViewer ? "bg.subtle" : undefined}>
            <Table.Cell width="4rem">
              <RankMark rank={row.rank} />
            </Table.Cell>
            <Table.Cell>
              <HStack gap="2" wrap="wrap">
                <Text fontWeight={isViewer ? "semibold" : "normal"}>{row.displayName}</Text>
                {isViewer ? (
                  <Badge tone="accent" size="sm">
                    You
                  </Badge>
                ) : null}
              </HStack>
            </Table.Cell>
            <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
              {row.score}
            </Table.Cell>
            {/* Out of how many, so a low total reads as "has not sat them all"
                rather than as a poor score. */}
            <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums">
              {row.assessmentsCounted}/{assessmentCount}
            </Table.Cell>
          </Table.Row>
        );
      })}
    </Table.Body>
  );
}

export function LeaderboardPanel({
  scope,
  scopeId,
  viewerId,
  limit = 25,
}: {
  scope: LeaderboardScope;
  scopeId: string;
  viewerId: string;
  limit?: number;
}) {
  const { data, isPending, isError, error } = useLeaderboard(scope, scopeId, { limit });

  // A board the Architect switched off is a decision, not a failure.
  if (isError && isApiError(error) && error.code === "FORBIDDEN") {
    return (
      <EmptyState
        sprite="trophy"
        title="No leaderboard here"
        description="The Architect has turned competitive ranking off for this assessment."
      />
    );
  }

  if (isError) {
    return (
      <EmptyState
        sprite="trophy"
        title="Leaderboard unavailable"
        description="The ranking could not be loaded."
      />
    );
  }

  if (isPending || data === undefined) {
    return (
      <Stack gap="2">
        {[0, 1, 2, 3, 4].map((key) => (
          <Skeleton key={key} height="2.5rem" borderRadius="0" />
        ))}
      </Stack>
    );
  }

  if (data.assessmentCount === 0) {
    return (
      <EmptyState
        sprite="trophy"
        title="Nothing to rank yet"
        description={
          data.hiddenAssessmentCount > 0
            ? "Every assessment here has competitive ranking switched off."
            : "A ranking appears once this has a published assessment."
        }
      />
    );
  }

  if (data.rows.length === 0) {
    return (
      <EmptyState
        sprite="trophy"
        title="No scores yet"
        description="The board fills in as Coders finish their assessments."
      />
    );
  }

  const viewerShown = data.rows.some((row) => row.userId === viewerId);
  const standing = viewerNote(data.viewerRank, data.rankedCount, viewerShown);

  return (
    <Stack gap="3">
      <Stack gap="1">
        <Text textStyle="display" fontSize="xs">
          {boardExtent(data.rows.length, data.rankedCount)}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {scoringNote(data.scope, data.assessmentCount)}
        </Text>
      </Stack>

      <DataTable caption={`Leaderboard for ${data.title}`}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Rank</Table.ColumnHeader>
            <Table.ColumnHeader>Coder</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Points</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Assessments</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Rows rows={data.rows} viewerId={viewerId} assessmentCount={data.assessmentCount} />
      </DataTable>

      <Flex justify="space-between" gap="3" wrap="wrap">
        {standing === null ? (
          <Box />
        ) : (
          <Text fontSize="xs" color="fg.muted">
            {standing}
          </Text>
        )}
        {data.hiddenAssessmentCount > 0 ? (
          <Text fontSize="xs" color="fg.muted">
            {data.hiddenAssessmentCount} assessment
            {data.hiddenAssessmentCount === 1 ? "" : "s"} excluded by their Architect.
          </Text>
        ) : null}
      </Flex>
    </Stack>
  );
}
