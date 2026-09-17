import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  api,
  buildAssessment,
  cleanUp,
  currentUserId,
  signedInContext,
  type AssessmentFixture,
} from "./api";
import { SEED_USERS, signIn } from "./fixtures";

/**
 * The assessment acceptance scenarios that only a browser can prove: an
 * Individual attempt surviving a network drop, a Live session from the lobby
 * to the monitor, auto-submit at the deadline, and a monitor that stays usable
 * with a full lab in it.
 *
 * There is no execution worker in this suite. Submissions stop at QUEUED,
 * which is the honest state and what these screens must render.
 */

const FIRST = "print(int(input())*2)";
const OFFLINE_EDIT = "print(int(input())+int(input()))";

/**
 * Cuts one page off from both the realtime server and HTTP, and lets it back.
 *
 * `setOffline` alone is not an outage for a WebSocket that is already open, so
 * the socket is routed and closed explicitly, and every reconnection attempt
 * made during the cut is refused the same way. HTTP — draft saves, the polling
 * fallback — is blocked by the offline emulation.
 */
class NetworkSwitch {
  private cut = false;
  private readonly open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();

  private constructor(private readonly page: Page) {}

  static async attach(page: Page): Promise<NetworkSwitch> {
    const control = new NetworkSwitch(page);
    await page.routeWebSocket(/\/socket\.io\//, (ws) => control.route(ws));
    return control;
  }

  private route(ws: WebSocketRoute): void {
    if (this.cut) {
      void ws.close();
      return;
    }
    this.open.add({ page: ws, server: ws.connectToServer() });
  }

  async drop(): Promise<void> {
    this.cut = true;
    await this.page.context().setOffline(true);
    for (const pair of this.open) {
      await pair.page.close().catch(() => undefined);
      await pair.server.close().catch(() => undefined);
    }
    this.open.clear();
  }

  async restore(): Promise<void> {
    this.cut = false;
    await this.page.context().setOffline(false);
  }
}

/** Seconds left on the workspace clock, as the Coder sees it. */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await page.getByLabel("Time remaining").textContent()) ?? "";
  const match = /(?:(\d+):)?(\d{2}):(\d{2})/.exec(text);
  if (!match) throw new Error(`no countdown in ${JSON.stringify(text)}`);
  const [, hours, minutes, seconds] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Replaces the editor buffer the way a person pasting would. */
async function writeCode(page: Page, source: string): Promise<void> {
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible();
  await editor.click();
  // `insertText` rather than `type`: Monaco auto-closes brackets per keystroke.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
  await expect(page.getByText(source)).toBeVisible();
}

async function openAssessment(page: Page, fixture: AssessmentFixture): Promise<void> {
  await page.goto(`/modules/${fixture.moduleSlug}/assessments/${fixture.assessmentId}`);
  await expect(page.getByText(fixture.assessmentTitle).first()).toBeVisible({ timeout: 30_000 });
}

async function startAttempt(page: Page, fixture: AssessmentFixture): Promise<void> {
  await openAssessment(page, fixture);
  await page.getByRole("button", { name: /^(Start|Continue)$/ }).click();
  await page.waitForURL(/\/attempt\//, { timeout: 30_000 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("assessment sessions", () => {
  test.slow();
  test.setTimeout(300_000);

  test("an Individual attempt pauses while offline and keeps what was typed during the outage", async ({
    browser,
  }) => {
    const architectContext = await browser.newContext();
    const architect = await architectContext.newPage();
    const coderContext = await browser.newContext();
    const coder = await coderContext.newPage();
    let fixture: AssessmentFixture | null = null;

    try {
      await signIn(architect, "architect");
      fixture = await buildAssessment(architect, "individual", {
        timeMode: "TIMED",
        executionMode: "INDIVIDUAL",
        durationMinutes: 30,
      });
      await api(architect.request, "post", `/api/sessions/${fixture.sessionId}/start`, {
        force: true,
      });

      await signIn(coder, "coder");
      await api(coder.request, "post", `/api/modules/${fixture.moduleId}/enroll`);
      const network = await NetworkSwitch.attach(coder);

      await startAttempt(coder, fixture);
      await expect(coder.getByText("Connected")).toBeVisible({ timeout: 30_000 });
      await writeCode(coder, FIRST);
      await expect(coder.getByText(/^Saved /)).toBeVisible({ timeout: 45_000 });

      const beforeOutage = await secondsLeft(coder);
      const outageStarted = Date.now();

      // --- The network goes --------------------------------------------------
      await network.drop();
      await expect(coder.getByText("Reconnecting…")).toBeVisible({ timeout: 30_000 });
      await expect(
        coder.getByText(/Your timer is paused and resumes when you reconnect/),
      ).toBeVisible();

      // Work typed now reaches only this browser's own copy.
      await writeCode(coder, OFFLINE_EDIT);
      await expect(coder.getByText(/^Saved /)).toBeHidden();

      // Long enough that a clock that kept running would be unmistakable.
      await coder.waitForTimeout(Math.max(0, 20_000 - (Date.now() - outageStarted)));

      // --- And comes back ----------------------------------------------------
      await network.restore();
      await expect(coder.getByText("Reconnecting…")).toBeHidden({ timeout: 45_000 });
      await expect(coder.getByText("Restored your latest code")).toBeVisible({ timeout: 30_000 });
      await expect(coder.getByText(OFFLINE_EDIT)).toBeVisible();

      // The server paused the clock, so the outage cost almost nothing. The
      // slack covers the disconnect debounce and the reconnect itself.
      const outageSeconds = (Date.now() - outageStarted) / 1000;
      await expect
        .poll(async () => beforeOutage - (await secondsLeft(coder)), { timeout: 15_000 })
        .toBeLessThan(outageSeconds - 8);

      // The work typed offline is now the server's draft, not just the browser's.
      await expect(coder.getByText(/^Saved /)).toBeVisible({ timeout: 45_000 });
      await coder.reload();
      await expect(coder.getByText(OFFLINE_EDIT)).toBeVisible({ timeout: 30_000 });

      // --- The Architect saw it happen ---------------------------------------
      await architect.goto(`/manage/sessions/${fixture.sessionId}/monitor`);
      const log = architect.getByRole("log", { name: "Session events" });
      await expect(log).toContainText("Disconnected", { timeout: 30_000 });
      await expect(log).toContainText("Timer paused");
      await expect(log).toContainText(/Reconnected|Timer resumed/);
    } finally {
      await cleanUp(architect, fixture);
      await architectContext.close();
      await coderContext.close();
    }
  });

  test("a Live session runs from the lobby through a forced start to the monitor", async ({
    browser,
  }) => {
    const architectContext = await browser.newContext();
    const architect = await architectContext.newPage();
    const coderContext = await browser.newContext();
    const coder = await coderContext.newPage();
    const absent = await signedInContext(browser, SEED_USERS.unenrolledCoder.username);
    let fixture: AssessmentFixture | null = null;

    try {
      await signIn(architect, "architect");
      fixture = await buildAssessment(architect, "live", {
        timeMode: "TIMED",
        executionMode: "LIVE",
        durationMinutes: 30,
      });

      await signIn(coder, "coder");
      const coderId = await currentUserId(coder);
      await api(coder.request, "post", `/api/modules/${fixture.moduleId}/enroll`);
      await api(absent.page.request, "post", `/api/modules/${fixture.moduleId}/enroll`);

      // Two listed participants; only one of them will turn up.
      await api(architect.request, "put", `/api/sessions/${fixture.sessionId}/participants`, {
        mode: "SELECTED",
        userIds: [coderId, absent.userId],
      });
      // A draft session is the Architect's alone; READY is what puts it in
      // front of the Coders.
      await api(architect.request, "patch", `/api/sessions/${fixture.sessionId}`, {
        status: "READY",
      });

      // --- The lobby ---------------------------------------------------------
      const network = await NetworkSwitch.attach(coder);
      await openAssessment(coder, fixture);
      await expect(coder.getByText(/starts this session for everyone at once/)).toBeVisible({
        timeout: 30_000,
      });
      await coder.getByText("I am ready").click();

      await architect.goto(`/manage/sessions/${fixture.sessionId}`);
      await expect(architect.getByText("Coder 01").first()).toBeVisible({ timeout: 30_000 });

      // --- Start with someone missing ----------------------------------------
      // Start is never disabled; the warning names who is missing.
      await architect.getByRole("button", { name: "Start session" }).click();
      const warning = architect.getByRole("dialog");
      await expect(warning).toContainText("Not all selected participants are ready", {
        timeout: 30_000,
      });
      await expect(warning).toContainText(SEED_USERS.unenrolledCoder.displayName);
      await warning.getByRole("button", { name: "Start anyway" }).click();
      await expect(architect.getByText("Session started")).toBeVisible({ timeout: 30_000 });

      // The lobby takes the Coder straight into the workspace.
      await coder.waitForURL(/\/attempt\//, { timeout: 45_000 });
      await expect(coder.getByLabel("Time remaining")).toContainText("Live", { timeout: 30_000 });
      await writeCode(coder, FIRST);
      await expect(coder.getByText(/^Saved /)).toBeVisible({ timeout: 45_000 });

      // --- A Live clock does not stop for anyone -----------------------------
      const beforeOutage = await secondsLeft(coder);
      const outageStarted = Date.now();
      await network.drop();
      await expect(
        coder.getByText(/The session clock keeps running while you are disconnected/),
      ).toBeVisible({ timeout: 30_000 });
      await coder.waitForTimeout(12_000);
      await network.restore();
      await expect(coder.getByText("Reconnecting…")).toBeHidden({ timeout: 45_000 });

      const outageSeconds = (Date.now() - outageStarted) / 1000;
      await expect
        .poll(async () => beforeOutage - (await secondsLeft(coder)), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(outageSeconds - 3);

      // --- Submit, and the monitor agrees ------------------------------------
      await coder.getByRole("button", { name: "Submit" }).click();
      const confirm = coder.getByRole("dialog");
      await expect(confirm).toContainText(/only submission/i);
      await confirm.getByRole("button", { name: /Submit/ }).click();
      await expect(coder.getByText(/Queued/).first()).toBeVisible({ timeout: 30_000 });

      await architect.getByRole("link", { name: "Monitor" }).click();
      await architect.waitForURL(/\/monitor$/);
      const participants = architect.getByRole("list", { name: "Participants" });
      const coderCard = participants.getByRole("listitem").filter({ hasText: "Coder 01" });
      await expect(coderCard).toContainText("Queued", { timeout: 30_000 });

      const log = architect.getByRole("log", { name: "Session events" });
      await expect(log).toContainText("Session started");
      await expect(log).toContainText("Started the assessment");
      await expect(log).toContainText("Disconnected");
      await expect(log).toContainText("Submitted");
      // A Live disconnect is logged and nothing more: the clock never paused.
      await expect(log).not.toContainText("Timer paused");
    } finally {
      await cleanUp(architect, fixture);
      await architectContext.close();
      await coderContext.close();
      await absent.context.close();
    }
  });

  test("at the deadline the server submits the saved draft without the Coder", async ({
    browser,
  }) => {
    const architectContext = await browser.newContext();
    const architect = await architectContext.newPage();
    const coderContext = await browser.newContext();
    const coder = await coderContext.newPage();
    let fixture: AssessmentFixture | null = null;

    try {
      await signIn(architect, "architect");
      fixture = await buildAssessment(architect, "deadline", {
        timeMode: "TIMED",
        executionMode: "INDIVIDUAL",
        durationMinutes: 1,
      });
      await api(architect.request, "post", `/api/sessions/${fixture.sessionId}/start`, {
        force: true,
      });

      await signIn(coder, "coder");
      await api(coder.request, "post", `/api/modules/${fixture.moduleId}/enroll`);
      await startAttempt(coder, fixture);
      const attemptId = /\/attempt\/([^/?#]+)/.exec(coder.url())?.[1];
      if (!attemptId) throw new Error(`no attempt id in ${coder.url()}`);

      await writeCode(coder, FIRST);
      await expect(coder.getByText(/^Saved /)).toBeVisible({ timeout: 45_000 });

      // Nothing is clicked from here on. The server's deadline job does the rest.
      const modal = coder.getByRole("dialog");
      await expect(modal).toContainText("Time is up — your work was submitted", {
        timeout: 120_000,
      });

      const attempt = await api<{ status: string; submission: { id: string } | null }>(
        coder.request,
        "get",
        `/api/attempts/${attemptId}`,
      );
      expect(attempt.status).toBe("SUBMITTED");
      expect(attempt.submission).not.toBeNull();

      const submission = await api<{ sourceCode: string; isAutoSubmitted: boolean }>(
        coder.request,
        "get",
        `/api/submissions/${attempt.submission?.id ?? ""}`,
      );
      // What was graded is exactly the draft the server held.
      expect(submission.sourceCode).toBe(FIRST);
      expect(submission.isAutoSubmitted).toBe(true);

      await modal.getByRole("button", { name: "See the result" }).click();
      await expect(modal).toBeHidden();
      // The modal blocks the page while it is open; behind it, the attempt is closed.
      await expect(coder.getByRole("button", { name: "Submit" })).toBeDisabled();
    } finally {
      await cleanUp(architect, fixture);
      await architectContext.close();
      await coderContext.close();
    }
  });

  test("the monitor stays usable with a full lab of participants", async ({ page }) => {
    let fixture: AssessmentFixture | null = null;
    const labSize = 120;

    try {
      await signIn(page, "architect");
      // Any error the monitor throws while a lab this size scrolls is a defect.
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      // Individual, because a Live session refuses to start without a real
      // participant list, and these participants are not real.
      fixture = await buildAssessment(page, "monitor", {
        timeMode: "TIMED",
        executionMode: "INDIVIDUAL",
        durationMinutes: 30,
      });
      await api(page.request, "post", `/api/sessions/${fixture.sessionId}/start`, { force: true });

      // A lab this size cannot be seeded account by account, so the snapshot
      // is filled out with synthetic rows. Everything else — the page, the
      // socket, the grid — is real.
      await page.route(`**/api/sessions/${fixture.sessionId}/monitor`, async (route) => {
        const response = await route.fetch();
        const envelope = (await response.json()) as {
          ok: boolean;
          data: { participants: unknown[] };
        };
        envelope.data.participants = Array.from({ length: labSize }, (_, index) => {
          const n = index + 1;
          return {
            userId: `synthetic-${String(n)}`,
            username: `lab${String(n).padStart(3, "0")}`,
            displayName: `Lab Coder ${String(n).padStart(3, "0")}`,
            isListed: true,
            readyState: n % 7 === 0 ? "NOT_READY" : "READY",
            connectionState: n % 11 === 0 ? "OFFLINE" : "ONLINE",
            lastSeenAt: new Date().toISOString(),
            attempt: {
              id: `synthetic-attempt-${String(n)}`,
              attemptNumber: 1,
              status: "IN_PROGRESS",
              remainingMs: 25 * 60_000 - n * 1000,
              paused: false,
            },
            submission:
              n % 5 === 0
                ? {
                    id: `synthetic-submission-${String(n)}`,
                    status: "QUEUED",
                    score: null,
                    isAutoSubmitted: false,
                    submittedAt: new Date().toISOString(),
                  }
                : null,
          };
        });
        await route.fulfill({ response, json: envelope });
      });

      await page.goto(`/manage/sessions/${fixture.sessionId}/monitor`);
      await expect(page.getByText(`Participants (${String(labSize)})`)).toBeVisible({
        timeout: 30_000,
      });

      const grid = page.getByRole("list", { name: "Participants" });
      await expect(grid.getByRole("listitem").first()).toBeVisible();

      // Virtualized: a fraction of the lab is in the document at any moment.
      const rendered = await grid.getByRole("listitem").count();
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(labSize / 3);

      // Scroll the whole grid a frame at a time and time every frame. A grid
      // that re-rendered everything per scroll would stall here.
      const worstFrameMs = await grid.evaluate(async (element) => {
        const frames: number[] = [];
        let last = performance.now();
        while (element.scrollTop + element.clientHeight < element.scrollHeight) {
          element.scrollTop += 120;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const now = performance.now();
          frames.push(now - last);
          last = now;
        }
        return Math.max(...frames);
      });
      await expect(grid.getByText("Lab Coder 120")).toBeVisible();
      expect(await grid.getByRole("listitem").count()).toBeLessThan(labSize / 3);
      // Generous for a development build; a full re-render of 120 cards per
      // step would take far longer than this on any machine.
      expect(worstFrameMs).toBeLessThan(250);
      expect(pageErrors).toEqual([]);
    } finally {
      await cleanUp(page, fixture);
    }
  });
});
