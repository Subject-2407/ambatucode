"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";
import type { SampleCaseView } from "@ambatucode/shared";
import { Prose } from "@/components/content/prose";
import { pixelSkin } from "@/theme/pixel";

/**
 * The problem statement and its public sample cases.
 *
 * The statement is stored as prose, not as a rich text document — that is what
 * keeps Interactive Blocks out of a timed workspace, where an Architect-authored
 * program would run beside the anti-cheat controls with nothing to gain.
 *
 * It is rendered through `Prose`, which reads a small Markdown subset and emits
 * React elements. Still no markup path: the parser produces data and the
 * renderer produces text nodes, so nothing an Architect types becomes HTML in
 * this document. A statement that uses none of the syntax renders exactly as
 * the preserved-whitespace text it used to be.
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

      <Prose source={problemStatement} />

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
      {...pixelSkin("var(--amb-colors-border-default)", "var(--amb-colors-bg-subtle)", 2)}
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
        textStyle="data"
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
