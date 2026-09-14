import "server-only";
import type { AuthenticatedUser, GradeExportQuery, GradeRecordView } from "@ambatucode/shared";
import { iterateGradeRecords } from "./grades";

/**
 * Grade export.
 *
 * CSV, written UTF-8 with a byte-order mark and CRLF endings, which is what
 * makes Excel open it as a spreadsheet rather than as one column of mojibake.
 * The SRS asks for "a generalized CSV and/or Excel-compatible format" and this
 * is both, with no dependency and nothing to install — which matters for a
 * platform that has to deploy into an offline lab.
 *
 * The file streams. A module's grades are read in batches and each row is
 * pushed as it is built, so exporting a large module costs a bounded amount of
 * memory rather than a copy of every grade in it.
 *
 * One row per attempt, not per Coder. After a reset a record has several
 * attempts and only one of them is official; collapsing that to a single row
 * would throw away exactly the history the reset was designed to preserve.
 */

export const CSV_COLUMNS = [
  "username",
  "display_name",
  "module",
  "section",
  "assessment",
  "session",
  "attempt_number",
  "is_official",
  "attempt_status",
  "submission_status",
  "score",
  "language",
  "submitted_at",
  "execution_time_ms",
  "memory_used_kb",
  "auto_submitted",
  "reset_at",
  "reset_reason",
  "reset_by",
] as const;

/** Characters Excel and Sheets treat as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One CSV field.
 *
 * Quoted unconditionally, which keeps commas, quotes, and newlines in a
 * display name harmless. The leading apostrophe on a formula character is the
 * other half: a Coder named `=cmd|...` is a spreadsheet injection waiting for
 * whoever opens the export, and this is an export of names people chose.
 */
export function csvField(value: string | number | boolean | null): string {
  if (value === null) return '""';
  const text = String(value);
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function csvRow(values: Array<string | number | boolean | null>): string {
  return `${values.map(csvField).join(",")}\r\n`;
}

export function csvRowsFor(record: GradeRecordView): string[] {
  // A record with no attempts cannot reach here, but a Coder listed with no
  // attempt at all would still be worth a line saying exactly that.
  if (record.attempts.length === 0) {
    return [
      csvRow([
        record.username,
        record.displayName,
        record.moduleTitle,
        record.sectionTitle,
        record.assessmentTitle,
        record.sessionName,
        null,
        false,
        "NOT_STARTED",
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        null,
        null,
        null,
      ]),
    ];
  }

  return record.attempts.map((attempt) =>
    csvRow([
      record.username,
      record.displayName,
      record.moduleTitle,
      record.sectionTitle,
      record.assessmentTitle,
      record.sessionName,
      attempt.attemptNumber,
      attempt.isOfficial,
      attempt.status,
      attempt.submission?.status ?? null,
      attempt.submission?.score ?? null,
      attempt.submission?.language ?? null,
      attempt.submission?.submittedAt ?? null,
      attempt.submission?.executionTimeMs ?? null,
      attempt.submission?.memoryUsedKb ?? null,
      attempt.submission?.isAutoSubmitted ?? false,
      attempt.resetAt,
      attempt.resetReason,
      attempt.resetByDisplayName,
    ]),
  );
}

export function gradeExportFilename(moduleSlug: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  // The slug is already URL-safe, but a filename crosses into a header where a
  // quote or a newline would be a response-splitting bug rather than a typo.
  const safe = moduleSlug.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return `grades-${safe}-${stamp}.csv`;
}

/**
 * Streams the export.
 *
 * Authorization happens inside `iterateGradeRecords`, on its first pull — so a
 * caller who is not the owning Architect gets the rejection before a single
 * byte of the body is produced.
 */
export function streamGradeExport(
  actor: AuthenticatedUser,
  moduleId: string,
  query: GradeExportQuery,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const records = iterateGradeRecords(actor, moduleId, { ...query, page: 1, pageSize: 100 });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // The BOM is what tells Excel the file is UTF-8. Without it a display
      // name with an accent in it opens as nonsense.
      controller.enqueue(encoder.encode("﻿"));
      controller.enqueue(encoder.encode(csvRow([...CSV_COLUMNS])));
    },
    async pull(controller) {
      const next = await records.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      for (const line of csvRowsFor(next.value)) {
        controller.enqueue(encoder.encode(line));
      }
    },
    async cancel() {
      // A browser that navigates away mid-download leaves the generator open,
      // and with it the batch query it was about to run.
      await records.return(undefined);
    },
  });
}
