import type { JobsOptions } from "bullmq";

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
