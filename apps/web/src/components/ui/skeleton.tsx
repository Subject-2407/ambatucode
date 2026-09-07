"use client";

import { Skeleton, Table } from "@chakra-ui/react";

export { Skeleton } from "@chakra-ui/react";
export type { SkeletonProps } from "@chakra-ui/react";

/**
 * Placeholder rows sized to the table they replace, so a list does not jump
 * when the data lands.
 */
export function TableRowsSkeleton({ rows = 5, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <Table.Row key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Table.Cell key={columnIndex}>
              <Skeleton height="4" width={columnIndex === 0 ? "60%" : "40%"} />
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </>
  );
}
