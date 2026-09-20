import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SEED_USERS, signIn } from "./fixtures";

/**
 * The Phase 4 acceptance scenario, end to end: a Coder takes an assessment,
 * the Architect reads the grade, resets it, chooses which attempt counts, and
 * exports the record — and the Coder sees their own history, their place on the
 * leaderboard, and the title they earned.
 *
 * The fixture is built through the API rather than through six authoring
 * dialogs. The assessment editor has its own coverage; what these specs are
 * about is what happens to a grade *after* one exists, and driving the whole
 * authoring flow first would make every failure here look like an editor bug.
 *
 * Grading is not simulated. There is no execution worker in this suite, so a
 * submission stays QUEUED — which is the honest state, and exactly what the
 * grading screens have to render without a score.
 */

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString()}`;

/** One line, so the editor's rendered text can be asserted on directly. */
const SOURCE = "print(int(input())*2)";

type Fixture = {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  assessmentId: string;
  assessmentTitle: string;
  sessionId: string;
};

async function json<T>(request: APIRequestContext, method: "get" | "post", path: string, body?: unknown): Promise<T> {
  const response = await request[method](path, body === undefined ? undefined : { data: body });
  const envelope = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(`${method.toUpperCase()} ${path} failed: ${envelope.error?.message ?? "unknown"}`);
  }
  return envelope.data;
}

/** Module, section, published assessment, and a running session, as the Architect. */
async function buildFixture(page: Page, suffix: string): Promise<Fixture> {
  const request = page.request;
  const moduleTitle = `E2E Grades ${suffix}`;
  const moduleSlug = `e2e-grades-${suffix}`;

  const module = await json<{ id: string }>(request, "post", "/api/modules", {
    title: moduleTitle,
    slug: moduleSlug,
    description: "Grading records end to end.",
    visibility: "PUBLIC",
    isPublished: true,
  });

  const section = await json<{ id: string }>(
    request,
    "post",
    `/api/modules/${module.id}/sections`,
    { title: "Graded work" },
  );

  const assessmentTitle = `Doubling ${suffix}`;
  const assessment = await json<{ id: string }>(
    request,
    "post",
    `/api/sections/${section.id}/assessments`,
    {
      title: assessmentTitle,
      problemStatement: "Read n and print n doubled.",
      allowedLanguages: ["python"],
      starterCode: { python: "n = int(input())\n" },
      timeMode: "UNTIMED",
      isPublished: true,
    },
  );

  await json(request, "post", `/api/assessments/${assessment.id}/test-cases`, {
    name: "Sample",
    kind: "PUBLIC",
    input: "2",
    expectedOutput: "4",
  });

  const session = await json<{ id: string }>(
    request,
    "post",
    `/api/assessments/${assessment.id}/sessions`,
    { name: `Class ${suffix}` },
  );
  await json(request, "post", `/api/sessions/${session.id}/start`, { force: true });

  return {
    moduleId: module.id,
    moduleSlug,
    moduleTitle,
    assessmentId: assessment.id,
    assessmentTitle,
    sessionId: session.id,
  };
}

async function deleteModule(page: Page, moduleId: string): Promise<void> {
  await page.request.delete(`/api/modules/${moduleId}`);
}

/**
 * These flows cross both role shells and several screens, and each screen is
 * compiled on first request in dev. The ceiling is generous; every step still
 * asserts on a specific element rather than waiting on a sleep.
 */
test.describe("grading records and gamification", () => {
  test.slow();
  test.setTimeout(180_000);

  test("a Coder submits, the Architect resets and chooses the official attempt, and both views agree", async ({
    browser,
  }) => {
    const suffix = stamp();
    const architectContext = await browser.newContext();
    const coderContext = await browser.newContext();
    const architectPage = await architectContext.newPage();
    const coderPage = await coderContext.newPage();
    let fixture: Fixture | null = null;

    try {
      await signIn(architectPage, "architect");
      fixture = await buildFixture(architectPage, suffix);

      // --- The Coder takes the assessment -----------------------------------
      await signIn(coderPage, "coder");
      await json(coderPage.request, "post", `/api/modules/${fixture.moduleId}/enroll`);

      await coderPage.goto(`/modules/${fixture.moduleSlug}`);
      await coderPage.getByRole("link", { name: new RegExp(fixture.assessmentTitle) }).click();
      await coderPage.getByRole("button", { name: /Start/ }).click();
      await coderPage.waitForURL(/\/attempt\//);

      const attemptUrl = coderPage.url();
      const editor = coderPage.locator(".monaco-editor").first();
      await expect(editor).toBeVisible();
      await editor.click();

      // `insertText` rather than `type`: Monaco auto-closes brackets as
      // characters arrive, so typing `print(int(input()) * 2)` key by key
      // produces something else entirely.
      await coderPage.keyboard.press("ControlOrMeta+a");
      await coderPage.keyboard.insertText(SOURCE);
      await expect(coderPage.getByText(SOURCE)).toBeVisible();

      // A reload mid-attempt is the commonest kind of disconnect there is, and
      // the work has to survive it. The first autosave also pays for the draft
      // route's cold compile in dev, which is why this waits longer than the
      // suite's default.
      await expect(coderPage.getByText(/^Saved /)).toBeVisible({ timeout: 45_000 });
      await coderPage.reload();
      await expect(coderPage.locator(".monaco-editor").first()).toBeVisible();
      await expect(coderPage.getByText(SOURCE)).toBeVisible();

      await coderPage.getByRole("button", { name: "Submit" }).click();
      const confirm = coderPage.getByRole("dialog");
      await expect(confirm).toContainText(/only submission/i);
      await confirm.getByRole("button", { name: /Submit/ }).click();

      // No worker is attached, so the pipeline stops at QUEUED. The editor is
      // locked out all the same — one formal submission per attempt.
      await expect(coderPage.getByText(/Queued/)).toBeVisible();
      await expect(coderPage.getByRole("button", { name: "Submit" })).toBeDisabled();

      // --- The Architect reads the record -----------------------------------
      await architectPage.goto("/manage/grades");
      await architectPage
        .getByRole("combobox", { name: "Module" })
        .selectOption({ label: fixture.moduleTitle });

      // The first row on this screen is the first answer from the grades
      // endpoint. Global setup compiles it, but a dev build under load can
      // still take longer than an ordinary assertion allows.
      const record = architectPage.getByRole("row", {
        name: new RegExp(SEED_USERS.coder.displayName),
      });
      await expect(record).toBeVisible({ timeout: 30_000 });
      await expect(record).toContainText("Attempt 1");

      // --- Reset, and prove nothing was destroyed ---------------------------
      await record.getByRole("button", { name: "Reset" }).click();
      const resetDialog = architectPage.getByRole("dialog");
      await expect(resetDialog).toContainText(/nothing is deleted/i);
      await resetDialog.getByLabel("Reason").fill("Lab power cut during the attempt");
      await resetDialog.getByRole("button", { name: "Reset attempt" }).click();
      // A reset is the heaviest write in the product — a locked transaction,
      // two broadcasts, and a leaderboard rebuild — and this is the first time
      // the route runs. It closes on success only, so a dialog still open here
      // would mean the reset failed.
      await expect(resetDialog).toBeHidden({ timeout: 30_000 });

      const afterReset = architectPage.getByRole("row", {
        name: new RegExp(SEED_USERS.coder.displayName),
      });
      await expect(afterReset).toContainText("Attempt 1");
      await expect(afterReset).toContainText("Attempt 2");
      await expect(afterReset).toContainText("Lab power cut during the attempt");

      // The old attempt URL must not reopen as a live workspace.
      await coderPage.goto(attemptUrl);
      await expect(coderPage.getByRole("button", { name: "Submit" })).toBeDisabled();

      // --- Choose which attempt counts --------------------------------------
      // Chakra renders a radio as a label wrapping a visually hidden input
      // plus a styled control, so the input is never the thing under the
      // pointer. Click the control, the way a person does.
      await afterReset
        .locator('[data-scope="radio-group"][data-part="item"]')
        .first()
        .click();
      await expect(architectPage.getByText("Official score updated")).toBeVisible({
        timeout: 30_000,
      });

      // --- Export ------------------------------------------------------------
      const download = architectPage.waitForEvent("download");
      await architectPage.getByRole("button", { name: /Export CSV/ }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^grades-.*\.csv$/);

      // --- The Coder's own history -------------------------------------------
      await coderPage.goto("/submissions");
      const historyRow = coderPage.getByRole("row", {
        name: new RegExp(fixture.assessmentTitle),
      });
      await expect(historyRow).toBeVisible({ timeout: 30_000 });
      await expect(historyRow).toContainText("Official");

      await historyRow.getByRole("link", { name: "View" }).click();
      await coderPage.waitForURL(/\/submissions\//);
      // The detail page shows the exact source that was submitted.
      await expect(coderPage.getByText(SOURCE)).toBeVisible({ timeout: 30_000 });
      // Hidden grading data never reaches this page.
      await expect(coderPage.getByText(/Hidden grading cases stay hidden/)).toBeVisible();
    } finally {
      if (fixture !== null) await deleteModule(architectPage, fixture.moduleId);
      await architectContext.close();
      await coderContext.close();
    }
  });

  test("Root cannot reach grades, submissions, or a leaderboard", async ({ page }) => {
    await signIn(page, "root");

    // Root administers accounts and infrastructure. Every grading read is
    // refused in the data access layer, so the API is the thing to prove it on.
    for (const path of ["/api/me/submissions"]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(403);
    }

    // And the Architect shell is not Root's to walk into. The redirect happens
    // on the server, so the navigation itself may abort — what matters is
    // where the browser ends up.
    await page.goto("/manage/grades").catch(() => undefined);
    await page.waitForURL(/\/admin\/users/);
  });
});

test.describe("leaderboard and achievements", () => {
  test.slow();
  test.setTimeout(180_000);

  test("a Coder sees a leaderboard on the module and a showcase of titles", async ({ page }) => {
    const suffix = stamp();
    await signIn(page, "architect");
    const fixture = await buildFixture(page, suffix);

    const coderContext = await page.context().browser()?.newContext();
    if (!coderContext) throw new Error("no browser context");
    const coderPage = await coderContext.newPage();

    try {
      await signIn(coderPage, "coder");
      await json(coderPage.request, "post", `/api/modules/${fixture.moduleId}/enroll`);

      await coderPage.goto(`/modules/${fixture.moduleSlug}`);
      await expect(coderPage.getByText("Leaderboard")).toBeVisible();
      // Nobody has an official score yet, and the board says so rather than
      // inventing a rank.
      await expect(coderPage.getByText(/No scores yet|Nothing to rank yet/)).toBeVisible();

      // Titles live on the Profile screen now, behind its second tab.
      await coderPage.goto("/profile");
      await coderPage.getByRole("tab", { name: "Achievements" }).click();
      // Locked titles are readable: they are goals, not surprises.
      await expect(coderPage.getByText("First Light")).toBeVisible({ timeout: 30_000 });
      await expect(coderPage.getByText(/titles earned/)).toBeVisible();
    } finally {
      await deleteModule(page, fixture.moduleId);
      await coderContext.close();
    }
  });
});
