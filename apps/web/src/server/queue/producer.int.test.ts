import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_LIMITS,
  QUEUE_NAMES,
  type ExecutionJob,
  executionJobSchema,
} from "@ambatucode/shared";
import { verifyCallbackToken } from "../auth/callback-token";
import { closeQueueConnection, enqueueExecutionJob, type ExecutionJobInput } from "./producer";

/**
 * Proves the producer half of the execution pipeline: a job serialises through
 * Redis unchanged and arrives carrying a callback token that verifies for that
 * job and no other.
 */

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

afterAll(async () => {
  await closeQueueConnection();
  await connection.quit();
});

function buildRunJob(overrides: Partial<ExecutionJobInput> = {}): ExecutionJobInput {
  return {
    jobId: randomUUID(),
    kind: "RUN",
    submissionId: null,
    language: "python",
    sourceCode: "print(input())\n",
    limits: DEFAULT_EXECUTION_LIMITS,
    testCases: [
      {
        id: "case-1",
        name: "echoes its input",
        input: "hello",
        expectedOutput: "hello",
        weight: 1,
        isPublic: true,
        comparison: "TRIMMED",
      },
    ],
    testScript: null,
    ...overrides,
  };
}

/**
 * BullMQ blocks on its worker connection, so the worker gets a duplicate
 * rather than sharing the one used for assertions. The processor resolves and
 * returns immediately — closing the worker from inside its own processor would
 * deadlock, since close() waits for the active job to finish.
 */
async function consumeOne(queueName: string, jobId: string): Promise<ExecutionJob> {
  let worker: Worker<ExecutionJob> | undefined;

  const received = new Promise<ExecutionJob>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the job")), 15_000);

    worker = new Worker<ExecutionJob>(
      queueName,
      (job) => {
        if (job.data.jobId === jobId) {
          clearTimeout(timeout);
          resolve(job.data);
        }
        return Promise.resolve();
      },
      { connection: connection.duplicate() },
    );

    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  try {
    return await received;
  } finally {
    await worker?.close();
  }
}

describe("enqueueExecutionJob", () => {
  it("round-trips a RUN job through Redis with a verifiable callback token", async () => {
    const input = buildRunJob();
    const jobId = await enqueueExecutionJob(input);
    expect(jobId).toBe(input.jobId);

    const received = await consumeOne(QUEUE_NAMES.RUN, input.jobId);

    // The worker parses the payload strictly; assert it satisfies the contract.
    expect(() => executionJobSchema.parse(received)).not.toThrow();
    expect(received.sourceCode).toBe(input.sourceCode);
    expect(received.testCases).toEqual(input.testCases);
    expect(received.limits).toEqual(DEFAULT_EXECUTION_LIMITS);

    expect(() => verifyCallbackToken(received.jobId, received.callbackToken)).not.toThrow();
    expect(() => verifyCallbackToken("some-other-job", received.callbackToken)).toThrow();
  });

  it("refuses to put a hidden test case in a RUN payload", async () => {
    const input = buildRunJob({
      testCases: [
        {
          id: "hidden-1",
          name: "grading case",
          input: "secret",
          expectedOutput: "secret answer",
          weight: 1,
          isPublic: false,
          comparison: "EXACT",
        },
      ],
    });

    await expect(enqueueExecutionJob(input)).rejects.toThrow(
      /RUN jobs may only carry public test cases/,
    );
  });

  it("refuses to put a test script in a RUN payload", async () => {
    const input = buildRunJob({
      testScript: { framework: "PYTEST", entrypoint: "test_main.py", files: [] },
    });

    await expect(enqueueExecutionJob(input)).rejects.toThrow(
      /RUN jobs may not carry a test script/,
    );
  });
});
