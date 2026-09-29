import NextLink from "next/link";
import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/**
 * Where this page sits, and the way back up.
 *
 * It replaces a lone "Back to module" button, which offered a way out but never
 * said which Module or which Section the reader was in — on a Material three
 * Sections deep, that is exactly what a Coder loses track of.
 *
 * On a phone only the nearest parent is shown, with a back chevron: a full
 * trail wraps into three lines above the title it is meant to introduce.
 */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const parent = [...items].reverse().find((item) => item.href !== undefined);

  return (
    <Box as="nav" aria-label="Breadcrumb" mb="3" fontSize="sm">
      {parent?.href ? (
        <HStack asChild gap="1" color="fg.muted" display={{ base: "inline-flex", md: "none" }}>
          <NextLink href={parent.href}>
            <ChevronLeft size={14} aria-hidden />
            <Text truncate>{parent.label}</Text>
          </NextLink>
        </HStack>
      ) : null}

      <HStack as="ol" gap="1.5" wrap="wrap" color="fg.muted" display={{ base: "none", md: "flex" }}>
        {items.map((item, index) => (
          <HStack as="li" key={`${item.label}-${String(index)}`} gap="1.5" minWidth="0">
            {index === 0 ? null : <ChevronRight size={14} aria-hidden />}
            {item.href ? (
              <Text
                asChild
                truncate
                maxWidth="20rem"
                _hover={{ color: "fg.default", textDecoration: "underline" }}
              >
                <NextLink href={item.href}>{item.label}</NextLink>
              </Text>
            ) : (
              <Text
                truncate
                maxWidth="20rem"
                aria-current={index === items.length - 1 ? "page" : undefined}
              >
                {item.label}
              </Text>
            )}
          </HStack>
        ))}
      </HStack>
    </Box>
  );
}
