import { expect, test, type Locator, type Page } from "@playwright/test";
import { SEED_USERS, signIn } from "./fixtures";

/**
 * The Phase 2 acceptance scenario, end to end against the real database: an
 * Architect builds a module, and a Coder enrolls, reads it, and runs practice
 * code inside it.
 *
 * Each test creates the module it needs and deletes it afterwards, rather than
 * leaning on the seed. Enrollment is a stored decision — a spec that enrolled a
 * seeded Coder in a seeded module would pass once and then find the button gone
 * on every later run.
 */

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString()}`;

/**
 * Clicks a checkbox the way a person does.
 *
 * Chakra renders one as a label wrapping a visually hidden input plus a styled
 * control, so the input itself is never the thing under the pointer — clicking
 * it directly is intercepted by the control that sits on top.
 */
async function toggleCheckbox(scope: Page | Locator, label: RegExp): Promise<void> {
  await scope
    .locator('[data-scope="checkbox"][data-part="root"]')
    .filter({ hasText: label })
    .click();
}

async function createModule(
  page: Page,
  options: { title: string; slug: string; closed?: boolean },
): Promise<void> {
  await page.goto("/manage/modules");
  await page.getByRole("button", { name: "New module" }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(options.title);
  await dialog.getByLabel("Slug").fill(options.slug);
  if (options.closed) {
    await dialog.getByLabel("Visibility").selectOption("CLOSED");
  }
  await toggleCheckbox(dialog, /Published/);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
}

async function openBuilder(page: Page, title: string): Promise<void> {
  await page.goto("/manage/modules");
  await page
    .getByRole("row", { name: new RegExp(title) })
    .getByRole("link", { name: "Builder" })
    .click();
  await page.waitForURL(/\/builder$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function addSection(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Add section" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Add section" }).click();
  await expect(dialog).toBeHidden();
}

async function addMaterial(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Add material" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Add material" }).click();
  await expect(dialog).toBeHidden();
}

async function deleteModule(page: Page, title: string): Promise<void> {
  await page.goto("/manage/modules");
  await page.getByRole("button", { name: `Delete ${title}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("row", { name: new RegExp(title) })).toBeHidden();
}

/**
 * These flows cross several screens and load the editor, so they need more than
 * the suite's default budget. The generosity is in the ceiling, not in waiting:
 * every step still asserts on a specific element.
 */
test.describe("content and practice", () => {
  test.slow();

  test("an Architect builds a module and a Coder enrolls, reads it, and runs practice", async ({
    browser,
  }) => {
    const suffix = stamp();
    const title = `E2E Public ${suffix}`;
    const slug = `e2e-public-${suffix}`;
    const materialTitle = "Reading input";
    const practiceTitle = "Greet the caller";

    const architectContext = await browser.newContext();
    const coderContext = await browser.newContext();

    try {
      const architect = await architectContext.newPage();
      await signIn(architect, "architect");

      await test.step("the Architect builds the module", async () => {
        await createModule(architect, { title, slug });
        await openBuilder(architect, title);
        await addSection(architect, "Getting started");
        await addMaterial(architect, materialTitle);

        // Written, published, saved — a draft material is invisible to Coders.
        await toggleCheckbox(architect, /^Published$/);
        await architect.getByRole("button", { name: "Save" }).click();
        await expect(architect.getByText(/^Saved /)).toBeVisible();
      });

      await test.step("the Architect embeds a practice activity", async () => {
        await architect.getByRole("button", { name: "Add practice" }).click();
        const dialog = architect.getByRole("dialog");

        await dialog.getByLabel("Title").fill(practiceTitle);
        await dialog.getByLabel("Prompt").fill("Read a name and greet it.");
        await dialog.getByLabel("Name").fill("Ordinary name");
        await dialog.getByLabel("Input for Ordinary name").fill("Ada\n");
        await dialog.getByLabel("Expected output for Ordinary name").fill("Hello, Ada!");
        await dialog.getByRole("button", { name: "Save" }).click();

        await expect(dialog).toBeHidden();
        await expect(architect.getByText(practiceTitle)).toBeVisible();
      });

      const coder = await coderContext.newPage();
      await signIn(coder, "unenrolledCoder");

      await test.step("the Coder finds the module and enrolls", async () => {
        await coder.goto("/modules");
        await coder.getByLabel("Search modules").fill(title);

        // A Public module grants access on the spot.
        const card = coder.getByRole("article", { name: title });
        await card.getByRole("button", { name: "Enroll" }).click();
        await expect(card.getByRole("link", { name: "Open module" })).toBeVisible();
      });

      await test.step("the Coder reads the material and runs the practice code", async () => {
        await coder
          .getByRole("article", { name: title })
          .getByRole("link", { name: "Open module" })
          .click();
        await coder.waitForURL(`**/modules/${slug}`);

        await coder.getByRole("link", { name: new RegExp(materialTitle) }).click();
        await expect(coder.getByRole("heading", { name: materialTitle })).toBeVisible();
        await expect(coder.getByText(practiceTitle)).toBeVisible();

        await coder.getByRole("button", { name: "Run" }).click();

        /**
         * Either outcome proves the pipeline accepted the run: the waiting
         * state when no execution worker is attached, or a real per-case
         * result when one is. Asserting only the terminal result would make
         * this spec depend on a Go worker and a built sandbox image, which the
         * rest of the suite does not need.
         */
        await expect(
          coder.getByText(/Waiting for the sandbox|of \d+ passed|error|No result/i).first(),
        ).toBeVisible({ timeout: 20_000 });
      });

      await test.step("the Architect removes what the test created", async () => {
        await deleteModule(architect, title);
      });
    } finally {
      await architectContext.close();
      await coderContext.close();
    }
  });
});

test.describe("closed enrollment", () => {
  test.slow();

  test("a Closed module holds the Coder until the Architect approves", async ({ browser }) => {
    const suffix = stamp();
    const title = `E2E Closed ${suffix}`;
    const slug = `e2e-closed-${suffix}`;

    const architectContext = await browser.newContext();
    const coderContext = await browser.newContext();

    try {
      const architect = await architectContext.newPage();
      await signIn(architect, "architect");
      await createModule(architect, { title, slug, closed: true });
      await openBuilder(architect, title);
      await addSection(architect, "Locked");
      await addMaterial(architect, "Behind approval");
      await toggleCheckbox(architect, /^Published$/);
      await architect.getByRole("button", { name: "Save" }).click();
      await expect(architect.getByText(/^Saved /)).toBeVisible();

      const coder = await coderContext.newPage();
      await signIn(coder, "unenrolledCoder");

      await test.step("asking produces a pending request, not access", async () => {
        await coder.goto("/modules");
        await coder.getByLabel("Search modules").fill(title);
        const card = coder.getByRole("article", { name: title });
        await card.getByRole("button", { name: "Request access" }).click();
        await expect(card.getByText("Awaiting approval")).toBeVisible();

        // The module page is reachable — that is where the request lives — but
        // nothing inside it is.
        await coder.goto(`/modules/${slug}`);
        await expect(coder.getByText("Waiting for approval")).toBeVisible();
        await expect(coder.getByRole("link", { name: /Behind approval/ })).toBeHidden();
      });

      await test.step("the Architect approves from the queue", async () => {
        await architect.goto("/manage/modules");
        await architect
          .getByRole("row", { name: new RegExp(title) })
          .getByRole("link", { name: "Enrollments" })
          .click();
        await architect.waitForURL(/\/enrollments$/);

        const row = architect.getByRole("row", {
          name: new RegExp(SEED_USERS.unenrolledCoder.username),
        });
        await expect(row).toBeVisible();
        await row.getByRole("button", { name: "Approve" }).click();

        // The queue is filtered to Pending, so a decided request leaves it.
        await expect(architect.getByText("Nothing waiting")).toBeVisible();
        await architect.getByRole("tab", { name: "Approved" }).click();
        await expect(
          architect.getByRole("row", { name: new RegExp(SEED_USERS.unenrolledCoder.username) }),
        ).toBeVisible();
      });

      await test.step("the Coder can now read it", async () => {
        await coder.reload();
        await expect(coder.getByRole("link", { name: /Behind approval/ })).toBeVisible();
      });

      await deleteModule(architect, title);
    } finally {
      await architectContext.close();
      await coderContext.close();
    }
  });
});

test.describe("module builder", () => {
  test.slow();

  test("sections can be reordered, and the new order survives a reload", async ({ page }) => {
    const suffix = stamp();
    const title = `E2E Order ${suffix}`;
    const slug = `e2e-order-${suffix}`;

    await signIn(page, "architect");
    await createModule(page, { title, slug });
    await openBuilder(page, title);
    await addSection(page, "Alpha");
    await addSection(page, "Beta");

    // Both handles have to be on screen before dragging: the tree refetches
    // after each create, and the handles stay disabled until it settles.
    const grips = page.getByRole("button", { name: /^Reorder / });
    await expect(grips).toHaveCount(2);
    await expect(grips.nth(0)).toHaveAccessibleName("Reorder Alpha");

    // Keyboard dragging, which dnd-kit supports through its keyboard sensor.
    // Reordering must not require a pointer.
    await grips.nth(0).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);

    await expect(grips.nth(0)).toHaveAccessibleName("Reorder Beta");

    // The order is only real once the server has it.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Reorder / }).nth(0)).toHaveAccessibleName(
      "Reorder Beta",
    );

    await deleteModule(page, title);
  });
});
