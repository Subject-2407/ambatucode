"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { HStack, Stack, Text } from "@chakra-ui/react";
import type { NavItem } from "./navigation";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Vertical on desktop, a horizontally scrolling row on narrow screens. The
 * active item is marked by weight and a filled background as well as colour, so
 * it survives both themes and colour-blind viewing.
 */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <Stack
      as="nav"
      aria-label="Main"
      direction={{ base: "row", md: "column" }}
      gap="1"
      overflowX={{ base: "auto", md: "visible" }}
      flex={{ md: "1" }}
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <HStack
            key={item.href}
            asChild
            gap="2.5"
            px="3"
            py="2"
            rounded="l2"
            flexShrink="0"
            color={active ? "accent.fg" : "fg.muted"}
            bg={active ? "accent.subtle" : "transparent"}
            fontWeight={active ? "semibold" : "medium"}
            fontSize="sm"
            _hover={{ bg: active ? "accent.subtle" : "bg.subtle", color: "fg.default" }}
          >
            <NextLink href={item.href} aria-current={active ? "page" : undefined}>
              <Icon size={18} aria-hidden />
              <Text>{item.label}</Text>
            </NextLink>
          </HStack>
        );
      })}
    </Stack>
  );
}
