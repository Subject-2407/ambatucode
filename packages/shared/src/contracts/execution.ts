import { z } from "zod";
import { COMPARISON_MODES, LANGUAGES, SUBMISSION_STATUSES, TEST_SCRIPT_FRAMEWORKS } from "../enums";

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
export const EXECUTION_CONTRACT_VERSION = 1;

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
});
export type ExecutionTestCase = z.infer<typeof executionTestCaseSchema>;

export const executionTestScriptSchema = z.object({
  framework: z.enum(TEST_SCRIPT_FRAMEWORKS),
  entrypoint: z.string().min(1),
  files: z.array(z.object({ path: z.string().min(1), content: z.string() })),
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
  testScript: executionTestScriptSchema.nullable(),
  callbackToken: z.string().min(1),
});
export type ExecutionJob = z.infer<typeof executionJobSchema>;

export const executionTestResultSchema = z.object({
  testCaseId: z.string().min(1).nullable(),
  name: z.string(),
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
