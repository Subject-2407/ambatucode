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
 *   pnpm --filter web build && pnpm --filter web start   # measure a production build
 *   cd apps/worker && go run ./cmd/worker                 # so grading actually runs
 *   pnpm --filter web load:submissions
 *
 * Navigation is measured twice under load: during the submission burst, and
 * for LOAD_GRADING_SECONDS (default 30) afterwards while the worker grades and
 * results flow back into the LMS — the window NFR-PERF-04 is actually about.
 * With no worker attached the submissions stay QUEUED and the second window
 * measures an idle LMS, which the report says.
 *
 * Start is not dev mode: `next dev` compiles on request and measures the
 * compiler. And the login limit in .env allows ten sign-ins per five minutes,
 * so run the server with LOGIN_RATE_LIMIT_MAX raised for the run.
 */

const BASE_URL = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Ambatucode123!";

/** Seeded Coders. Twenty accounts across five sessions gives a hundred attempts. */
const CODER_COUNT = Number(process.env.LOAD_CODERS ?? 20);
const SESSION_COUNT = Number(process.env.LOAD_SESSIONS ?? 5);
/** How long to keep reading after the burst, while the worker grades. */
const GRADING_SECONDS = Number(process.env.LOAD_GRADING_SECONDS ?? 30);

/**
 * Below this, a read is fast enough that no one navigating would notice, so a
 * large multiple of a very fast idle baseline is not a regression. A relative
 * bound alone fails a 15 ms page for taking 80 ms.
 */
const RESPONSIVE_P95_MS = 500;

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
    `max=${Math.max(...values)
      .toFixed(0)
      .padStart(5)}ms`,
  ].join("  ");
}

function coderName(index: number): string {
  return `coder${String(index + 1).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const stamp = Date.now().toString(36);
  const architect = new Client("architect1");
  await architect.signIn("architect1");

  console.info(
    `Building the fixture: ${String(SESSION_COUNT)} sessions × ${String(CODER_COUNT)} coders`,
  );

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
  // The reader needs an account of its own. Only one session per account may
  // be active, so signing in as any of the submitting Coders would revoke that
  // Coder's session and turn their submissions into 401s.
  const root = new Client("root");
  await root.signIn("root");
  const readerName = `load-reader-${stamp}`;
  await root.call("POST", "/api/admin/users", {
    username: readerName,
    password: PASSWORD,
    displayName: "Load test reader",
    role: "CODER",
  });
  const reader = new Client(readerName);
  await reader.signIn(readerName);
  await reader.call("POST", `/api/modules/${module.id}/enroll`);
  const baseline: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    baseline.push(await reader.timeRead(`/api/modules/${module.id}`));
  }

  // --- The burst ------------------------------------------------------------
  const duringBurst: number[] = [];
  const duringGrading: number[] = [];
  let samples: number[] = duringBurst;
  let navigating = true;
  const navigation = (async () => {
    while (navigating) {
      try {
        samples.push(await reader.timeRead(`/api/modules/${module.id}`));
      } catch {
        // A failed read under load is itself the finding; keep going.
        samples.push(Number.NaN);
      }
    }
  })();

  console.info(`Submitting ${String(attempts.length)} at once…`);
  const burstStarted = performance.now();
  // Settled rather than all: one refused submission must be counted and
  // reported, not abort the run with the reader still looping forever.
  let outcomes: PromiseSettledResult<number>[] = [];
  let burstMs = 0;
  try {
    outcomes = await Promise.allSettled(
      attempts.map(async ({ client, attemptId }) => {
        const started = performance.now();
        await client.call("POST", `/api/attempts/${attemptId}/submit`, {
          language: "python",
          sourceCode: SOURCE,
        });
        return performance.now() - started;
      }),
    );
    const burstEnded = performance.now();
    samples = duringGrading;
    console.info(`Reading for ${String(GRADING_SECONDS)}s while the submissions are graded…`);
    await new Promise((resolve) => setTimeout(resolve, GRADING_SECONDS * 1000));
    burstMs = burstEnded - burstStarted;
  } finally {
    navigating = false;
    await navigation;
  }

  const submitLatencies = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  const refused = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [String(outcome.reason)] : [],
  );

  // --- Report ---------------------------------------------------------------
  const idleP95 = percentile(baseline, 0.95);

  console.info("");
  console.info(
    `Burst of ${String(attempts.length)} submissions finished in ${burstMs.toFixed(0)}ms`,
  );
  console.info(
    `  throughput: ${(attempts.length / (burstMs / 1000)).toFixed(1)} submissions/second`,
  );
  console.info(`  accepted: ${String(submitLatencies.length)}, refused: ${String(refused.length)}`);
  for (const reason of refused.slice(0, 5)) console.info(`    ${reason}`);
  console.info("");
  console.info(summarise("submit latency", submitLatencies));
  console.info(summarise("navigation, idle", baseline));

  // A window is responsive when no read failed and its p95 stays within five
  // times idle, or under the threshold nobody navigating would notice.
  let responsive = true;
  for (const [label, windowSamples] of [
    ["navigation, burst", duringBurst],
    ["navigation, grading", duringGrading],
  ] as const) {
    const healthy = windowSamples.filter((value) => !Number.isNaN(value));
    const failed = windowSamples.length - healthy.length;
    const p95 = percentile(healthy, 0.95);
    const ratio = idleP95 === 0 ? 0 : p95 / idleP95;
    const ok = failed === 0 && healthy.length > 0 && (ratio < 5 || p95 < RESPONSIVE_P95_MS);
    responsive &&= ok;
    console.info(`${summarise(label, healthy)}  ${ratio.toFixed(1)}× idle  ${ok ? "ok" : "SLOW"}`);
    if (failed > 0) console.info(`  ${String(failed)} reads FAILED in this window`);
  }

  const passed = refused.length === 0 && responsive;
  console.info("");
  console.info(
    passed
      ? "PASS — every submission was accepted and ordinary navigation stayed responsive."
      : `INVESTIGATE — a submission was refused, a read failed, or navigation p95 exceeded both 5× idle and ${String(RESPONSIVE_P95_MS)}ms.`,
  );
  console.info("");
  console.info(`Fixture left in place for inspection: module ${module.id}, reader ${readerName}`);
  console.info(`Remove it with: DELETE ${BASE_URL}/api/modules/${module.id} as architect1`);
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exitCode = 1;
});
