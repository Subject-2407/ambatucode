"use client";

import { Box, chakra } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { GradeSort, GradeSortOrder } from "@ambatucode/shared";
import { Table } from "@/components/ui/table";

/**
 * A column header that sorts the records by its column.
 *
 * The header itself carries `aria-sort`, because that is where assistive
 * technology looks for it; the button inside only toggles. Every sortable
 * header shows an arrow, faint until it is the one in use, so it is visible
 * which columns can be sorted before anyone tries one.
 */
export function SortableColumnHeader({
  column,
  label,
  hint,
  sort,
  order,
  onSort,
  textAlign,
}: {
  column: GradeSort;
  label: string;
  /** What the column is sorted by, when the label alone does not say. */
  hint?: string;
  sort: GradeSort;
  order: GradeSortOrder;
  onSort: (column: GradeSort) => void;
  textAlign?: "start" | "end";
}) {
  const active = sort === column;
  const Arrow = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;

  return (
    <Table.ColumnHeader
      textAlign={textAlign}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <chakra.button
        type="button"
        onClick={() => onSort(column)}
        title={hint === undefined ? `Sort by ${label.toLowerCase()}` : `Sort ${hint}`}
        display="inline-flex"
        alignItems="center"
        gap="1"
        cursor="pointer"
        textStyle="display"
        fontSize="2xs"
        letterSpacing="inherit"
        textTransform="inherit"
        color={active ? "fg.default" : "inherit"}
        _hover={{ color: "accent.fg" }}
      >
        {label}
        {hint === undefined ? null : <chakra.span srOnly>, {hint}</chakra.span>}
        <Box as="span" aria-hidden opacity={active ? 1 : 0.4} display="inline-flex">
          <Arrow size={12} />
        </Box>
      </chakra.button>
    </Table.ColumnHeader>
  );
}
