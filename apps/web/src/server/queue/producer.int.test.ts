import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionJob,
  executionJobSchema,
} from "@ambatucode/shared";
import { verifyCallbackToken } from "../auth/callback-token";
import { closeRedis } from "../redis";
import {
  RUN_OWNER_TTL_SECONDS,
  closeQueueConnection,
  enqueueExecutionJob,
  getRunQueue,
  runOwnerKey,
  type ExecutionJobInput,
} from "./producer";

/** Stands in for the Coder who pressed Run. Any stable id will do. */
const OWNER = { userId: "usr_producer_int_test" };

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
  await closeRedis();
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
 * Reads the queued job straight back out of Redis by its id.
 *
 * Deliberately not done by attaching a consumer: any worker connected to the
 * same Redis — a developer's `go run ./cmd/worker`, another test run — is a
 * competing consumer, and the job would be delivered to whichever asked first.
 * That made this spec pass or fail depending on what else happened to be
 * running. What it needs to prove is that the payload survives serialisation
 * intact, and reading it back proves exactly that. Whether a worker can
 * receive it is settled far more convincingly by the Go worker's own suite.
 */
async function readBack(jobId: string): Promise<ExecutionJob> {
  const job = await getRunQueue().getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found on the queue`);
  return job.data;
}

describe("enqueueExecutionJob", () => {
  it("round-trips a RUN job through Redis with a verifiable callback token", async () => {
    const input = buildRunJob();
    const jobId = await enqueueExecutionJob(input, OWNER);
    expect(jobId).toBe(input.jobId);

    const received = await readBack(input.jobId);

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

    await expect(enqueueExecutionJob(input, OWNER)).rejects.toThrow(
      /RUN jobs may only carry public test cases/,
    );
  });

  it("refuses to put a test script in a RUN payload", async () => {
    const input = buildRunJob({
      testScript: { framework: "PYTEST", entrypoint: "test_main.py", files: [] },
    });

    await expect(enqueueExecutionJob(input, OWNER)).rejects.toThrow(
      /RUN jobs may not carry a test script/,
    );
  });

  /**
   * A Run writes no database row, so this key is the only thing that says who
   * the result belongs to. Losing it means a Coder watching a spinner that
   * never resolves.
   */
  it("records the Run's owner so the result can be delivered", async () => {
    const input = buildRunJob();
    await enqueueExecutionJob(input, OWNER);

    const key = runOwnerKey(input.jobId);
    expect(await connection.get(key)).toBe(OWNER.userId);

    // Bounded, and comfortably longer than the job's own 5-minute life.
    const ttl = await connection.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(RUN_OWNER_TTL_SECONDS);

    await connection.del(key);
  });

  it("refuses a language the worker could not run, without queueing it", async () => {
    // Two gates guard this, in order. The contract schema refuses anything
    // outside the product vocabulary, and behind it the executable-language
    // check refuses a language that has no sandbox image — the one that would
    // catch an image dropped from docker/sandbox without the registry being
    // narrowed. Every language currently has an image, so what fires here is
    // the schema; both exist so a mis-configuration cannot reach a Coder as a
    // SYSTEM_ERROR after their attempt is already spent.
    const input = buildRunJob({ language: "pascal" as unknown as ExecutionJob["language"] });

    await expect(enqueueExecutionJob(input, OWNER)).rejects.toThrow();

    // The rejection happens before anything is written, so no owner record is
    // left behind to expire on its own.
    expect(await connection.get(runOwnerKey(input.jobId))).toBeNull();
    expect(await getRunQueue().getJob(input.jobId)).toBeUndefined();
  });
});
