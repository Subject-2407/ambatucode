/**
 * Pushes one hand-crafted execution job onto the queue through the real
 * producer, so the pipeline can be exercised without a UI. Pair it with
 * `pnpm stub:worker` (or the Go worker once it exists) to watch a job travel
 * producer -> Redis -> worker -> result callback.
 *
 * Usage: pnpm enqueue:sample [RUN|SUBMIT]
 *
 * Run under the `react-server` condition so the `server-only` markers in
 * src/server resolve to their no-op build outside Next.js.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_EXECUTION_LIMITS, type ExecutionKind } from "@ambatucode/shared";
import { closeQueueConnection, enqueueExecutionJob } from "../src/server/queue/producer";

const kind: ExecutionKind = process.argv[2] === "SUBMIT" ? "SUBMIT" : "RUN";
const jobId = randomUUID();

async function main(): Promise<void> {
  await enqueueExecutionJob({
    jobId,
    kind,
    // A real SUBMIT carries a persisted Submission id. This sample has no
    // assessment behind it, so the callback is acknowledged without being
    // written to grading history.
    submissionId: null,
    language: "python",
    sourceCode: 'name = input()\nprint(f"hello {name}")\n',
    limits: DEFAULT_EXECUTION_LIMITS,
    testCases: [
      {
        id: "sample-1",
        name: "greets the given name",
        input: "world",
        expectedOutput: "hello world",
        weight: 1,
        isPublic: true,
        comparison: "TRIMMED",
      },
    ],
    testScript: null,
  });

  console.info(`[enqueue] queued ${kind} job ${jobId}`);
}

main()
  .catch((error: unknown) => {
    console.error("[enqueue] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => closeQueueConnection());
