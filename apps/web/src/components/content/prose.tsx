import { Fragment, type ReactNode } from "react";
import { Box, Heading, List, Stack, Text } from "@chakra-ui/react";
import {
  parseMarkdownLite,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown-lite";

/**
 * Authored prose — a problem statement, a Practice prompt — with the small
 * amount of structure those need to be readable.
 *
 * It renders a parsed tree into React elements. Nothing here builds markup from
 * a string: every piece of the author's text arrives as a text node, so the
 * rule that authored content never reaches the document as HTML still holds.
 * See `lib/markdown-lite.ts` for the subset and why it is that small.
 *
 * Text that uses none of it renders as it always did, which matters more than
 * the features: every statement written before this existed still reads as the
 * paragraphs its author laid out.
 */
export function Prose({
  source,
  size = "sm",
  color = "fg.default",
}: {
  source: string;
  /** `sm` in a side panel, `md` where the prose is the page. */
  size?: "sm" | "md";
  color?: string;
}) {
  const blocks = parseMarkdownLite(source);
  if (blocks.length === 0) return null;

  return (
    <Stack gap={size === "sm" ? "3" : "4"} color={color}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} size={size} />
      ))}
    </Stack>
  );
}

const HEADING_SIZE = {
  sm: { 1: "sm", 2: "xs", 3: "2xs" },
  md: { 1: "md", 2: "sm", 3: "xs" },
} as const;

function Block({ block, size }: { block: BlockNode; size: "sm" | "md" }) {
  const bodySize = size === "sm" ? "sm" : "md";

  switch (block.kind) {
    case "heading":
      return (
        <Heading
          as={block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4"}
          textStyle="display"
          fontSize={HEADING_SIZE[size][block.level]}
          // The accent is what separates a heading from bold text at these
          // sizes: the display face is already uppercase, so weight alone does
          // not tell them apart.
          color={block.level === 1 ? "fg.default" : "accent.fg"}
          mt={block.level === 1 ? "2" : "1"}
        >
          <Inline content={block.content} />
        </Heading>
      );

    case "paragraph":
      // Preserved whitespace, because a single newline is a line break an
      // author typed on purpose rather than a wrap to be collapsed.
      return (
        <Text fontSize={bodySize} lineHeight="tall" whiteSpace="pre-wrap">
          <Inline content={block.content} />
        </Text>
      );

    case "list":
      return (
        <List.Root
          as={block.ordered ? "ol" : "ul"}
          // Chakra's default marker sits outside the content box and gets
          // clipped by a panel's padding at this width.
          listStylePosition="inside"
          listStyleType={block.ordered ? "decimal" : "square"}
          fontSize={bodySize}
          lineHeight="tall"
          ps="1"
        >
          {block.items.map((item, index) => (
            <List.Item key={index}>
              <Inline content={item} />
            </List.Item>
          ))}
        </List.Root>
      );

    case "quote":
      return (
        <Box borderStartWidth="4px" borderColor="accent.solid" ps="3" py="0.5">
          <Text fontSize={bodySize} lineHeight="tall" whiteSpace="pre-wrap" color="fg.muted">
            <Inline content={block.content} />
          </Text>
        </Box>
      );

    case "code":
      return (
        <Box
          as="pre"
          margin="0"
          padding="3"
          bg="bg.subtle"
          borderWidth="2px"
          borderColor="border.muted"
          textStyle="data"
          fontSize="xs"
          lineHeight="1.6"
          overflowX="auto"
        >
          {block.value}
        </Box>
      );

    case "rule":
      return <Box height="2px" bg="border.muted" aria-hidden />;
  }
}

function Inline({ content }: { content: InlineNode[] }): ReactNode {
  return content.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "strong":
        return (
          <Text key={index} as="strong" fontWeight="bold">
            {node.value}
          </Text>
        );
      case "em":
        return (
          <Text key={index} as="em" fontStyle="italic">
            {node.value}
          </Text>
        );
      case "code":
        return (
          <Text
            key={index}
            as="code"
            textStyle="data"
            fontSize="0.9em"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.muted"
            px="1"
            py="0.5"
          >
            {node.value}
          </Text>
        );
    }
  });
}
