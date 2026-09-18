import "server-only";
import { prisma } from "@ambatucode/db";
import {
  AppError,
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionLimits,
  type ExecutionResult,
  type ExecutionTestResult,
  type ExecutionTestScript,
  type Language,
} from "@ambatucode/shared";
import { z } from "zod";
import { consumeRateLimit } from "../auth/rate-limit";
import { getRedis } from "../redis";
import { enqueueExecutionJob, RUN_OWNER_TTL_SECONDS } from "../queue/producer";

/**
 * Running an Architect's test scripts against their own reference solution.
 *
 * A script written against the wrong class name or import fails every Coder's
 * code, and nobody finds out until a Coder does. Validation is how the
 * Architect finds out first. It is advisory: the result is a warning on the
 * script, never a gate on publishing or starting a session.
 *
 * It rides the RUN queue as an ordinary job with no cases, so it needs nothing
 * from the worker beyond what a Practice Run already uses. The one extra piece
 * is a Redis record naming the job as a validation, which is how its result is
 * told apart from a Coder's Run when it comes back.
 */

export type ValidationTarget = "ASSESSMENT" | "PRACTICE";

const validationRecordSchema = z.object({ target: z.enum(["ASSESSMENT", "PRACTICE"]) });

export function validationKey(jobId: string): string {
  return `execution:script-validation:${jobId}`;
}

/** Validations per Architect per minute. Each one is a container per script. */
const VALIDATION_RATE_LIMIT = { max: 10, windowSeconds: 60 } as const;

/** How many failing test names a summary lists before it just counts. */
const LISTED_FAILURES = 3;

/** Every select that feeds a script view includes these. */
export const VALIDATION_SELECT = {
  validationStatus: true,
  validationSummary: true,
  validationChangedAt: true,
} as const;

/** Written whenever a script or its language's reference solution changes. */
export function resetValidation() {
  return {
    validationStatus: "UNVALIDATED" as const,
    validationJobId: null,
    validationSummary: null,
    validationChangedAt: new Date(),
  };
}

/**
 * What one script's validation came to.
 *
 * Only a script whose every test passed against the reference solution is
 * PASSED. A script that reported nothing did not prove anything, so it fails
 * too; so does every script in a job that never got as far as running them.
 */
export function summarizeValidation(
  result: Pick<ExecutionResult, "status" | "systemError">,
  rows: Array<Pick<ExecutionTestResult, "name" | "passed">>,
): { status: "PASSED" | "FAILED"; summary: string } {
  if (result.status === "SYSTEM_ERROR") {
    return {
      status: "FAILED",
      summary: result.systemError ?? "The platform could not run the script",
    };
  }
  if (result.status === "COMPILE_ERROR") {
    return { status: "FAILED", summary: "The reference solution did not compile" };
  }
  if (rows.length === 0) {
    // Building the reference solution can spend the job's time or memory
    // before any script opens a container of its own. Nothing reported a test
    // then, but the scripts are not what went wrong, and telling an Architect
    // they wrote an empty script would send them to rewrite a working one.
    if (result.status === "TIME_LIMIT_EXCEEDED") {
      return {
        status: "FAILED",
        summary: "The reference solution ran out of time before its scripts could run",
      };
    }
    if (result.status === "MEMORY_LIMIT_EXCEEDED") {
      return {
        status: "FAILED",
        summary: "The reference solution ran out of memory before its scripts could run",
      };
    }
    return { status: "FAILED", summary: "The script reported no tests" };
  }

  const failing = rows.filter((row) => !row.passed).map((row) => row.name);
  if (failing.length === 0) {
    return {
      status: "PASSED",
      summary: rows.length === 1 ? "Its test passed" : `All ${String(rows.length)} tests passed`,
    };
  }

  const listed = failing.slice(0, LISTED_FAILURES).join(", ");
  const more =
    failing.length > LISTED_FAILURES ? ` and ${String(failing.length - LISTED_FAILURES)} more` : "";
  return {
    status: "FAILED",
    summary: `${String(rows.length - failing.length)} of ${String(rows.length)} tests passed. Failing: ${listed}${more}`,
  };
}

/** The limits a validation runs under: one fresh container per script. */
export function validationLimits(
  timeLimitMs: number,
  memoryLimitMb: number,
  scriptCount: number,
): ExecutionLimits {
  return {
    ...DEFAULT_EXECUTION_LIMITS,
    runTimeoutMs: timeLimitMs,
    memoryLimitMb,
    wallTimeoutMs: Math.max(
      DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
      DEFAULT_EXECUTION_LIMITS.compileTimeoutMs +
        scriptCount * DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
    ),
  };
}

/**
 * Queues one validation and marks its scripts VALIDATING.
 *
 * The record is written before the job, for the same reason a Run's owner is:
 * a result that arrives first would have no way to know it was a validation.
 */
export async function enqueueScriptValidation(input: {
  target: ValidationTarget;
  actorId: string;
  jobId: string;
  language: Language;
  referenceSolution: string | undefined;
  scripts: ExecutionTestScript[];
  limits: ExecutionLimits;
}): Promise<string> {
  if (input.referenceSolution === undefined || input.referenceSolution.trim() === "") {
    throw new AppError(
      "VALIDATION_FAILED",
      `Save a ${input.language} reference solution before validating its scripts`,
    );
  }
  if (input.scripts.length === 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      `There are no ${input.language} test scripts to validate`,
    );
  }

  const limit = await consumeRateLimit(
    `script-validation:${input.actorId}`,
    VALIDATION_RATE_LIMIT.max,
    VALIDATION_RATE_LIMIT.windowSeconds,
  );
  if (!limit.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many validations. Try again in ${String(limit.retryAfterSeconds)} seconds`,
    );
  }

  await getRedis().set(
    validationKey(input.jobId),
    JSON.stringify({ target: input.target }),
    "EX",
    RUN_OWNER_TTL_SECONDS,
  );

  const ids = input.scripts.map((script) => script.id);
  const validating = {
    validationStatus: "VALIDATING" as const,
    validationJobId: input.jobId,
    validationSummary: null,
    validationChangedAt: new Date(),
  };
  if (input.target === "ASSESSMENT") {
    await prisma.assessmentTestScript.updateMany({ where: { id: { in: ids } }, data: validating });
  } else {
    await prisma.practiceTestScript.updateMany({ where: { id: { in: ids } }, data: validating });
  }

  return enqueueExecutionJob(
    {
      jobId: input.jobId,
      kind: "RUN",
      submissionId: null,
      language: input.language,
      sourceCode: input.referenceSolution,
      limits: input.limits,
      testCases: [],
      testScripts: input.scripts,
    },
    { userId: input.actorId },
  );
}

/**
 * Records a validation's result against its scripts, when the job was one.
 * Returns false for any other Run.
 *
 * Only scripts still waiting on this very job are written. One edited since
 * the request was reset and carries no job id, so a late result cannot mark a
 * script it never ran.
 */
export async function recordScriptValidation(result: ExecutionResult): Promise<boolean> {
  const raw = await getRedis().get(validationKey(result.jobId));
  if (raw === null) return false;

  const record = validationRecordSchema.safeParse(JSON.parse(raw));
  if (!record.success) return false;

  const where = { validationJobId: result.jobId, validationStatus: "VALIDATING" as const };
  const pending =
    record.data.target === "ASSESSMENT"
      ? await prisma.assessmentTestScript.findMany({ where, select: { id: true } })
      : await prisma.practiceTestScript.findMany({ where, select: { id: true } });

  const changedAt = new Date();
  await Promise.all(
    pending.map(({ id }) => {
      const outcome = summarizeValidation(
        result,
        result.testResults.filter((row) => row.testScriptId === id),
      );
      const data = {
        validationStatus: outcome.status,
        validationSummary: outcome.summary,
        validationChangedAt: changedAt,
      };
      const scoped = { id, validationJobId: result.jobId };
      return record.data.target === "ASSESSMENT"
        ? prisma.assessmentTestScript.updateMany({ where: scoped, data })
        : prisma.practiceTestScript.updateMany({ where: scoped, data });
    }),
  );

  await getRedis().del(validationKey(result.jobId));
  return true;
}
