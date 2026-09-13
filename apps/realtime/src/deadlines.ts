import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { prisma } from "@ambatucode/db";
import {
  DEADLINE_JOB_OPTIONS,
  DEADLINE_QUEUE_NAME,
  deadlineJobId,
  deadlineJobSchema,
  type DeadlineJob,
} from "@ambatucode/shared";
import type { WebClient } from "./web-client";

/**
 * Deadline enforcement, apps/realtime side.
 *
 * apps/web schedules the alarm when a clock starts. apps/realtime moves it
 * when an Individual clock pauses or resumes, fires it, and sweeps for any
 * deadline the alarms missed — a job that exhausted its retries, a Redis that
 * lost it, a process that was down when it was due.
 *
 * Firing never submits anything here. It asks apps/web, which re-reads the
 * attempt under a lock and decides.
 */

export type DeadlineScheduler = {
  schedule(job: DeadlineJob, atMs: number): Promise<void>;
  cancel(job: DeadlineJob): Promise<void>;
};

export type DeadlineRuntime = DeadlineScheduler & {
  /** Starts consuming the queue and sweeping. Separate so tests can leave it off. */
  start(): void;
  sweep(): Promise<void>;
  close(): Promise<void>;
};

/** Overdue attempts are also closed on this cadence, whatever the queue did. */
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_BATCH = 200;

export function createDeadlineRuntime(options: {
  connection: Redis;
  web: WebClient;
  sweepIntervalMs?: number;
}): DeadlineRuntime {
  const queue = new Queue<DeadlineJob>(DEADLINE_QUEUE_NAME, { connection: options.connection });
  let worker: Worker<DeadlineJob> | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let sweeping = false;

  async function removeIfPresent(jobId: string): Promise<void> {
    try {
      await queue.remove(jobId);
    } catch (error) {
      // A job firing right now is locked. It re-checks the database before
      // anything happens, so letting it finish is harmless.
      console.warn(`[deadlines] could not remove ${jobId}:`, error);
    }
  }

  async function schedule(job: DeadlineJob, atMs: number): Promise<void> {
    const jobId = deadlineJobId(job);
    try {
      await removeIfPresent(jobId);
      await queue.add(DEADLINE_QUEUE_NAME, job, {
        ...DEADLINE_JOB_OPTIONS,
        jobId,
        delay: Math.max(0, atMs - Date.now()),
      });
    } catch (error) {
      console.error(`[deadlines] failed to schedule ${jobId}; the sweep will cover it:`, error);
    }
  }

  async function cancel(job: DeadlineJob): Promise<void> {
    await removeIfPresent(deadlineJobId(job));
  }

  async function fire(job: DeadlineJob): Promise<void> {
    if (job.kind === "ATTEMPT") {
      await options.web.autoSubmit(job.attemptId, "DEADLINE");
    } else {
      await options.web.expireSession(job.sessionId);
    }
  }

  async function sweep(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      const now = new Date();
      const [attempts, sessions, stranded] = await Promise.all([
        prisma.assessmentAttempt.findMany({
          where: {
            status: "IN_PROGRESS",
            pausedAt: null,
            individualDeadlineAt: { lte: now },
          },
          select: { id: true },
          take: SWEEP_BATCH,
        }),
        prisma.assessmentSession.findMany({
          where: { status: "RUNNING", endsAt: { lte: now } },
          select: { id: true },
          take: SWEEP_BATCH,
        }),
        // Attempts left open in a session that has already ended — ending was
        // interrupted between flipping the session and closing its attempts.
        prisma.assessmentAttempt.findMany({
          where: { status: "IN_PROGRESS", session: { status: { in: ["ENDED", "CANCELLED"] } } },
          select: { id: true },
          take: SWEEP_BATCH,
        }),
      ]);

      for (const session of sessions) {
        await options.web.expireSession(session.id).catch((error: unknown) => {
          console.error(`[deadlines] sweep could not expire session ${session.id}:`, error);
        });
      }
      for (const attempt of attempts) {
        await options.web.autoSubmit(attempt.id, "DEADLINE").catch((error: unknown) => {
          console.error(`[deadlines] sweep could not close attempt ${attempt.id}:`, error);
        });
      }
      for (const attempt of stranded) {
        await options.web.autoSubmit(attempt.id, "SESSION_ENDED").catch((error: unknown) => {
          console.error(`[deadlines] sweep could not close stranded attempt ${attempt.id}:`, error);
        });
      }
    } catch (error) {
      console.error("[deadlines] sweep failed:", error);
    } finally {
      sweeping = false;
    }
  }

  return {
    schedule,
    cancel,
    sweep,
    start() {
      if (worker !== null) return;
      worker = new Worker<DeadlineJob>(
        DEADLINE_QUEUE_NAME,
        async (job) => {
          await fire(deadlineJobSchema.parse(job.data));
        },
        { connection: options.connection.duplicate(), concurrency: 8 },
      );
      worker.on("failed", (job, error) => {
        console.error(`[deadlines] ${job?.id ?? "job"} failed:`, error.message);
      });
      // Deadlines that passed while this process was down are closed before
      // anything else waits on them.
      void sweep();
      sweepTimer = setInterval(() => void sweep(), options.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
    },
    async close() {
      if (sweepTimer !== null) clearInterval(sweepTimer);
      sweepTimer = null;
      await worker?.close();
      worker = null;
      await queue.close();
    },
  };
}
