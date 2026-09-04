/**
 * Development stand-in for apps/worker.
 *
 * It consumes both execution queues, fabricates a plausible result, and posts
 * it back to the internal callback endpoint with the job's own callback token.
 * It exists so the producer half of the pipeline can be exercised end to end
 * before the Go worker lands.
 *
 * It deliberately does not execute anything. Running untrusted participant code
 * is the Go worker's job and happens only inside a Docker sandbox — this
 * process must never gain that responsibility.
 *
 * Usage: pnpm stub:worker
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAMES,
  type ExecutionJob,
  type ExecutionResult,
  executionJobSchema,
} from "@ambatucode/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CALLBACK_URL =
  process.env.EXECUTION_CALLBACK_URL ?? "http://localhost:3000/api/internal/execution/result";

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

function fabricateResult(job: ExecutionJob): ExecutionResult {
  return {
    jobId: job.jobId,
    submissionId: job.submissionId,
    status: "GRADED",
    compilerOutput: null,
    systemError: null,
    executionTimeMs: 12,
    memoryUsedKb: 4_096,
    testResults: job.testCases.map((testCase) => ({
      testCaseId: testCase.id,
      name: testCase.name,
      passed: true,
      weight: testCase.weight,
      executionTimeMs: 4,
      memoryUsedKb: 2_048,
      stdoutExcerpt: testCase.expectedOutput,
      stderrExcerpt: "",
    })),
  };
}

async function handle(rawJob: unknown): Promise<void> {
  const job = executionJobSchema.parse(rawJob);
  const result = fabricateResult(job);

  const response = await fetch(CALLBACK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-execution-callback-token": job.callbackToken,
    },
    body: JSON.stringify(result),
  });

  const body = await response.text();
  console.info(`[stub-worker] ${job.kind} ${job.jobId} -> ${response.status} ${body}`);

  if (!response.ok) {
    throw new Error(`Callback rejected with ${response.status}`);
  }
}

const workers = [QUEUE_NAMES.RUN, QUEUE_NAMES.SUBMIT].map(
  (queueName) =>
    new Worker<ExecutionJob>(queueName, (job) => handle(job.data), {
      connection: connection.duplicate(),
    }),
);

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    console.error(`[stub-worker] job ${job?.id ?? "unknown"} failed:`, error.message);
  });
}

console.info(`[stub-worker] consuming ${QUEUE_NAMES.RUN} and ${QUEUE_NAMES.SUBMIT}`);

const shutdown = (): void => {
  void Promise.all(workers.map((worker) => worker.close())).finally(() => connection.quit());
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
