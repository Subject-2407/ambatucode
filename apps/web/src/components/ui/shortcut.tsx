"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import { HStack, Kbd, Portal, Text, Tooltip } from "@chakra-ui/react";

/**
 * Keyboard shortcuts, made visible.
 *
 * Run and Submit have had chords since the first workspace, and nothing on
 * screen ever said so — a shortcut a Coder has to be told about in a lab
 * briefing is one most of them never use.
 */

/** A chord as the platform spells it. `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export type ShortcutKey = "mod" | "shift" | "enter";

const noop = () => () => undefined;

/**
 * Read once, after hydration. The server has no platform to ask, so it renders
 * "Ctrl"; a Mac corrects that on the first client render rather than the two
 * renders disagreeing about the markup.
 */
function useIsMac(): boolean {
  return useSyncExternalStore(
    noop,
    () => /mac|iphone|ipad/i.test(navigator.userAgent),
    () => false,
  );
}

function keyLabel(key: ShortcutKey, mac: boolean): string {
  switch (key) {
    case "mod":
      return mac ? "⌘" : "Ctrl";
    case "shift":
      return mac ? "⇧" : "Shift";
    case "enter":
      return "Enter";
  }
}

/** The chord as `aria-keyshortcuts` wants it, so assistive technology can announce it. */
export function ariaShortcut(keys: readonly ShortcutKey[]): string {
  return keys
    .map((key) => (key === "mod" ? "Control" : key === "shift" ? "Shift" : "Enter"))
    .join("+");
}

export function ShortcutKeys({ keys }: { keys: readonly ShortcutKey[] }) {
  const mac = useIsMac();
  return (
    <HStack gap="1" as="span">
      {keys.map((key) => (
        <Kbd key={key} size="sm">
          {keyLabel(key, mac)}
        </Kbd>
      ))}
    </HStack>
  );
}

/** A control with its shortcut in a tooltip. The child must accept a ref. */
export function WithShortcut({
  label,
  keys,
  children,
}: {
  label: string;
  keys: readonly ShortcutKey[];
  children: ReactElement;
}) {
  return (
    <Tooltip.Root openDelay={300} closeDelay={0} positioning={{ placement: "bottom" }}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content>
            <HStack gap="2">
              <Text fontSize="xs">{label}</Text>
              <ShortcutKeys keys={keys} />
            </HStack>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
