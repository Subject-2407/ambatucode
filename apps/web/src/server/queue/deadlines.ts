import "server-only";
import { Queue } from "bullmq";
import {
  errorFields,
  DEADLINE_JOB_OPTIONS,
  DEADLINE_QUEUE_NAME,
  deadlineJobId,
  type DeadlineJob,
} from "@ambatucode/shared";
import { registerCloser } from "../shutdown-registry";
import { getConnection } from "./producer";
import { log } from "../logger";

/**
 * Schedules the delayed jobs that enforce assessment deadlines. apps/realtime
 * consumes them; apps/web only ever adds and removes.
 *
 * Scheduling is best-effort on purpose. The deadline lives in the database —
 * the job is only the alarm clock — and apps/realtime sweeps for overdue
 * attempts on an interval, so a Redis hiccup while starting an attempt costs a
 * few seconds of lateness, not a Coder who can type forever. Failing the
 * request instead would turn that hiccup into a Coder unable to start at all.
 */

const globalForDeadlines = globalThis as unknown as {
  ambatucodeDeadlineQueue?: Queue<DeadlineJob>;
};

export function getDeadlineQueue(): Queue<DeadlineJob> {
  globalForDeadlines.ambatucodeDeadlineQueue ??= new Queue<DeadlineJob>(DEADLINE_QUEUE_NAME, {
    connection: getConnection(),
  });
  registerCloser("deadlineQueue", closeDeadlineQueue);
  return globalForDeadlines.ambatucodeDeadlineQueue;
}

async function removeIfPresent(queue: Queue<DeadlineJob>, jobId: string): Promise<void> {
  try {
    await queue.remove(jobId);
  } catch (error) {
    // A job that is firing right now is locked and cannot be removed. It
    // re-reads the attempt before acting, so letting it run is harmless.
    log.warn("deadline.remove_failed", { jobId, ...errorFields(error) });
  }
}

/** Replaces any existing alarm for the same attempt or session. */
export async function scheduleDeadline(
  job: DeadlineJob,
  atMs: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const queue = getDeadlineQueue();
  const jobId = deadlineJobId(job);
  try {
    await removeIfPresent(queue, jobId);
    await queue.add(DEADLINE_QUEUE_NAME, job, {
      ...DEADLINE_JOB_OPTIONS,
      jobId,
      delay: Math.max(0, atMs - nowMs),
    });
  } catch (error) {
    log.error("deadline.schedule_failed", { jobId, recovery: "sweep", ...errorFields(error) });
  }
}

export async function cancelDeadline(job: DeadlineJob): Promise<void> {
  try {
    await removeIfPresent(getDeadlineQueue(), deadlineJobId(job));
  } catch (error) {
    log.error("deadline.cancel_failed", { jobId: deadlineJobId(job), ...errorFields(error) });
  }
}

export async function closeDeadlineQueue(): Promise<void> {
  await globalForDeadlines.ambatucodeDeadlineQueue?.close();
  globalForDeadlines.ambatucodeDeadlineQueue = undefined;
}
