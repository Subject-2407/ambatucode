"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Text } from "@chakra-ui/react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { PIXEL } from "@/theme/pixel";
import type { NavItem } from "./navigation";

/**
 * Navigation as a row of equipment slots rather than a list of links.
 *
 * Every destination is a 48px square carrying one 8×8 sprite. That is the whole
 * idea: a Coder reading a Material for twenty minutes should be able to find
 * any part of the app without the navigation ever taking a column of the page,
 * and an icon at that size has to be a silhouette, which is what the sprite set
 * is built for.
 *
 * Vertical on desktop, a bottom row on a phone. Not a hamburger: hiding
 * navigation behind a button costs a tap on every single move, and the slots
 * already fit across the narrowest screen the product supports.
 */

const SLOT = "48px";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function InventoryRail({
  items,
  footer,
}: {
  items: readonly NavItem[];
  /** Account controls. They sit apart from destinations, at the far end. */
  footer?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <Flex
      as="nav"
      aria-label="Main"
      direction={{ base: "row", md: "column" }}
      align="center"
      gap={{ base: "1", md: "2.5" }}
      flexShrink="0"
      bg="bg.surface"
      width={{ base: "full", md: "72px" }}
      // The rail is the page's one persistent edge, so it carries a heavy one.
      borderTopWidth={{ base: `${PIXEL}px`, md: "0" }}
      borderEndWidth={{ md: `${PIXEL}px` }}
      borderColor="border.default"
      position="sticky"
      bottom={{ base: "0", md: "auto" }}
      top={{ md: "0" }}
      height={{ md: "100dvh" }}
      zIndex="docked"
      paddingY={{ base: "2", md: "3" }}
      paddingX={{ base: "2", md: "0" }}
      // Clears the phone's home indicator without the last slot sliding under it.
      paddingBottom={{ base: "calc(var(--chakra-spacing-2) + env(safe-area-inset-bottom, 0px))", md: "3" }}
      overflowX={{ base: "auto", md: "visible" }}
      justifyContent={{ base: "space-between", md: "flex-start" }}
    >
      <Box
        aria-hidden
        display={{ base: "none", md: "block" }}
        textStyle="display"
        fontSize="xl"
        color="fg.default"
        textAlign="center"
        width="40px"
        paddingBottom="2"
        borderBottomWidth="3px"
        borderColor="border.default"
      >
        A
      </Box>

      <Flex
        direction={{ base: "row", md: "column" }}
        gap={{ base: "1", md: "2.5" }}
        align="center"
        flex={{ md: "1" }}
      >
        {items.map((item) => (
          <RailSlot key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </Flex>

      {footer ? (
        <Flex direction={{ base: "row", md: "column" }} gap="1.5" align="center">
          {footer}
        </Flex>
      ) : null}
    </Flex>
  );
}

/**
 * One slot.
 *
 * The active slot is marked three ways — filled, outlined, and tabbed — because
 * any one of them alone fails somewhere: fill alone disappears for a
 * colour-blind reader, the outline alone is easy to miss at a glance, and the
 * tab alone does not exist on the phone layout.
 */
function RailSlot({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Box position="relative" flexShrink="0">
      <Flex
        asChild
        width={SLOT}
        height={SLOT}
        align="center"
        justify="center"
        borderRadius="0"
        borderWidth="3px"
        borderColor={active ? "border.emphasized" : "border.muted"}
        bg={active ? "accent.solid" : "bg.canvas"}
        color={active ? "accent.contrast" : "fg.muted"}
        _hover={active ? undefined : { bg: "bg.subtle", color: "fg.default", borderColor: "border.default" }}
      >
        <NextLink href={item.href} aria-current={active ? "page" : undefined} title={item.label}>
          <PixelIcon name={item.icon} size={22} />
          {/* The sprite is the whole visual, so the name lives here for
              assistive technology and for end-to-end selectors. */}
          <Text srOnly>{item.label}</Text>
        </NextLink>
      </Flex>

      {active ? (
        <Box
          aria-hidden
          display={{ base: "none", md: "block" }}
          position="absolute"
          insetEnd="-16px"
          top="18px"
          width="8px"
          height="12px"
          bg="accent.solid"
        />
      ) : null}
    </Box>
  );
}
