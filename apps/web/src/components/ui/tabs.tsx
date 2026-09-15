"use client";

import { Box, Tabs as ChakraTabs, type BoxProps } from "@chakra-ui/react";

export type TabItem = { value: string; label: string; count?: number };

/**
 * The trigger row on its own, for the common case where the panels are not
 * separate DOM subtrees but one view filtered by the active tab.
 *
 * Every trigger names that one view in `aria-controls`, so a screen reader can
 * jump from a tab to what it changed. Render the view inside a `TabPanel` with
 * the same `controls` id; an `aria-controls` pointing at nothing is an invalid
 * ARIA reference, which is what the trigger row alone used to produce.
 */
export function TabBar({
  items,
  value,
  onValueChange,
  controls,
  "aria-label": ariaLabel,
}: {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** The id of the `TabPanel` this row switches. */
  controls: string;
  "aria-label": string;
}) {
  return (
    <ChakraTabs.Root
      value={value}
      onValueChange={(details) => onValueChange(details.value)}
      variant="line"
      colorPalette="accent"
      size="sm"
      ids={{ trigger: (tab) => tabId(controls, tab), content: () => controls }}
    >
      <ChakraTabs.List aria-label={ariaLabel}>
        {items.map((item) => (
          <ChakraTabs.Trigger key={item.value} value={item.value}>
            {item.label}
            {item.count === undefined ? null : ` (${String(item.count)})`}
          </ChakraTabs.Trigger>
        ))}
        <ChakraTabs.Indicator />
      </ChakraTabs.List>
    </ChakraTabs.Root>
  );
}

/**
 * The view a `TabBar` switches, named by the tab currently selected.
 */
export function TabPanel({
  id,
  value,
  children,
  ...rest
}: { id: string; value: string; children: React.ReactNode } & Omit<BoxProps, "id" | "role">) {
  return (
    <Box id={id} role="tabpanel" aria-labelledby={tabId(id, value)} {...rest}>
      {children}
    </Box>
  );
}

function tabId(controls: string, value: string): string {
  return `${controls}-tab-${value}`;
}
