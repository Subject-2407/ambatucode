import { z } from "zod";
import {
  COMPARISON_MODES,
  EXECUTION_MODES,
  EXIT_POLICIES,
  FOCUS_LOSS_ACTIONS,
  GRADING_STRATEGIES,
  LANGUAGES,
  TEST_CASE_KINDS,
  TIME_MODES,
  type AssessmentSessionStatus,
  type AttemptStatus,
  type ComparisonMode,
  type ExecutionMode,
  type ExitPolicy,
  type GradingStrategy,
  type Language,
  type TestCaseKind,
  type TimeMode,
} from "../enums";
import { starterCodeMapSchema, utf8ByteLength, type StarterCodeMap } from "./content";
import type { TestScriptView } from "./test-scripts";

/**
 * Assessment authoring: the Assessment itself, its test cases, and its custom
 * test scripts.
 *
 * Hidden test cases and every byte of a test script are Architect-only. They
 * have types here because the Architect editor needs them — which is exactly
 * why the Coder-facing views below are separate types built from an allowlist,
 * rather than the same type with fields left empty.
 */

// --- Anti-cheat -------------------------------------------------------------

/**
 * Parsed with defaults on the way out of the database as well as on the way in:
 * the column defaults to `{}`, and an Assessment written before a field existed
 * must read as "that control is off" rather than as a malformed row.
 */
export const antiCheatConfigSchema = z.object({
  blockClipboard: z.boolean().default(false),
  blockContextMenu: z.boolean().default(false),
  detectFocusLoss: z.boolean().default(false),
  focusLossAction: z.enum(FOCUS_LOSS_ACTIONS).default("LOG_ONLY"),
  /** Focus losses tolerated before the action fires. 0 fires on the first. */
  focusLossThreshold: z.number().int().min(0).max(100).default(0),
  hideLeaderboard: z.boolean().default(false),
});
export type AntiCheatConfig = z.infer<typeof antiCheatConfigSchema>;

// --- Assessment -------------------------------------------------------------

export const ASSESSMENT_DURATION_MINUTES = { min: 1, max: 600 } as const;

export const durationMinutesSchema = z
  .number()
  .int()
  .min(ASSESSMENT_DURATION_MINUTES.min)
  .max(ASSESSMENT_DURATION_MINUTES.max);

const languagesSchema = z
  .array(z.enum(LANGUAGES))
  .min(1)
  .max(LANGUAGES.length)
  .refine((values) => new Set(values).size === values.length, {
    message: "Languages must be unique",
  });

export type AssessmentTimingFields = {
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
};

/**
 * The one cross-field rule of an Assessment's timing, as a pure check.
 *
 * Exported rather than buried in a refinement because a patch has to be
 * checked against the Assessment as it will be after the patch — switching to
 * TIMED and supplying a duration in one request has to agree with itself — and
 * that merge happens in the service, not in a schema.
 */
export function timingProblem(fields: AssessmentTimingFields): string | null {
  if (fields.timeMode === "TIMED") {
    if (fields.durationMinutes === null) return "A timed assessment needs a duration";
    if (fields.executionMode === null) return "A timed assessment needs an execution mode";
    return null;
  }
  if (fields.durationMinutes !== null || fields.executionMode !== null) {
    return "An untimed assessment has no duration and no execution mode";
  }
  return null;
}

/**
 * Open access and a Live execution mode are mutually exclusive.
 *
 * Live means one global clock that an Architect starts, and every participant
 * shares its deadline. There is no coherent way for a Coder to walk into that
 * whenever they feel like it, so the combination is refused at the boundary
 * rather than half-honoured later.
 */
export function openAccessProblem(fields: {
  isOpenAccess: boolean;
  executionMode: ExecutionMode | null;
}): string | null {
  if (fields.isOpenAccess && fields.executionMode === "LIVE") {
    return "A live assessment cannot be open access: its timer is started by an Architect";
  }
  return null;
}

/**
 * The problem statement is prose, not a rich text document. Interactive Blocks
 * belong to Materials alone, and a plain string cannot carry one — the rule is
 * enforced by the shape of the field rather than by a tree walk.
 */
const assessmentShape = {
  title: z.string().trim().min(1).max(160),
  problemStatement: z.string().trim().min(1).max(100_000),
  allowedLanguages: languagesSchema,
  starterCode: starterCodeMapSchema,
  timeMode: z.enum(TIME_MODES),
  durationMinutes: durationMinutesSchema.nullable(),
  executionMode: z.enum(EXECUTION_MODES).nullable(),
  timeLimitMs: z.number().int().min(100).max(60_000),
  memoryLimitMb: z.number().int().min(16).max(2_048),
  gradingStrategy: z.enum(GRADING_STRATEGIES),
  /**
   * What the workspace's exit control does. A take-home exercise wants RESUME;
   * a supervised exam may want leaving to count as handing in, or to offer no
   * way out at all. See EXIT_POLICIES.
   */
  exitPolicy: z.enum(EXIT_POLICIES),
  antiCheat: antiCheatConfigSchema,
  isPublished: z.boolean(),
  /**
   * Open access: any Coder enrolled in the Module may start this Assessment
   * whenever they like, without an Architect scheduling a session for them.
   *
   * It is refused for Live mode. A Live session is one shared clock started by
   * a person, and "whenever you like" has no meaning against it.
   */
  isOpenAccess: z.boolean(),
};

export const createAssessmentRequestSchema = z
  .object({
    ...assessmentShape,
    starterCode: assessmentShape.starterCode.default({}),
    timeMode: assessmentShape.timeMode.default("UNTIMED"),
    durationMinutes: assessmentShape.durationMinutes.default(null),
    executionMode: assessmentShape.executionMode.default(null),
    timeLimitMs: assessmentShape.timeLimitMs.default(5_000),
    memoryLimitMb: assessmentShape.memoryLimitMb.default(256),
    gradingStrategy: assessmentShape.gradingStrategy.default("WEIGHTED_AVERAGE"),
    exitPolicy: assessmentShape.exitPolicy.default("RESUME"),
    antiCheat: assessmentShape.antiCheat.default(antiCheatConfigSchema.parse({})),
    isPublished: assessmentShape.isPublished.default(false),
    isOpenAccess: assessmentShape.isOpenAccess.default(false),
  })
  .superRefine((value, context) => {
    const problem = timingProblem(value);
    if (problem) context.addIssue({ code: "custom", message: problem, path: ["timeMode"] });
    const openAccess = openAccessProblem(value);
    if (openAccess) {
      context.addIssue({ code: "custom", message: openAccess, path: ["isOpenAccess"] });
    }
  });
export type CreateAssessmentRequest = z.infer<typeof createAssessmentRequestSchema>;

/** No defaults: applied to a patch they would silently rewrite untouched fields. */
export const updateAssessmentRequestSchema = z
  .object(assessmentShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateAssessmentRequest = z.infer<typeof updateAssessmentRequestSchema>;

// --- Test cases -------------------------------------------------------------

/** Every case travels inside a job payload, so its size is bounded here. */
export const MAX_TEST_CASE_IO_BYTES = 64 * 1024;
export const MAX_TEST_CASES_PER_ASSESSMENT = 100;

function boundedIo(field: string) {
  return z.string().refine((value) => utf8ByteLength(value) <= MAX_TEST_CASE_IO_BYTES, {
    message: `${field} must be at most ${MAX_TEST_CASE_IO_BYTES / 1024} KiB`,
  });
}

const testCaseShape = {
  name: z.string().trim().min(1).max(160),
  kind: z.enum(TEST_CASE_KINDS),
  input: boundedIo("Input"),
  expectedOutput: boundedIo("Expected output"),
  weight: z.number().int().min(0).max(1_000),
  comparison: z.enum(COMPARISON_MODES),
  /** Per-case overrides; null falls back to the Assessment's limits. */
  timeLimitMs: z.number().int().min(100).max(60_000).nullable(),
  memoryLimitMb: z.number().int().min(16).max(2_048).nullable(),
};

/** HIDDEN by default: exposing a case to Coders should be a deliberate choice. */
export const createTestCaseRequestSchema = z.object({
  ...testCaseShape,
  kind: testCaseShape.kind.default("HIDDEN"),
  weight: testCaseShape.weight.default(1),
  comparison: testCaseShape.comparison.default("TRIMMED"),
  timeLimitMs: testCaseShape.timeLimitMs.default(null),
  memoryLimitMb: testCaseShape.memoryLimitMb.default(null),
});
export type CreateTestCaseRequest = z.infer<typeof createTestCaseRequestSchema>;

export const updateTestCaseRequestSchema = z
  .object(testCaseShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateTestCaseRequest = z.infer<typeof updateTestCaseRequestSchema>;

// --- Views ------------------------------------------------------------------

/** How an Assessment appears in a Module tree or a Section listing. */
export type AssessmentSummary = {
  id: string;
  sectionId: string;
  title: string;
  orderIndex: number;
  isPublished: boolean;
  /** Startable by any enrolled Coder at any time, with no session scheduled. */
  isOpenAccess: boolean;
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
};

export type TestCaseView = {
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

/** The full definition, for the owning Architect only. */
export type AssessmentArchitectView = AssessmentSummary & {
  moduleId: string;
  problemStatement: string;
  allowedLanguages: Language[];
  starterCode: StarterCodeMap;
  timeLimitMs: number;
  memoryLimitMb: number;
  gradingStrategy: GradingStrategy;
  exitPolicy: ExitPolicy;
  antiCheat: AntiCheatConfig;
  testCases: TestCaseView[];
  testScripts: TestScriptView[];
  /** Architect-only: what the test scripts are validated against, by language. */
  referenceSolutions: StarterCodeMap;
  /**
   * The implicit session an open-access Assessment is sat in, if it is open.
   *
   * It is not in the session list — there is nothing about it to schedule,
   * start or end — but the Architect still needs its monitor, which is where
   * the Coders taking it right now, and their code, can be seen.
   */
  openAccessSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A public sample case as a Coder sees it. No id and no weight: a sample shows
 * what a correct program does, and nothing about how it is graded.
 */
export type SampleCaseView = {
  name: string;
  input: string;
  expectedOutput: string;
};

/**
 * Everything the attempt workspace renders. There is no hidden case, no
 * script, and no grading strategy in this type to forget to strip.
 */
export type AssessmentWorkspaceView = {
  id: string;
  moduleId: string;
  sectionId: string;
  title: string;
  problemStatement: string;
  allowedLanguages: Language[];
  starterCode: StarterCodeMap;
  timeLimitMs: number;
  memoryLimitMb: number;
  antiCheat: AntiCheatConfig;
  /** The workspace reads this to decide what, if anything, its exit does. */
  exitPolicy: ExitPolicy;
  sampleCases: SampleCaseView[];
};

/** A session a Coder can see, with where they stand in it. */
export type CoderSessionEntry = {
  id: string;
  name: string;
  status: AssessmentSessionStatus;
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  endsAt: string | null;
  attempt: { id: string; attemptNumber: number; status: AttemptStatus } | null;
  /** True when pressing Start would begin or resume an attempt. */
  canStart: boolean;
  /**
   * The implicit session behind an open-access Assessment. A Coder is shown
   * one Start button for it rather than a scheduled session's card, because
   * there is no schedule to describe.
   */
  isOpenAccess: boolean;
  /** Open to every enrolled Coder, rather than to a list the Architect wrote. */
  openToModule: boolean;
  /**
   * A retake the Architect opened after this session had ended, waiting for
   * this Coder alone. The session shows as Ended and is, for everyone else —
   * so the card has to say why there is a Start button on a finished exam.
   */
  isGrantedRetake: boolean;
  /** When the session stops accepting work, for a session that has a limit. */
  closesAt: string | null;
  /** Readiness holds this session's Start until everyone listed has said so. */
  requireAllReady: boolean;
  /**
   * True when the Architect named this Coder on the participant list.
   *
   * Readiness is counted over that list alone, so only a listed Coder has a
   * readiness to declare — one who walked into an open session would be
   * toggling a switch the board does not read.
   */
  isListed: boolean;
};

export type AssessmentCoderView = AssessmentWorkspaceView & {
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
  sessions: CoderSessionEntry[];
};

/**
 * `GET /api/assessments/[assessmentId]` answers with one of two shapes, and
 * says which. The owning Architect gets the definition; everyone else who may
 * see it gets the Coder view. The discriminant keeps a screen from ever
 * guessing which one it holds by probing for fields.
 */
export type AssessmentDetailResponse =
  | { view: "ARCHITECT"; assessment: AssessmentArchitectView }
  | { view: "CODER"; assessment: AssessmentCoderView };
