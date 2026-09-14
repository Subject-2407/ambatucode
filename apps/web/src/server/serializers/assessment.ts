import "server-only";
import { z } from "zod";
import { toValidationView } from "./test-script-validation";
import {
  AppError,
  antiCheatConfigSchema,
  attemptRemainingMs,
  attemptDeadlineMs,
  isLanguage,
  starterCodeMapSchema,
  type AntiCheatConfig,
  type AssessmentArchitectView,
  type AssessmentEventType,
  type AssessmentSessionStatus,
  type AssessmentSummary,
  type AssessmentWorkspaceView,
  type AttemptClock,
  type AttemptStatus,
  type AttemptView,
  type ComparisonMode,
  type ExecutionMode,
  type GradingStrategy,
  type Language,
  type MonitorEventPayload,
  type ParticipantView,
  type SessionView,
  type StarterCodeMap,
  type SubmissionArchitectView,
  type SubmissionCoderView,
  type SubmissionStatus,
  type SubmissionSummary,
  type TestCaseKind,
  type TestCaseView,
  type TestScriptFramework,
  type TestResultStatus,
  type TestScriptValidationStatus,
  type TestScriptView,
  type TimeMode,
  TEST_RESULT_STATUSES,
} from "@ambatucode/shared";

/**
 * Row-to-response translation for assessments, sessions, attempts, and
 * submissions.
 *
 * Every Coder-facing function here builds its output from an explicit list of
 * fields. Nothing is spread from a row, because the rows carry hidden cases,
 * scripts, expected outputs, and system errors, and a spread is how one of
 * those would reach a browser the day someone widens a `select`.
 */

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** A stored language that is no longer in the vocabulary is corruption, not input. */
function storedLanguage(value: string): Language {
  if (!isLanguage(value)) {
    throw new AppError("INTERNAL", `Stored language "${value}" is not a known language`);
  }
  return value;
}

function storedLanguages(values: string[]): Language[] {
  return values.map(storedLanguage);
}

function parseStored<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  column: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("INTERNAL", `Stored ${column} is malformed`);
  }
  return parsed.data;
}

export function readAntiCheat(value: unknown): AntiCheatConfig {
  return parseStored(antiCheatConfigSchema, value, "Assessment.antiCheatConfigJson");
}

function readStarterCode(value: unknown): StarterCodeMap {
  return parseStored(starterCodeMapSchema, value, "Assessment.starterCodeJson");
}

const storedScriptFilesSchema = z.array(z.object({ path: z.string(), content: z.string() }));

/**
 * The one file a script is. `filesJson` predates single-file scripts and
 * stays a list, so the file is found by the entrypoint that names it.
 */
export function readScriptContent(row: { entrypoint: string; filesJson: unknown }): string {
  const files = parseStored(
    storedScriptFilesSchema,
    row.filesJson,
    "AssessmentTestScript.filesJson",
  );
  const file = files.find((candidate) => candidate.path === row.entrypoint);
  if (file === undefined) {
    throw new AppError("INTERNAL", "Stored AssessmentTestScript has no file at its entrypoint");
  }
  return file.content;
}

/** Same shape as starter code: a source per language. Architect-only. */
export function readReferenceSolutions(value: unknown, model: string): StarterCodeMap {
  return parseStored(starterCodeMapSchema, value, `${model}.referenceSolutionsJson`);
}

// --- Assessment ---------------------------------------------------------------

type AssessmentSummaryRow = {
  id: string;
  sectionId: string;
  title: string;
  orderIndex: number;
  isPublished: boolean;
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
};

export function toAssessmentSummary(row: AssessmentSummaryRow): AssessmentSummary {
  return {
    id: row.id,
    sectionId: row.sectionId,
    title: row.title,
    orderIndex: row.orderIndex,
    isPublished: row.isPublished,
    timeMode: row.timeMode,
    durationMinutes: row.durationMinutes,
    executionMode: row.executionMode,
  };
}

export type TestCaseRow = {
  id: string;
  assessmentId: string;
  name: string;
  orderIndex: number;
  kind: TestCaseKind;
  input: string;
  expectedOutput: string;
  weight: number;
  comparison: ComparisonMode;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
};

export function toTestCaseView(row: TestCaseRow): TestCaseView {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    name: row.name,
    orderIndex: row.orderIndex,
    kind: row.kind,
    input: row.input,
    expectedOutput: row.expectedOutput,
    weight: row.weight,
    comparison: row.comparison,
    timeLimitMs: row.timeLimitMs,
    memoryLimitMb: row.memoryLimitMb,
  };
}

export type TestScriptRow = {
  id: string;
  assessmentId: string;
  language: string;
  framework: TestScriptFramework;
  entrypoint: string;
  filesJson: unknown;
  weight: number;
  validationStatus: TestScriptValidationStatus;
  validationSummary: string | null;
  validationChangedAt: Date | null;
  updatedAt: Date;
};

export function toTestScriptView(row: TestScriptRow): TestScriptView {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    language: storedLanguage(row.language),
    framework: row.framework,
    path: row.entrypoint,
    content: readScriptContent(row),
    weight: row.weight,
    validation: toValidationView(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type AssessmentRow = AssessmentSummaryRow & {
  problemStatement: string;
  allowedLanguages: string[];
  starterCodeJson: unknown;
  timeLimitMs: number;
  memoryLimitMb: number;
  gradingStrategy: GradingStrategy;
  antiCheatConfigJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  section: { moduleId: string };
};

export function toAssessmentArchitectView(
  row: AssessmentRow & {
    testCases: TestCaseRow[];
    testScripts: TestScriptRow[];
    referenceSolutionsJson: unknown;
  },
): AssessmentArchitectView {
  return {
    ...toAssessmentSummary(row),
    moduleId: row.section.moduleId,
    problemStatement: row.problemStatement,
    allowedLanguages: storedLanguages(row.allowedLanguages),
    starterCode: readStarterCode(row.starterCodeJson),
    timeLimitMs: row.timeLimitMs,
    memoryLimitMb: row.memoryLimitMb,
    gradingStrategy: row.gradingStrategy,
    antiCheat: readAntiCheat(row.antiCheatConfigJson),
    testCases: row.testCases.map(toTestCaseView),
    testScripts: row.testScripts.map(toTestScriptView),
    referenceSolutions: readReferenceSolutions(row.referenceSolutionsJson, "Assessment"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The workspace view. Test cases are filtered to PUBLIC here, by kind, before
 * a single field is copied — and only name, input, and expected output survive
 * even for those.
 */
export function toAssessmentWorkspaceView(
  row: AssessmentRow & {
    testCases: Array<Pick<TestCaseRow, "kind" | "name" | "input" | "expectedOutput">>;
  },
): AssessmentWorkspaceView {
  return {
    id: row.id,
    moduleId: row.section.moduleId,
    sectionId: row.sectionId,
    title: row.title,
    problemStatement: row.problemStatement,
    allowedLanguages: storedLanguages(row.allowedLanguages),
    starterCode: readStarterCode(row.starterCodeJson),
    timeLimitMs: row.timeLimitMs,
    memoryLimitMb: row.memoryLimitMb,
    antiCheat: readAntiCheat(row.antiCheatConfigJson),
    sampleCases: row.testCases
      .filter((testCase) => testCase.kind === "PUBLIC")
      .map((testCase) => ({
        name: testCase.name,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
      })),
  };
}

// --- Session ------------------------------------------------------------------

export type SessionRow = {
  id: string;
  assessmentId: string;
  name: string;
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  status: AssessmentSessionStatus;
  startedAt: Date | null;
  endsAt: Date | null;
  startedWithMissingParticipants: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toSessionView(
  row: SessionRow,
  context: { moduleId: string; listedParticipantCount: number },
): SessionView {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    moduleId: context.moduleId,
    name: row.name,
    executionMode: row.executionMode,
    durationMinutes: row.durationMinutes,
    status: row.status,
    startedAt: iso(row.startedAt),
    endsAt: iso(row.endsAt),
    startedWithMissingParticipants: row.startedWithMissingParticipants,
    listedParticipantCount: context.listedParticipantCount,
    isRestricted: context.listedParticipantCount > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ParticipantRow = {
  userId: string;
  isListed: boolean;
  readyState: ParticipantView["readyState"];
  connectionState: ParticipantView["connectionState"];
  lastSeenAt: Date | null;
  user: { username: string; displayName: string };
};

export function toParticipantView(row: ParticipantRow): ParticipantView {
  return {
    userId: row.userId,
    username: row.user.username,
    displayName: row.user.displayName,
    isListed: row.isListed,
    readyState: row.readyState,
    connectionState: row.connectionState,
    lastSeenAt: iso(row.lastSeenAt),
  };
}

// --- Events -------------------------------------------------------------------

export type EventRow = {
  id: string;
  sessionId: string;
  userId: string | null;
  attemptId: string | null;
  type: AssessmentEventType;
  durationMs: number | null;
  occurredAt: Date;
  payloadJson: unknown;
};

const eventPayloadSchema = z.record(z.string(), z.unknown());

export function toMonitorEventPayload(row: EventRow): MonitorEventPayload {
  const payload = eventPayloadSchema.safeParse(row.payloadJson);
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    attemptId: row.attemptId,
    type: row.type,
    durationMs: row.durationMs,
    occurredAt: row.occurredAt.getTime(),
    payload: payload.success ? payload.data : {},
  };
}

// --- Attempt ------------------------------------------------------------------

export type AttemptClockRow = {
  individualDeadlineAt: Date | null;
  pausedAt: Date | null;
  consumedMs: number;
};

export type SessionTimingRow = {
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  endsAt: Date | null;
};

export function clockFor(attempt: AttemptClockRow, session: SessionTimingRow): AttemptClock {
  return {
    executionMode: session.executionMode,
    durationMinutes: session.durationMinutes,
    endsAtMs: session.endsAt?.getTime() ?? null,
    individualDeadlineAtMs: attempt.individualDeadlineAt?.getTime() ?? null,
    pausedAtMs: attempt.pausedAt?.getTime() ?? null,
    consumedMs: attempt.consumedMs,
  };
}

export type SubmissionSummaryRow = {
  id: string;
  attemptId: string;
  status: SubmissionStatus;
  score: number | null;
  language: string;
  isAutoSubmitted: boolean;
  submittedAt: Date;
  gradedAt: Date | null;
};

export function toSubmissionSummary(row: SubmissionSummaryRow): SubmissionSummary {
  return {
    id: row.id,
    attemptId: row.attemptId,
    status: row.status,
    score: row.score,
    language: storedLanguage(row.language),
    isAutoSubmitted: row.isAutoSubmitted,
    submittedAt: row.submittedAt.toISOString(),
    gradedAt: iso(row.gradedAt),
  };
}

export type AttemptRow = AttemptClockRow & {
  id: string;
  sessionId: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: Date | null;
  draft: { language: string; sourceCode: string; savedAt: Date } | null;
};

export function toAttemptView(input: {
  attempt: AttemptRow;
  session: SessionTimingRow;
  submission: SubmissionSummaryRow | null;
  assessment: AssessmentWorkspaceView;
  nowMs: number;
}): AttemptView {
  const { attempt, session, nowMs } = input;
  const clock = clockFor(attempt, session);
  const active = attempt.status === "IN_PROGRESS";
  return {
    id: attempt.id,
    sessionId: attempt.sessionId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    executionMode: session.executionMode,
    durationMinutes: session.durationMinutes,
    startedAt: iso(attempt.startedAt),
    // A closed attempt has no clock worth drawing.
    deadlineMs: active ? attemptDeadlineMs(clock) : null,
    remainingMs: active ? attemptRemainingMs(clock, nowMs) : null,
    consumedMs: attempt.consumedMs,
    paused: active && attempt.pausedAt !== null,
    serverTimeMs: nowMs,
    draft:
      attempt.draft === null
        ? null
        : {
            language: storedLanguage(attempt.draft.language),
            sourceCode: attempt.draft.sourceCode,
            savedAt: attempt.draft.savedAt.toISOString(),
          },
    submission: input.submission === null ? null : toSubmissionSummary(input.submission),
    assessment: input.assessment,
  };
}

// --- Submission ---------------------------------------------------------------

export type SubmissionResultRow = {
  testCaseId: string | null;
  name: string;
  status: SubmissionStatus | null;
  passed: boolean;
  weight: number;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  isPublic: boolean;
};

export type SubmissionRow = SubmissionSummaryRow & {
  userId: string;
  sessionId: string;
  assessmentId: string;
  sourceCode: string;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
  compilerOutput: string | null;
  systemError: string | null;
  results: SubmissionResultRow[];
};

/**
 * The column shares the submission status enum, but ingest only ever writes a
 * per-case status there. Anything else would be a corrupted row, and reads as
 * "not recorded" rather than a status no case can have.
 */
function toTestResultStatus(status: SubmissionStatus | null): TestResultStatus | null {
  return TEST_RESULT_STATUSES.find((candidate) => candidate === status) ?? null;
}

/**
 * Hidden rows are dropped before anything is copied — not blanked — because
 * their stdout and stderr excerpts can echo the input the case was hiding.
 * `systemError` is never copied: it describes the platform, not the program.
 */
export function toSubmissionCoderView(row: SubmissionRow): SubmissionCoderView {
  return {
    ...toSubmissionSummary(row),
    sourceCode: row.sourceCode,
    executionTimeMs: row.executionTimeMs,
    memoryUsedKb: row.memoryUsedKb,
    compilerOutput: row.compilerOutput,
    testResults: row.results
      .filter((result) => result.isPublic)
      .map((result) => ({
        name: result.name,
        status: toTestResultStatus(result.status),
        passed: result.passed,
        executionTimeMs: result.executionTimeMs,
        stdoutExcerpt: result.stdoutExcerpt,
        stderrExcerpt: result.stderrExcerpt,
      })),
  };
}

export function toSubmissionArchitectView(row: SubmissionRow): SubmissionArchitectView {
  return {
    ...toSubmissionSummary(row),
    userId: row.userId,
    sessionId: row.sessionId,
    assessmentId: row.assessmentId,
    sourceCode: row.sourceCode,
    executionTimeMs: row.executionTimeMs,
    memoryUsedKb: row.memoryUsedKb,
    compilerOutput: row.compilerOutput,
    systemError: row.systemError,
    testResults: row.results.map((result) => ({
      testCaseId: result.testCaseId,
      name: result.name,
      status: toTestResultStatus(result.status),
      passed: result.passed,
      weight: result.weight,
      isPublic: result.isPublic,
      executionTimeMs: result.executionTimeMs,
      memoryUsedKb: result.memoryUsedKb,
      stdoutExcerpt: result.stdoutExcerpt,
      stderrExcerpt: result.stderrExcerpt,
    })),
  };
}
