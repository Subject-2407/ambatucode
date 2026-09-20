"use client";

import { useState, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Text, chakra } from "@chakra-ui/react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import type { SpriteName } from "@/components/ui/pixel-sprites";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSession } from "@/providers/session-provider";
import { PIXEL, pixelSkin } from "@/theme/pixel";
import type { NavItem } from "./navigation";

/**
 * Navigation as a row of equipment slots rather than a list of links.
 *
 * Every destination is a sprite over a one-word label. The label is there
 * because an 8×8 silhouette is a reminder, not a definition — it names the slot
 * you already know and leaves you guessing on the first visit. The word costs
 * ten pixels of height and removes the guess.
 *
 * The column takes its width from the longest label rather than a fixed number.
 * A hard-coded 84px was a guess that had to be re-guessed every time a
 * destination was added; with the column sized to its content the widest
 * caption decides, and every slot matches it.
 *
 * Vertical on desktop, a bottom row on a phone. Not a hamburger: hiding
 * navigation behind a button costs a tap on every single move, and the slots
 * already fit across the narrowest screen the product supports.
 */

/** The slot's height, and its width on a phone where slots sit side by side. */
const SLOT_HEIGHT = "56px";
const PHONE_SLOT_WIDTH = "64px";

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
      gap={{ base: "1", md: "2" }}
      flexShrink="0"
      bg="bg.surface"
      // `max-content` is what sizes the column to its widest slot; the slots
      // then stretch to fill it, so one caption sets the width for all of them.
      width={{ base: "full", md: "max-content" }}
      // The rail is the page's one persistent edge, so it carries a heavy one.
      borderTopWidth={{ base: `${PIXEL}px`, md: "0" }}
      borderEndWidth={{ md: `${PIXEL}px` }}
      borderColor="border.rail"
      position="sticky"
      bottom={{ base: "0", md: "auto" }}
      top={{ md: "0" }}
      height={{ md: "100dvh" }}
      zIndex="docked"
      paddingY={{ base: "2", md: "3" }}
      paddingX="2"
      // Clears the phone's home indicator without the last slot sliding under it.
      paddingBottom={{
        base: "calc(var(--chakra-spacing-2) + env(safe-area-inset-bottom, 0px))",
        md: "3",
      }}
      overflowX={{ base: "auto", md: "visible" }}
      justifyContent={{ base: "space-between", md: "flex-start" }}
    >
      <Flex
        direction={{ base: "row", md: "column" }}
        gap={{ base: "1", md: "2" }}
        align={{ base: "center", md: "stretch" }}
        flex={{ md: "1" }}
        width={{ md: "full" }}
      >
        {items.map((item) => (
          <RailSlot key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </Flex>

      <Flex direction={{ base: "row", md: "column" }} gap="2" align="center" width={{ md: "full" }}>
        {footer}
        <SignOutSlot />
      </Flex>
    </Flex>
  );
}

/**
 * The shared shell of a slot: silhouette over a word, in a notched square.
 *
 * The active state is marked three ways — filled, outlined, and tabbed —
 * because any one of them alone fails somewhere: the fill disappears for a
 * colour-blind reader, the outline is easy to miss at a glance, and the tab
 * does not exist in the phone layout.
 */
function SlotShell({
  icon,
  label,
  active = false,
  children,
}: {
  icon: SpriteName;
  label: string;
  active?: boolean;
  children: (content: ReactNode) => ReactNode;
}) {
  const content = (
    <>
      <PixelIcon name={icon} size={20} />
      <Text
        textStyle="display"
        fontSize="3xs"
        lineHeight="1"
        letterSpacing="0.02em"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
    </>
  );

  return (
    <Box position="relative" flexShrink="0" width={{ base: "auto", md: "full" }}>
      <Flex
        asChild
        direction="column"
        width={{ base: PHONE_SLOT_WIDTH, md: "full" }}
        height={SLOT_HEIGHT}
        paddingX={{ md: "3" }}
        gap="1"
        align="center"
        justify="center"
        // Edge and fill in one element. The inset ring this replaces was clipped
        // away at every corner by the notch, so each slot's diagonal steps were
        // drawn in no colour at all.
        {...pixelSkin(
          active ? "var(--amb-colors-border-emphasized)" : "var(--amb-colors-border-muted)",
          active ? "var(--amb-colors-accent-solid)" : "var(--amb-colors-bg-canvas)",
          3,
        )}
        color={active ? "accent.contrast" : "fg.muted"}
        cursor="pointer"
        _hover={
          active
            ? undefined
            : { color: "fg.default", _before: { background: "var(--amb-colors-bg-subtle)" } }
        }
        // The notch clips the global outline away, so focus recolours the edge.
        _focusWithin={{ background: "var(--amb-colors-accent-solid)" }}
      >
        {children(content)}
      </Flex>

      {active ? (
        <Box
          aria-hidden
          display={{ base: "none", md: "block" }}
          position="absolute"
          insetEnd="-16px"
          top="22px"
          width="8px"
          height="12px"
          bg="accent.solid"
        />
      ) : null}
    </Box>
  );
}

function RailSlot({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SlotShell icon={item.icon} label={item.label} active={active}>
      {(content) => (
        <NextLink href={item.href} aria-current={active ? "page" : undefined}>
          {content}
        </NextLink>
      )}
    </SlotShell>
  );
}

/**
 * Signing out, in the open.
 *
 * It used to hide inside the account menu, which made the most consequential
 * control on the page the hardest one to find. It is a slot like any other
 * now, and the confirmation is what keeps a stray click cheap — signing out
 * ends the session for this account everywhere.
 */
function SignOutSlot() {
  const { logout, isLoggingOut } = useSession();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <SlotShell icon="power" label="Log out">
        {(content) => (
          <chakra.button type="button" onClick={() => setConfirming(true)}>
            {content}
          </chakra.button>
        )}
      </SlotShell>

      <ConfirmDialog
        open={confirming}
        title="Log out"
        description="This ends the session for your account. Any unsaved work on this screen is lost."
        confirmLabel="Log out"
        destructive
        loading={isLoggingOut}
        onConfirm={() => void logout()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
