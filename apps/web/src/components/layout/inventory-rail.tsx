"use client";

import { useState, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Text, chakra } from "@chakra-ui/react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import type { SpriteName } from "@/components/ui/pixel-sprites";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  nextColorModePreference,
  useColorMode,
  type ColorModePreference,
} from "@/providers/color-mode";
import { useSession } from "@/providers/session-provider";
import { PIXEL, pixelSkin } from "@/theme/pixel";
import { isNavItemActive, type NavItem } from "./navigation";

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

const SLOT_HEIGHT = "56px";

/**
 * On a phone the slots sit side by side, and each takes its width from its own
 * caption rather than from a fixed number.
 *
 * A fixed 64px was already too narrow for "Submissions": the word ran past the
 * edge and the notch cut off its first and last letters. It was also too wide
 * for the row. Once the theme became a slot, a Coder had six of them, and six
 * at 64px do not fit a 360px phone. Sized to their captions, with 4px between
 * slots and 8px at each end, the Coder's row comes to 358px.
 *
 * On a phone the caption is 8px, which is the face's own size. It is drawn on a
 * grid of eighths of an em, so at 8px every cell is exactly one pixel (three
 * device pixels on a typical phone), where 9px puts each cell at 1.125 pixels
 * and the letters come out uneven. Letter spacing goes to zero for the same
 * reason: every glyph already ends in a blank column.
 *
 * 44px is the floor. It is a comfortable touch target, and it is wider than any
 * of the theme slot's three captions, so that slot keeps one width as it cycles
 * instead of shifting Log out under the reader's thumb.
 */
const PHONE_SLOT_MIN_WIDTH = "44px";

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
          <RailSlot key={item.href} item={item} active={isNavItemActive(pathname, item)} />
        ))}
      </Flex>

      <Flex
        direction={{ base: "row", md: "column" }}
        gap={{ base: "1", md: "2" }}
        align="center"
        width={{ md: "full" }}
      >
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
        // 8px on a phone, the face's native size; the note on the phone slot
        // width explains why. No token is that small, so it is written out.
        fontSize={{ base: "0.5rem", md: "3xs" }}
        lineHeight="1"
        letterSpacing={{ base: "0", md: "0.02em" }}
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
        width={{ base: "auto", md: "full" }}
        minWidth={{ base: PHONE_SLOT_MIN_WIDTH, md: "0" }}
        height={SLOT_HEIGHT}
        // The rail takes its width from the widest caption plus this gutter, so
        // this number is the rail's width. It was a roomy `3`, which bought a
        // column of empty slot on both sides of every label and took the space
        // from the page. `1.5` still clears the longest caption — the labels
        // are `nowrap`, so a gutter too small would show as a clipped word
        // rather than as a narrower rail. On a phone the same rule sizes each
        // slot on its own, and `1` is the 3px edge plus a pixel of air.
        paddingX={{ base: "1", md: "1.5" }}
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
 * What the theme slot shows for each preference. `label` is the one word under
 * the sprite; `name` is how the accessible name says it, and it begins with the
 * same word so the name contains what the slot visibly reads.
 */
const THEME_SLOT: Readonly<
  Record<ColorModePreference, { icon: SpriteName; label: string; name: string }>
> = {
  system: { icon: "contrast", label: "Auto", name: "Auto (follow device)" },
  light: { icon: "sun", label: "Light", name: "Light" },
  dark: { icon: "moon", label: "Dark", name: "Dark" },
};

/**
 * The theme, as a slot like every other control on the rail.
 *
 * It was a small unframed icon button above Log out, the one control on the
 * rail with no notch and no word, so it read as decoration rather than as a
 * setting. It walks the same cycle as `ColorModeToggle`, system to light to
 * dark and back, because a plain light and dark switch has no way to hand the
 * choice back to the device once it has been taken.
 *
 * Sprite and word follow the *preference*, not the mode it resolves to. The
 * slot reports what the reader chose, and "Auto" is a choice: showing a sun
 * under it would say the theme is pinned to light when it is not.
 *
 * That is also why nothing here waits for hydration. The preference comes
 * from the cookie, which the root layout reads on the server and hands to the
 * provider, so the server and the first client render agree on it exactly.
 * Only the resolved mode is unknown until the device has been asked, and this
 * slot never reads it. A click before then is still right, because
 * `setPreference` asks the device itself when the next preference is system.
 */
export function ThemeSlot() {
  const { preference, setPreference } = useColorMode();
  const current = THEME_SLOT[preference];
  const next = nextColorModePreference(preference);
  // What it is and what a click does, spoken and on hover alike. The title is
  // how a mouse reader learns that "Auto" means following the device.
  const description = `Theme: ${current.name}. Switch to ${THEME_SLOT[next].name}`;

  return (
    <SlotShell icon={current.icon} label={current.label}>
      {(content) => (
        <chakra.button
          type="button"
          aria-label={description}
          title={description}
          onClick={() => setPreference(next)}
        >
          {content}
        </chakra.button>
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
