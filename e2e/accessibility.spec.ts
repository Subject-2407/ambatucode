import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { api, buildAssessment, cleanUp, type AssessmentFixture } from "./api";
import { signIn, type SeedUserKey } from "./fixtures";

/**
 * The accessibility pass: every primary screen, for every role, in both
 * themes, checked against WCAG 2.1 A and AA — including 4.5:1 contrast, which
 * is the rule a theme change most easily breaks.
 *
 * Monaco's own DOM and the inside of an Interactive Block frame are excluded.
 * Neither is markup this application writes: Monaco is a vendored editor with
 * its own accessibility model, and a block's content is Architect-authored and
 * isolated by design. The chrome around both is still checked.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;

type Screen = {
  name: string;
  role: SeedUserKey;
  path: (fixture: Fixture) => string;
  ready: string | RegExp;
};

type Fixture = AssessmentFixture & { materialId: string; attemptId: string };

const SCREENS: Screen[] = [
  { name: "login", role: "coder", path: () => "/login", ready: "Sign in" },
  { name: "dashboard", role: "coder", path: () => "/dashboard", ready: /Dashboard|Welcome/ },
  { name: "module catalog", role: "coder", path: () => "/modules", ready: "Modules" },
  {
    name: "module overview",
    role: "coder",
    path: (f) => `/modules/${f.moduleSlug}`,
    ready: "Leaderboard",
  },
  {
    name: "material reader",
    role: "coder",
    path: (f) => `/modules/${f.moduleSlug}/materials/${f.materialId}`,
    ready: "Reading an accessible page",
  },
  {
    name: "assessment",
    role: "coder",
    path: (f) => `/modules/${f.moduleSlug}/assessments/${f.assessmentId}`,
    ready: "Sessions",
  },
  {
    name: "attempt workspace",
    role: "coder",
    path: (f) => `/attempt/${f.attemptId}`,
    ready: "Submit",
  },
  { name: "submissions", role: "coder", path: () => "/submissions", ready: "Submissions" },
  { name: "profile", role: "coder", path: () => "/profile", ready: "Profile" },
  { name: "manage modules", role: "architect", path: () => "/manage/modules", ready: "Modules" },
  {
    name: "module builder",
    role: "architect",
    path: (f) => `/manage/modules/${f.moduleId}/builder`,
    ready: "Assessed work",
  },
  {
    name: "assessment editor",
    role: "architect",
    path: (f) => `/manage/assessments/${f.assessmentId}`,
    ready: "Problem",
  },
  {
    name: "session control",
    role: "architect",
    path: (f) => `/manage/sessions/${f.sessionId}`,
    ready: "Readiness",
  },
  { name: "monitor index", role: "architect", path: () => "/manage/monitor", ready: "Monitor" },
  {
    name: "live monitor",
    role: "architect",
    path: (f) => `/manage/sessions/${f.sessionId}/monitor`,
    ready: "Events",
  },
  { name: "grading records", role: "architect", path: () => "/manage/grades", ready: "Grades" },
  {
    name: "enrollments",
    role: "architect",
    path: (f) => `/manage/modules/${f.moduleId}/enrollments`,
    ready: "Enrollments",
  },
  { name: "user administration", role: "root", path: () => "/admin/users", ready: "Users" },
];

async function buildFixture(page: Page, coder: Page): Promise<Fixture> {
  const base = await buildAssessment(page, "a11y", { timeMode: "UNTIMED" });
  const module = await api<{ sections: { id: string }[] }>(
    page.request,
    "get",
    `/api/modules/${base.moduleId}`,
  );
  const sectionId = module.sections[0]?.id;
  if (!sectionId) throw new Error("the fixture module has no section");

  const material = await api<{ id: string }>(
    page.request,
    "post",
    `/api/sections/${sectionId}/materials`,
    {
      title: "Reading an accessible page",
      isPublished: true,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Why contrast matters" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Text has to be readable in both themes, for everyone." },
            ],
          },
        ],
      },
    },
  );
  await api(page.request, "post", `/api/sessions/${base.sessionId}/start`, { force: true });

  await api(coder.request, "post", `/api/modules/${base.moduleId}/enroll`);
  const attempt = await api<{ id: string }>(
    coder.request,
    "post",
    `/api/sessions/${base.sessionId}/attempt/start`,
  );
  return { ...base, materialId: material.id, attemptId: attempt.id };
}

async function scan(
  browser: Browser,
  screen: Screen,
  fixture: Fixture,
  theme: (typeof THEMES)[number],
) {
  const context = await browser.newContext({ colorScheme: theme });
  const page = await context.newPage();
  try {
    if (screen.name !== "login") await signIn(page, screen.role);
    await page.goto(screen.path(fixture));
    await expect(page.getByText(screen.ready).first()).toBeVisible({ timeout: 30_000 });
    // Judge the colours a person settles on, not a frame caught mid-fade: a
    // button easing from its disabled look reads as low contrast for 200 ms.
    await page.addStyleTag({
      content:
        "*, *::before, *::after { transition: none !important; animation: none !important; }",
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG)
      .exclude(".monaco-editor")
      .exclude("iframe")
      .analyze();

    return Promise.all(
      results.violations.map(async (violation) => ({
        screen: screen.name,
        theme,
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: await Promise.all(
          violation.nodes.slice(0, 5).map(async (node) => ({
            target: node.target.join(" "),
            // The text is what lets a person find the element on the screen;
            // generated class names do not.
            text: await page
              .locator(String(node.target[0]))
              .first()
              .innerText({ timeout: 2_000 })
              .then((value) => value.slice(0, 80))
              .catch(() => ""),
            html: node.html.slice(0, 200),
            summary: node.failureSummary?.split("\n").slice(0, 3).join(" "),
          })),
        ),
      })),
    );
  } finally {
    await context.close();
  }
}

test.describe("accessibility", () => {
  test.slow();
  test.setTimeout(600_000);

  test("every primary screen meets WCAG 2.1 AA in both themes", async ({ browser }, testInfo) => {
    const architectContext = await browser.newContext();
    const architect = await architectContext.newPage();
    const coderContext = await browser.newContext();
    const coder = await coderContext.newPage();
    let fixture: Fixture | null = null;

    try {
      await signIn(architect, "architect");
      await signIn(coder, "coder");
      fixture = await buildFixture(architect, coder);

      // A11Y_SCREENS="grading records,achievements" narrows a run while fixing.
      const only = process.env.A11Y_SCREENS?.split(",").map((name) => name.trim());
      const violations = [];
      for (const screen of SCREENS.filter((entry) => !only || only.includes(entry.name))) {
        for (const theme of THEMES) {
          violations.push(...(await scan(browser, screen, fixture, theme)));
        }
      }

      // --- The keyboard ------------------------------------------------------
      // Submit has a shortcut, and a shortcut must never submit on its own:
      // it opens the same confirmation, with focus inside it, and Escape
      // backs out with nothing sent.
      //
      // Signed in again first: every scan above opened its own session for
      // the same seeded Coder, and one active session per account means the
      // last of them ended this page's.
      await signIn(coder, "coder");
      await coder.goto(`/attempt/${fixture.attemptId}`);
      await expect(coder.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
      await coder.locator(".monaco-editor").first().click();
      await coder.keyboard.press("ControlOrMeta+Shift+Enter");
      const confirm = coder.getByRole("dialog");
      await expect(confirm).toContainText(/only submission/i);
      await expect
        .poll(() => confirm.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true);
      // Focus stays trapped: tabbing through the dialog never leaves it.
      for (let step = 0; step < 6; step += 1) {
        await coder.keyboard.press("Tab");
        expect(await confirm.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
          true,
        );
      }
      await coder.keyboard.press("Escape");
      await expect(confirm).toBeHidden();
      await expect(coder.getByRole("button", { name: "Submit" })).toBeEnabled();

      await testInfo.attach("axe-violations.json", {
        body: JSON.stringify(violations, null, 2),
        contentType: "application/json",
      });
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    } finally {
      await cleanUp(architect, fixture);
      await architectContext.close();
      await coderContext.close();
    }
  });
});
