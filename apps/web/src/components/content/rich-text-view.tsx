import { Fragment, type ReactNode } from "react";
import { Box, Code, Heading, Link, List, Text } from "@chakra-ui/react";
import {
  INTERACTIVE_BLOCK_NODE_TYPE,
  type RichTextDocument,
  type RichTextNode,
} from "@ambatucode/shared";
import { InteractiveBlockNode } from "./interactive-block";
import { headingLevel, sanitizeHref } from "./rich-text";

/**
 * Renders the stored Material document.
 *
 * The node vocabulary is deliberately open — the editor's extension set decides
 * what a Material may contain, and pinning the list here would mean a renderer
 * change every time the toolbar grows. An unknown node therefore renders its
 * children rather than disappearing: a paragraph inside a callout this build
 * has never heard of is still text the Coder is meant to read.
 */

export type RichTextViewProps = {
  document: RichTextDocument;
};

export function RichTextView({ document }: RichTextViewProps) {
  return (
    <Box display="flex" flexDirection="column" gap="4">
      {document.content.map((node, index) => (
        <Fragment key={index}>{renderNode(node, index)}</Fragment>
      ))}
    </Box>
  );
}

function renderChildren(node: RichTextNode): ReactNode {
  return (node.content ?? []).map((child, index) => (
    <Fragment key={index}>{renderNode(child, index)}</Fragment>
  ));
}

function renderNode(node: RichTextNode, index: number): ReactNode {
  switch (node.type) {
    case "text":
      return renderText(node);

    case "hardBreak":
      return <br />;

    case "paragraph":
      return <Text lineHeight="tall">{renderChildren(node)}</Text>;

    case "heading": {
      const level = headingLevel(node.attrs);
      if (level === null) return <Text fontWeight="semibold">{renderChildren(node)}</Text>;
      const size = level === 1 ? "xl" : level === 2 ? "lg" : "md";
      return (
        <Heading as={`h${level}`} size={size}>
          {renderChildren(node)}
        </Heading>
      );
    }

    case "bulletList":
      return <List.Root paddingStart="6">{renderChildren(node)}</List.Root>;

    case "orderedList":
      return (
        <List.Root as="ol" paddingStart="6">
          {renderChildren(node)}
        </List.Root>
      );

    case "listItem":
      return <List.Item>{renderChildren(node)}</List.Item>;

    case "codeBlock":
      return (
        <Box
          as="pre"
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="md"
          padding="4"
          overflowX="auto"
          fontFamily="mono"
          fontSize="sm"
        >
          {renderChildren(node)}
        </Box>
      );

    case "blockquote":
      return (
        <Box
          borderStartWidth="4px"
          borderColor="border.default"
          paddingStart="4"
          color="fg.muted"
          display="flex"
          flexDirection="column"
          gap="2"
        >
          {renderChildren(node)}
        </Box>
      );

    case "horizontalRule":
      return <Box borderTopWidth="1px" borderColor="border.default" />;

    case INTERACTIVE_BLOCK_NODE_TYPE:
      // The only node whose attrs are a closed shape, because it is the only
      // one that executes. It is parsed and framed inside its own component.
      return <InteractiveBlockNode node={node} />;

    default:
      return <Fragment key={index}>{renderChildren(node)}</Fragment>;
  }
}

/**
 * Marks wrap outward-in, so the innermost element is the text itself. Link is
 * applied last on purpose: a bold link should still be a link.
 */
function renderText(node: RichTextNode): ReactNode {
  let element: ReactNode = node.text ?? "";

  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        element = <Text as="strong">{element}</Text>;
        break;
      case "italic":
        element = <Text as="em">{element}</Text>;
        break;
      case "strike":
        element = <Text as="s">{element}</Text>;
        break;
      case "code":
        element = <Code>{element}</Code>;
        break;
      case "link": {
        const href = sanitizeHref(mark.attrs?.href);
        // A rejected href keeps the text and drops the link: the reader still
        // sees what was written, and nothing executable is rendered.
        element = href ? (
          <Link href={href} rel="noreferrer noopener" target="_blank">
            {element}
          </Link>
        ) : (
          element
        );
        break;
      }
      default:
        break;
    }
  }

  return element;
}
