/**
 * Prisma error identification by shape rather than `instanceof`.
 *
 * Next.js loads `@prisma/client` as an external package while transpiling this
 * one, so an error thrown inside the client is not always an instance of the
 * `PrismaClientKnownRequestError` constructor a route handler can see. The
 * `instanceof` check silently fails and a CONFLICT turns into a 500. Every
 * known request error carries both `code` and `clientVersion`, so those are
 * checked instead.
 *
 * Codes: https://www.prisma.io/docs/orm/reference/error-reference
 */
export function getPrismaErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { code?: unknown; clientVersion?: unknown };
  if (typeof candidate.code !== "string") return null;
  if (typeof candidate.clientVersion !== "string") return null;

  return candidate.code;
}

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return getPrismaErrorCode(error) === code;
}

/** P2002 — a unique constraint was violated. */
export const PRISMA_UNIQUE_VIOLATION = "P2002";
/** P2003 — a foreign key constraint would be violated by the write. */
export const PRISMA_FOREIGN_KEY_VIOLATION = "P2003";
/** P2025 — the record required by the operation was not found. */
export const PRISMA_RECORD_NOT_FOUND = "P2025";
