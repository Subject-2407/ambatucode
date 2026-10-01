import type { AttemptStatus, GradeRecordView } from "@ambatucode/shared";

/**
 * What a grading record says about itself, worked out once so the row and its
 * tests agree.
 */

/**
 * Whether the Architect has a choice to make: a Submission exists, and no
 * attempt is official. A record that has nothing submitted yet has nothing to
 * choose between, and telling the Architect to choose there sends them looking
 * for an option that is not on the screen.
 *
 * The summary strip counts the same rule server-side; see `grades-query.ts`.
 */
export function needsOfficialChoice(
  record: Pick<GradeRecordView, "officialAttemptId" | "attempts">,
): boolean {
  return (
    record.officialAttemptId === null &&
    record.attempts.some((attempt) => attempt.submission !== null)
  );
}

/**
 * The badge for an attempt with no Submission. "No submission" is the honest
 * end state, but a Coder mid-exam has not failed to submit — they have not
 * finished — and reading it that way during a live lab is alarming.
 */
export function unsubmittedAttemptLabel(status: AttemptStatus): string {
  switch (status) {
    case "NOT_STARTED":
      return "Not started";
    case "IN_PROGRESS":
      return "In progress";
    case "SUBMITTED":
    case "EXPIRED":
    case "RESET":
      return "No submission";
  }
}
