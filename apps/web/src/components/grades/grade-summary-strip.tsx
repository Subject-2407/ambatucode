"use client";

import { Box, Flex, Text } from "@chakra-ui/react";
import type { GradeRecordSummary } from "@ambatucode/shared";
import { PixelFrame } from "@/components/ui/pixel-frame";

/**
 * The filtered set in four numbers, over every page rather than the one on
 * screen — the question "how did the class do" should not need a calculator
 * and twelve clicks of Next.
 *
 * The choice count only appears when there is something to choose. A standing
 * "0 need a choice" would be one more number to read past on every visit.
 */
export function GradeSummaryStrip({ summary }: { summary: GradeRecordSummary }) {
  return (
    <PixelFrame tone="muted" pad={{ base: "3", md: "4" }}>
      {/* Not a live region: the pager below already announces the new count,
          and four numbers read out on every keystroke in the search box is noise. */}
      <Flex as="dl" gap={{ base: "4", md: "8" }} wrap="wrap">
        <SummaryItem
          label="Records"
          value={String(summary.records)}
          detail="one per Coder per session"
        />
        <SummaryItem
          label="Average official"
          value={summary.averageScore === null ? "—" : String(summary.averageScore)}
          detail={`over ${summary.scored} scored`}
        />
        <SummaryItem
          label="Submitted"
          value={`${summary.submitted}/${summary.records}`}
          detail="have a submission"
        />
        {summary.needsOfficialChoice > 0 ? (
          <SummaryItem
            label="To choose"
            value={String(summary.needsOfficialChoice)}
            detail={
              summary.needsOfficialChoice === 1
                ? "record needs an official attempt"
                : "records need an official attempt"
            }
            warning
          />
        ) : null}
      </Flex>
    </PixelFrame>
  );
}

function SummaryItem({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <Box minWidth="0">
      <Text as="dt" textStyle="display" fontSize="2xs" color="fg.muted">
        {label}
      </Text>
      <Box as="dd" margin="0">
        <Text
          as="span"
          display="block"
          fontSize="lg"
          fontWeight="semibold"
          fontVariantNumeric="tabular-nums"
          color={warning ? "warning.fg" : "fg.default"}
        >
          {value}
        </Text>
        <Text as="span" display="block" fontSize="xs" color="fg.muted">
          {detail}
        </Text>
      </Box>
    </Box>
  );
}
