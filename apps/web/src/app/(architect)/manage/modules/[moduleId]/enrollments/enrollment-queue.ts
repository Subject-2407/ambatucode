import type { EnrollmentDecision, EnrollmentStatus } from "@ambatucode/shared";

/**
 * The approval queue's selection and in-flight bookkeeping, as plain data.
 *
 * A selection belongs to the page it was made on. Rows leave a page as they
 * are decided — an approved request drops out of the Pending tab — so what
 * counts as selected is always read against the rows on screen, never from the
 * set alone, and a ticked row that has gone can never be decided by accident.
 */

type QueueRow = { id: string; status: EnrollmentStatus };

/** The ticked rows that are still on screen, in the order they are shown. */
export function selectedRows<Row extends QueueRow>(
  selected: ReadonlySet<string>,
  rows: readonly Row[],
): Row[] {
  return rows.filter((row) => selected.has(row.id));
}

/** The header checkbox: every row on the page, none, or some. */
export function pageCheckState(
  selected: ReadonlySet<string>,
  rows: readonly QueueRow[],
): boolean | "indeterminate" {
  const ticked = selectedRows(selected, rows).length;
  if (ticked === 0) return false;
  return ticked === rows.length ? true : "indeterminate";
}

export function withSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * The rows a decision would actually change. Approving an approved Coder is a
 * no-op the server skips too, so the button counts only what it will do.
 */
export function changedBy(rows: readonly QueueRow[], status: EnrollmentDecision): string[] {
  return rows.filter((row) => row.status !== status).map((row) => row.id);
}

/** Which decision each row is waiting on, so only that row's button spins. */
export type PendingDecisions = ReadonlyMap<string, EnrollmentDecision>;

export function markPending(
  pending: PendingDecisions,
  ids: readonly string[],
  status: EnrollmentDecision,
): PendingDecisions {
  const next = new Map(pending);
  for (const id of ids) next.set(id, status);
  return next;
}

export function clearPending(pending: PendingDecisions, ids: readonly string[]): PendingDecisions {
  const next = new Map(pending);
  for (const id of ids) next.delete(id);
  return next;
}

/**
 * The page to move to when the one on screen emptied although the queue did
 * not — deciding the last rows of the last page takes them off the Pending tab.
 * Null when the page is fine as it is.
 */
export function pageToRecover(
  page: number,
  served: { items: readonly unknown[]; total: number; pageSize: number },
): number | null {
  if (served.items.length > 0 || served.total === 0) return null;
  const last = Math.max(1, Math.ceil(served.total / served.pageSize));
  return page > last ? last : null;
}
