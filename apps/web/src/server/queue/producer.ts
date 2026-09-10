import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  AppError,
  EXECUTION_CONTRACT_VERSION,
  QUEUE_NAMES,
  RUN_JOB_OPTIONS,
  SUBMIT_JOB_OPTIONS,
  type ExecutionJob,
  executionJobSchema,
  isExecutableLanguage,
} from "@ambatucode/shared";
import { getServerEnv } from "../env";
import { getRedis } from "../redis";
import { issueCallbackToken } from "../auth/callback-token";

/**
 * Queue producer. This is the only path from apps/web to code execution —
 * nothing here may import a Docker SDK or shell out to `docker`. The Go worker
 * consumes these jobs and owns every container.
 */

const globalForQueues = globalThis as unknown as {
  ambatucodeQueueConnection?: Redis;
  ambatucodeRunQueue?: Queue<ExecutionJob>;
  ambatucodeSubmitQueue?: Queue<ExecutionJob>;
};

function getConnection(): Redis {
  // BullMQ requires maxRetriesPerRequest to be null on its connection.
  globalForQueues.ambatucodeQueueConnection ??= new Redis(getServerEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  return globalForQueues.ambatucodeQueueConnection;
}

export function getRunQueue(): Queue<ExecutionJob> {
  globalForQueues.ambatucodeRunQueue ??= new Queue<ExecutionJob>(QUEUE_NAMES.RUN, {
    connection: getConnection(),
  });
  return globalForQueues.ambatucodeRunQueue;
}

export function getSubmitQueue(): Queue<ExecutionJob> {
  globalForQueues.ambatucodeSubmitQueue ??= new Queue<ExecutionJob>(QUEUE_NAMES.SUBMIT, {
    connection: getConnection(),
  });
  return globalForQueues.ambatucodeSubmitQueue;
}

/**
 * `contractVersion` and `callbackToken` are stamped here rather than supplied
 * by callers: one is a property of the wire format and the other is a
 * credential, and neither is a decision a calling service should be making.
 */
export type ExecutionJobInput = Omit<ExecutionJob, "callbackToken" | "contractVersion">;

/** Who is waiting on this job's result. Never travels in the job payload. */
export type ExecutionJobOwner = { userId: string };

/**
 * A RUN leaves no row behind — that is the whole point of a Run — so this key
 * is the only record of who to hand the result to when the worker calls back.
 * A SUBMIT needs no equivalent: its `Submission` row already names the user and
 * outlives any expiry.
 *
 * The TTL comfortably outlives the 5-minute life of a run job. If it lapses
 * anyway the result is simply not delivered, which is the correct failure for
 * a Run: nothing was graded and nothing was lost.
 */
export const RUN_OWNER_TTL_SECONDS = 900;

export function runOwnerKey(jobId: string): string {
  return `execution:run-owner:${jobId}`;
}

/**
 * Enqueues one execution job.
 *
 * `jobId` doubles as the BullMQ job id, so re-enqueueing a submission is a
 * no-op rather than a duplicate grading run. For SUBMIT the caller passes the
 * `Submission.id`; for RUN it passes a fresh random id.
 *
 * The payload is re-validated against the shared contract before it leaves the
 * process: the Go worker parses it strictly, and a malformed job would fail
 * there with far less context than it does here.
 */
export async function enqueueExecutionJob(
  input: ExecutionJobInput,
  owner: ExecutionJobOwner,
): Promise<string> {
  const job: ExecutionJob = {
    ...input,
    contractVersion: EXECUTION_CONTRACT_VERSION,
    callbackToken: issueCallbackToken(input.jobId),
  };

  const parsed = executionJobSchema.parse(job);

  // The schema accepts every language the product knows about; only some of
  // them have a sandbox image. Refusing here turns a mis-configured Assessment
  // into an immediate, explainable rejection instead of a SYSTEM_ERROR the
  // Coder discovers after their attempt is already spent.
  if (!isExecutableLanguage(parsed.language)) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      `No execution environment is available for ${parsed.language}`,
    );
  }

  if (parsed.kind === "RUN") {
    // A hidden case in a run payload would be a direct leak of grading data.
    const leaked = parsed.testCases.filter((testCase) => !testCase.isPublic);
    if (leaked.length > 0) {
      throw new Error("RUN jobs may only carry public test cases");
    }
    if (parsed.testScript !== null) {
      throw new Error("RUN jobs may not carry a test script");
    }
    // Written before the job is queued. The worker can finish a trivial run in
    // well under a second, and a result that arrives before its owner is
    // recorded has nowhere to go.
    await getRedis().set(runOwnerKey(parsed.jobId), owner.userId, "EX", RUN_OWNER_TTL_SECONDS);
    await getRunQueue().add(QUEUE_NAMES.RUN, parsed, {
      ...RUN_JOB_OPTIONS,
      jobId: parsed.jobId,
    });
  } else {
    await getSubmitQueue().add(QUEUE_NAMES.SUBMIT, parsed, {
      ...SUBMIT_JOB_OPTIONS,
      jobId: parsed.jobId,
    });
  }

  return parsed.jobId;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    globalForQueues.ambatucodeRunQueue?.close(),
    globalForQueues.ambatucodeSubmitQueue?.close(),
  ]);
  globalForQueues.ambatucodeRunQueue = undefined;
  globalForQueues.ambatucodeSubmitQueue = undefined;
}

/** Closes the BullMQ connection. Used by graceful shutdown and by tests. */
export async function closeQueueConnection(): Promise<void> {
  await closeQueues();
  await globalForQueues.ambatucodeQueueConnection?.quit();
  globalForQueues.ambatucodeQueueConnection = undefined;
}
