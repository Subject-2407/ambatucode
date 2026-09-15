import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { SEED_PASSWORD } from "./fixtures";

/**
 * Fixture plumbing through the HTTP API.
 *
 * Specs that are about what happens during an assessment build their Module,
 * Assessment, and Session here rather than through the authoring screens, which
 * have their own coverage. A failure in these specs should point at the
 * workspace, the session control, or the monitor — not at a dialog three
 * screens earlier.
 */

export const stamp = (): string =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString()}`;

type Method = "get" | "post" | "put" | "patch" | "delete";

/** Calls the API and unwraps its envelope, failing loudly on an error. */
export async function api<T>(
  request: APIRequestContext,
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await request[method](path, body === undefined ? undefined : { data: body });
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
  };
  if (!envelope.ok) {
    throw new Error(
      `${method.toUpperCase()} ${path} failed: ${envelope.error?.code ?? String(response.status())} ${envelope.error?.message ?? ""}`,
    );
  }
  return envelope.data as T;
}

/**
 * A browser context signed in as any seeded account, without driving the login
 * form. The form has its own spec; a second Coder who only needs a session
 * cookie should not cost a page load.
 */
export async function signedInContext(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page; userId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await api(page.request, "post", "/api/auth/login", { username, password: SEED_PASSWORD });
  const me = await api<{ user: { id: string } }>(page.request, "get", "/api/auth/me");
  return { context, page, userId: me.user.id };
}

export async function currentUserId(page: Page): Promise<string> {
  const me = await api<{ user: { id: string } }>(page.request, "get", "/api/auth/me");
  return me.user.id;
}

export type Timing =
  | { timeMode: "UNTIMED" }
  | { timeMode: "TIMED"; executionMode: "LIVE" | "INDIVIDUAL"; durationMinutes: number };

export type AssessmentFixture = {
  moduleId: string;
  moduleSlug: string;
  assessmentId: string;
  assessmentTitle: string;
  sessionId: string;
};

/**
 * A published Module with one Assessment and one Session, as the Architect
 * signed in on `page`. The session is created but not started.
 */
export async function buildAssessment(
  page: Page,
  label: string,
  timing: Timing,
): Promise<AssessmentFixture> {
  const suffix = stamp();
  const moduleSlug = `e2e-${label}-${suffix}`;
  const module = await api<{ id: string }>(page.request, "post", "/api/modules", {
    title: `E2E ${label} ${suffix}`,
    slug: moduleSlug,
    description: "Assessment session end to end.",
    visibility: "PUBLIC",
    isPublished: true,
  });
  const section = await api<{ id: string }>(
    page.request,
    "post",
    `/api/modules/${module.id}/sections`,
    { title: "Assessed work" },
  );

  const assessmentTitle = `Doubling ${label} ${suffix}`;
  const assessment = await api<{ id: string }>(
    page.request,
    "post",
    `/api/sections/${section.id}/assessments`,
    {
      title: assessmentTitle,
      problemStatement: "Read n and print n doubled.",
      allowedLanguages: ["python"],
      starterCode: { python: "n = int(input())\n" },
      isPublished: true,
      ...(timing.timeMode === "UNTIMED"
        ? { timeMode: "UNTIMED" }
        : {
            timeMode: "TIMED",
            executionMode: timing.executionMode,
            durationMinutes: timing.durationMinutes,
          }),
    },
  );
  await api(page.request, "post", `/api/assessments/${assessment.id}/test-cases`, {
    name: "Sample",
    kind: "PUBLIC",
    input: "2",
    expectedOutput: "4",
  });

  const session = await api<{ id: string }>(
    page.request,
    "post",
    `/api/assessments/${assessment.id}/sessions`,
    { name: `Class ${suffix}` },
  );

  return {
    moduleId: module.id,
    moduleSlug,
    assessmentId: assessment.id,
    assessmentTitle,
    sessionId: session.id,
  };
}

/** Ends the session if it is still running, then removes the Module. Best effort. */
export async function cleanUp(page: Page, fixture: AssessmentFixture | null): Promise<void> {
  if (fixture === null) return;
  await page.request.post(`/api/sessions/${fixture.sessionId}/end`).catch(() => undefined);
  await page.request.delete(`/api/modules/${fixture.moduleId}`).catch(() => undefined);
}
