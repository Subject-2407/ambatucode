import { z } from "zod";
import {
  COMPARISON_MODES,
  LANGUAGES,
  SUBMISSION_STATUSES,
  TEST_RESULT_STATUSES,
  TEST_SCRIPT_FRAMEWORKS,
} from "../enums";

/**
 * The wire contract between the queue producer (apps/web) and the Go worker.
 * `apps/worker/internal/contract` mirrors these shapes — changing either side
 * without the other is a breaking change and must happen in one commit.
 *
 * A job payload carries no session cookie, no user id, and no personal data.
 * The only credential it holds is `callbackToken`, a short-lived HMAC over the
 * job id that the worker echoes back on result ingest.
 */

/**
 * Wire format version, carried on every job and every result.
 *
 * The producer and the worker are separate processes on separate release
 * cycles, so a deploy can leave an old worker draining a queue that now holds
 * a new payload shape. Without this field a renamed or dropped field surfaces
 * as a silently mis-graded submission; with it, both sides reject the message
 * outright and say why.
 *
 * Bump it whenever a field is added, removed, renamed, or changes meaning, and
 * update `apps/worker/internal/contract` in the same commit.
 */
export const EXECUTION_CONTRACT_VERSION = 3;

export const executionKindSchema = z.enum(["RUN", "SUBMIT"]);
export type ExecutionKind = z.infer<typeof executionKindSchema>;

export const executionLimitsSchema = z.object({
  compileTimeoutMs: z.number().int().positive(),
  runTimeoutMs: z.number().int().positive(),
  wallTimeoutMs: z.number().int().positive(),
  memoryLimitMb: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  maxProcesses: z.number().int().positive(),
});
export type ExecutionLimits = z.infer<typeof executionLimitsSchema>;

export const executionTestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  input: z.string(),
  expectedOutput: z.string(),
  weight: z.number().nonnegative(),
  isPublic: z.boolean(),
  comparison: z.enum(COMPARISON_MODES),
  /** Overrides `limits.runTimeoutMs` for this case alone. */
  timeLimitMs: z.number().int().positive().nullable(),
  /** Overrides `limits.memoryLimitMb` for this case alone. */
  memoryLimitMb: z.number().int().positive().nullable(),
});
export type ExecutionTestCase = z.infer<typeof executionTestCaseSchema>;

/**
 * One Architect-authored test file. A job may carry several; the worker runs
 * each in a container of its own and attributes every test it reports back to
 * the script's id.
 */
export const executionTestScriptSchema = z.object({
  id: z.string().min(1),
  framework: z.enum(TEST_SCRIPT_FRAMEWORKS),
  /** Where the file is written in the workspace, and what the framework runs. */
  path: z.string().min(1),
  content: z.string(),
  /** The weight every test the script reports is given, like a test case's. */
  weight: z.number().nonnegative(),
});
export type ExecutionTestScript = z.infer<typeof executionTestScriptSchema>;

export const executionJobSchema = z.object({
  contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  jobId: z.string().min(1),
  kind: executionKindSchema,
  submissionId: z.string().min(1).nullable(),
  language: z.enum(LANGUAGES),
  sourceCode: z.string(),
  limits: executionLimitsSchema,
  testCases: z.array(executionTestCaseSchema),
  testScripts: z
    .array(executionTestScriptSchema)
    .refine((scripts) => new Set(scripts.map((script) => script.id)).size === scripts.length, {
      message: "Test script ids must be unique",
    }),
  callbackToken: z.string().min(1),
});
export type ExecutionJob = z.infer<typeof executionJobSchema>;

/**
 * One test case or one script test.
 *
 * `status` is how that case alone ended. A case that ran past its limit is a
 * failed case, not the end of the job: the remaining cases still run, and the
 * submission's own status is the most severe of its cases.
 */
export const executionTestResultSchema = z.object({
  testCaseId: z.string().min(1).nullable(),
  /** The script a script test came from; null for a stdin/stdout case. */
  testScriptId: z.string().min(1).nullable(),
  name: z.string(),
  status: z.enum(TEST_RESULT_STATUSES),
  passed: z.boolean(),
  weight: z.number().nonnegative(),
  executionTimeMs: z.number().nonnegative(),
  memoryUsedKb: z.number().nonnegative().nullable(),
  stdoutExcerpt: z.string(),
  stderrExcerpt: z.string(),
});
export type ExecutionTestResult = z.infer<typeof executionTestResultSchema>;

export const executionResultSchema = z.object({
  contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  jobId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
  status: z.enum(SUBMISSION_STATUSES),
  compilerOutput: z.string().nullable(),
  systemError: z.string().nullable(),
  executionTimeMs: z.number().nonnegative(),
  memoryUsedKb: z.number().nonnegative().nullable(),
  testResults: z.array(executionTestResultSchema),
});
export type ExecutionResult = z.infer<typeof executionResultSchema>;

/** Applied when an Assessment or Practice Activity leaves a limit unset. */
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  compileTimeoutMs: 15_000,
  runTimeoutMs: 5_000,
  wallTimeoutMs: 30_000,
  memoryLimitMb: 256,
  maxOutputBytes: 65_536,
  maxProcesses: 64,
};
