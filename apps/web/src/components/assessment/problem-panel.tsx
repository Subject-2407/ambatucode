"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";
import type { SampleCaseView } from "@ambatucode/shared";

/**
 * The problem statement and its public sample cases.
 *
 * The statement is stored as prose, not as a rich text document — that is what
 * keeps Interactive Blocks out of a timed workspace, where an Architect-authored
 * program would run beside the anti-cheat controls with nothing to gain. So it
 * renders as preserved-whitespace text, with no markup path at all.
 *
 * Only sample cases reach this component. Hidden cases and expected outputs for
 * grading never leave the server; if one ever appears in this payload it is a
 * backend defect, not something to render carefully.
 */
export function ProblemPanel({
  title,
  problemStatement,
  sampleCases,
}: {
  title: string;
  problemStatement: string;
  sampleCases: SampleCaseView[];
}) {
  return (
    <Stack gap="5" padding={{ base: "4", md: "5" }}>
      <Heading as="h1" textStyle="display" fontSize="lg">
        {title}
      </Heading>

      <Text whiteSpace="pre-wrap" fontSize="sm" lineHeight="tall">
        {problemStatement}
      </Text>

      {sampleCases.length === 0 ? null : (
        <Stack gap="3">
          <Heading as="h2" textStyle="display" fontSize="xs" color="accent.fg">
            Sample cases
          </Heading>
          {sampleCases.map((sample, index) => (
            <SampleCase key={`${sample.name}-${String(index)}`} sample={sample} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function SampleCase({ sample }: { sample: SampleCaseView }) {
  return (
    <Stack
      gap="2"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="md"
      bg="bg.subtle"
      padding="3"
    >
      <Text textStyle="display" fontSize="2xs" color="fg.muted">
        {sample.name}
      </Text>
      <SampleBlock label="Input" value={sample.input} />
      <SampleBlock label="Expected output" value={sample.expectedOutput} />
    </Stack>
  );
}

function SampleBlock({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="1">
      <Text fontSize="2xs" color="fg.subtle" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Box
        as="pre"
        fontFamily="mono"
        fontSize="xs"
        whiteSpace="pre-wrap"
        overflowX="auto"
        color="fg.default"
      >
        {value === "" ? "(empty)" : value}
      </Box>
    </Stack>
  );
}
