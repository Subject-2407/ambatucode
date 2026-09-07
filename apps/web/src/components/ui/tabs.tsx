"use client";

import { Tabs as ChakraTabs } from "@chakra-ui/react";

export type TabItem = { value: string; label: string; count?: number };

/**
 * The trigger row on its own, for the common case where the panels are not
 * separate DOM subtrees but one view filtered by the active tab.
 */
export function TabBar({
  items,
  value,
  onValueChange,
  "aria-label": ariaLabel,
}: {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  return (
    <ChakraTabs.Root
      value={value}
      onValueChange={(details) => onValueChange(details.value)}
      variant="line"
      colorPalette="accent"
      size="sm"
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
