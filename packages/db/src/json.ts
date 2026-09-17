import type { Prisma } from "@prisma/client";

/**
 * Narrows a validated value to Prisma's Json input type.
 *
 * Prisma's `InputJsonValue` requires an index signature, which a Zod-inferred
 * document type does not carry even though it is structurally JSON. The values
 * passed here have already been parsed by the schema that owns the column, so
 * this is the one place that mismatch is bridged — rather than a cast scattered
 * across every service that writes a Json column.
 */
export function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
