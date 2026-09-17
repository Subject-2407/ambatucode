import type { JobsOptions } from "bullmq";
import { z } from "zod";

/**
 * Queue names and job policies. Both queues live on the same Redis instance
 * but are kept separate so a burst of formal submissions cannot starve the
 * low-latency practice/run path, and so runs can be dropped while submissions
 * never are.
 *
 * The names use a hyphen rather than a colon: BullMQ uses `:` as its own Redis
 * key separator and rejects a queue name containing one. The Go worker in
 * apps/worker must subscribe to exactly these strings.
 */
export const QUEUE_NAMES = {
  /** Practice runs and assessment runs. Low latency, discardable. */
  RUN: "execution-run",
  /** Formal submissions. Durable, retried, never dropped. */
  SUBMIT: "execution-submit",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const RUN_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 300 },
  removeOnFail: { age: 300 },
};

/**
 * `removeOnComplete: false` keeps the record so a result callback that arrives
 * after a worker restart still has a job to reconcile against.
 */
export const SUBMIT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: false,
  removeOnFail: false,
};

/**
 * Assessment deadline enforcement. Not an execution queue — the Go worker never
 * reads it, and it is kept out of `QUEUE_NAMES` so that list stays exactly the
 * set the worker must subscribe to.
 *
 * One delayed job per timed attempt (Individual) or per session (Live), due at
 * the deadline. apps/web schedules them when a clock starts; apps/realtime
 * reschedules them on pause and resume and consumes them.
 */
export const DEADLINE_QUEUE_NAME = "assessment-deadline";

export const deadlineJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ATTEMPT"), attemptId: z.string().min(1) }),
  z.object({ kind: z.literal("SESSION"), sessionId: z.string().min(1) }),
]);
export type DeadlineJob = z.infer<typeof deadlineJobSchema>;

/**
 * Deterministic, so rescheduling is "remove by id, add by id" and a duplicate
 * add is a no-op. Hyphenated because BullMQ reserves the colon.
 */
export function deadlineJobId(job: DeadlineJob): string {
  return job.kind === "ATTEMPT" ? `attempt-${job.attemptId}` : `session-${job.sessionId}`;
}

/**
 * Removed on completion and on failure alike: BullMQ silently ignores an add
 * whose id still exists, so a kept record would stop a later reschedule from
 * ever landing. A job that exhausts its retries is not lost — the periodic
 * sweep finds the overdue attempt on its own.
 */
export const DEADLINE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: true,
};
