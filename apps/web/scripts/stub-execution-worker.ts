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
 * Because it executes nothing, every verdict it reports is fabricated: cases
 * and script tests alike all pass. It cannot tell an Architect whether a test
 * script really runs against their reference solution — validating scripts for
 * real needs the Go worker and the sandbox images.
 *
 * Usage: pnpm stub:worker
 */
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  EXECUTION_CONTRACT_VERSION,
  QUEUE_NAMES,
  type ExecutionJob,
  type ExecutionResult,
  type ExecutionTestResult,
  executionJobSchema,
} from "@ambatucode/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CALLBACK_URL =
  process.env.EXECUTION_CALLBACK_URL ?? "http://localhost:3000/api/internal/execution/result";

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

function fabricateResult(job: ExecutionJob): ExecutionResult {
  const caseResults: ExecutionTestResult[] = job.testCases.map((testCase) => ({
    testCaseId: testCase.id,
    testScriptId: null,
    name: testCase.name,
    status: "GRADED",
    passed: true,
    weight: testCase.weight,
    executionTimeMs: 4,
    memoryUsedKb: 2_048,
    stdoutExcerpt: testCase.expectedOutput,
    stderrExcerpt: "",
    failureDetail: null,
  }));

  // Every script gets a row of its own. A job carrying scripts and no cases is
  // a script validation, and a result with no row for a script is read as a
  // script that reported no tests — so leaving these out fails an Architect's
  // scripts on the strength of a stand-in that never ran them. Excerpts stay
  // empty, as the real worker's script rows are: a script quotes the values it
  // expects, and none of that is a Coder's to see.
  const scriptResults: ExecutionTestResult[] = job.testScripts.map((script) => ({
    testCaseId: null,
    testScriptId: script.id,
    name: `${script.path} (stub worker)`,
    status: "GRADED",
    passed: true,
    weight: script.weight,
    executionTimeMs: 4,
    memoryUsedKb: 2_048,
    stdoutExcerpt: "",
    stderrExcerpt: "",
    failureDetail: null,
  }));

  return {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    jobId: job.jobId,
    submissionId: job.submissionId,
    status: "GRADED",
    compilerOutput: null,
    systemError: null,
    executionTimeMs: 12,
    memoryUsedKb: 4_096,
    testResults: [...caseResults, ...scriptResults],
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
