/**
 * Load harness: 100 concurrent formal submissions, and what the rest of the
 * platform feels like while they land.
 *
 * NFR-PERF-01 asks for roughly 50–100 simultaneous submissions without the LMS
 * crashing or blocking, and NFR-PERF-04 asks that a large grading workload not
 * stop ordinary navigation. Those are two different measurements, so this
 * script takes both at once: it fires the submissions from one side and, from
 * the other, keeps reading a page a Coder would read — recording that
 * latency throughout the burst and comparing it to a baseline taken before.
 *
 * Nothing here is a unit test. It drives the real HTTP API against a running
 * apps/web, signs in as the seeded accounts, and writes real rows.
 *
 *   docker compose -f docker/compose/dev.yml up -d
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm --filter web dev            # and, to grade rather than only queue:
 *   cd apps/worker && go run ./cmd/worker
 *   pnpm --filter web load:submissions
 *
 * With no worker attached the submissions stay QUEUED. That is still the
 * measurement that matters for these two requirements: the producer side is
 * what the LMS does, and whether the queue drains afterwards is the worker's
 * own load test in EXECUTION.md.
 */

const BASE_URL = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Ambatucode123!";

/** Seeded Coders. Twenty accounts across five sessions gives a hundred attempts. */
const CODER_COUNT = Number(process.env.LOAD_CODERS ?? 20);
const SESSION_COUNT = Number(process.env.LOAD_SESSIONS ?? 5);

const SOURCE = "import sys\nprint(int(sys.stdin.readline()) * 2)\n";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

class Client {
  private cookie = "";

  constructor(readonly label: string) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie === "" ? {} : { cookie: this.cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) {
      const first = setCookie.split(";")[0];
      if (first !== undefined) this.cookie = first;
    }

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      throw new Error(`${this.label}: ${method} ${path} → ${envelope.error.code}`);
    }
    return envelope.data;
  }

  /** Latency of one ordinary read, in milliseconds. */
  async timeRead(path: string): Promise<number> {
    const started = performance.now();
    await this.call("GET", path);
    return performance.now() - started;
  }

  async signIn(username: string): Promise<void> {
    await this.call("POST", "/api/auth/login", { username, password: PASSWORD });
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function summarise(label: string, values: number[]): string {
  if (values.length === 0) return `${label.padEnd(26)} no samples`;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return [
    label.padEnd(26),
    `n=${String(values.length).padStart(4)}`,
    `mean=${mean.toFixed(0).padStart(5)}ms`,
    `p50=${percentile(values, 0.5).toFixed(0).padStart(5)}ms`,
    `p95=${percentile(values, 0.95).toFixed(0).padStart(5)}ms`,
    `max=${Math.max(...values).toFixed(0).padStart(5)}ms`,
  ].join("  ");
}

function coderName(index: number): string {
  return `coder${String(index + 1).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const stamp = Date.now().toString(36);
  const architect = new Client("architect1");
  await architect.signIn("architect1");

  console.info(`Building the fixture: ${String(SESSION_COUNT)} sessions × ${String(CODER_COUNT)} coders`);

  const module = await architect.call<{ id: string }>("POST", "/api/modules", {
    title: `Load test ${stamp}`,
    slug: `load-test-${stamp}`,
    visibility: "PUBLIC",
    isPublished: true,
  });
  const section = await architect.call<{ id: string }>(
    "POST",
    `/api/modules/${module.id}/sections`,
    { title: "Load" },
  );
  const assessment = await architect.call<{ id: string }>(
    "POST",
    `/api/sections/${section.id}/assessments`,
    {
      title: `Doubling ${stamp}`,
      problemStatement: "Read n and print n doubled.",
      allowedLanguages: ["python"],
      starterCode: { python: "" },
      timeMode: "UNTIMED",
      isPublished: true,
    },
  );
  await architect.call("POST", `/api/assessments/${assessment.id}/test-cases`, {
    name: "Sample",
    kind: "PUBLIC",
    input: "2",
    expectedOutput: "4",
  });

  const sessions: string[] = [];
  for (let index = 0; index < SESSION_COUNT; index += 1) {
    const session = await architect.call<{ id: string }>(
      "POST",
      `/api/assessments/${assessment.id}/sessions`,
      { name: `Load session ${String(index + 1)}` },
    );
    await architect.call("POST", `/api/sessions/${session.id}/start`, { force: true });
    sessions.push(session.id);
  }

  // Signing in is serial on purpose: login is deliberately rate-limited and
  // deliberately expensive (argon2id), and hammering it would measure the
  // password hash rather than the submission pipeline.
  const coders: Client[] = [];
  for (let index = 0; index < CODER_COUNT; index += 1) {
    const client = new Client(coderName(index));
    await client.signIn(coderName(index));
    await client.call("POST", `/api/modules/${module.id}/enroll`);
    coders.push(client);
  }

  // Attempts are started up front so the burst measures submission alone.
  const attempts: Array<{ client: Client; attemptId: string }> = [];
  for (const session of sessions) {
    for (const client of coders) {
      const attempt = await client.call<{ id: string }>(
        "POST",
        `/api/sessions/${session}/attempt/start`,
      );
      attempts.push({ client, attemptId: attempt.id });
    }
  }
  console.info(`Prepared ${String(attempts.length)} attempts`);

  // --- Baseline: what an ordinary read costs with nothing else happening ----
  const reader = new Client("coder01-reader");
  await reader.signIn(coderName(0));
  const baseline: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    baseline.push(await reader.timeRead(`/api/modules/${module.id}`));
  }

  // --- The burst ------------------------------------------------------------
  const duringBurst: number[] = [];
  let navigating = true;
  const navigation = (async () => {
    while (navigating) {
      try {
        duringBurst.push(await reader.timeRead(`/api/modules/${module.id}`));
      } catch {
        // A failed read during the burst is itself the finding; keep going.
        duringBurst.push(Number.NaN);
      }
    }
  })();

  console.info(`Submitting ${String(attempts.length)} at once…`);
  const burstStarted = performance.now();
  const submitLatencies = await Promise.all(
    attempts.map(async ({ client, attemptId }) => {
      const started = performance.now();
      await client.call("POST", `/api/attempts/${attemptId}/submit`, {
        language: "python",
        sourceCode: SOURCE,
      });
      return performance.now() - started;
    }),
  );
  const burstMs = performance.now() - burstStarted;
  navigating = false;
  await navigation;

  // --- Report ---------------------------------------------------------------
  const healthy = duringBurst.filter((value) => !Number.isNaN(value));
  const failedReads = duringBurst.length - healthy.length;

  console.info("");
  console.info(`Burst of ${String(attempts.length)} submissions finished in ${burstMs.toFixed(0)}ms`);
  console.info(`  throughput: ${(attempts.length / (burstMs / 1000)).toFixed(1)} submissions/second`);
  console.info("");
  console.info(summarise("submit latency", submitLatencies));
  console.info(summarise("navigation, idle", baseline));
  console.info(summarise("navigation, under load", healthy));
  if (failedReads > 0) console.info(`  ${String(failedReads)} navigation reads FAILED during the burst`);

  const idleP95 = percentile(baseline, 0.95);
  const loadedP95 = percentile(healthy, 0.95);
  const ratio = idleP95 === 0 ? 0 : loadedP95 / idleP95;
  console.info("");
  console.info(`Navigation p95 degraded ${ratio.toFixed(1)}× under load.`);
  console.info(
    failedReads === 0 && ratio < 5
      ? "PASS — ordinary navigation stayed responsive while grading was queued."
      : "INVESTIGATE — navigation degraded further than the requirement allows.",
  );
  console.info("");
  console.info(`Fixture left in place for inspection: module ${module.id}`);
  console.info(`Remove it with: DELETE ${BASE_URL}/api/modules/${module.id} as architect1`);
}

main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exitCode = 1;
});
