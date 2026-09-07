import { expect, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS, signIn } from "./fixtures";

test.describe("authentication", () => {
  test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("invalid credentials are rejected without revealing which field was wrong", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill(SEED_USERS.coder.username);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Scoped to the form: Next.js mounts its own role="alert" route announcer.
    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Incorrect username or password.");
    // The message must not hint at which half was wrong.
    await expect(alert).not.toContainText(/username (does not|doesn't) exist|no such user/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  for (const key of ["root", "architect", "coder"] as const) {
    test(`${key} signs in and lands on their own shell`, async ({ page }) => {
      await signIn(page, key);

      const user = SEED_USERS[key];
      await expect(page).toHaveURL(new RegExp(`${user.home}$`));
      // The shell is role-aware: the user menu carries the signed-in identity.
      await expect(page.getByText(user.displayName).first()).toBeVisible();
    });
  }

  test("a Coder cannot reach the Root administration shell", async ({ page }) => {
    await signIn(page, "coder");
    await page.goto("/admin/users");
    // Redirected back to their own home rather than shown the screen.
    await expect(page).toHaveURL(new RegExp(`${SEED_USERS.coder.home}$`));
  });

  /**
   * FR-AUTH-02 as the user experiences it: the second sign-in wins, and the
   * first browser is told why rather than silently failing its next request.
   */
  test("a second login ends the first session visibly", async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();

    try {
      const firstPage = await first.newPage();
      await signIn(firstPage, "coder");

      const secondPage = await second.newPage();
      await signIn(secondPage, "coder");

      // The first browser is told its session ended; the notice is blocking.
      await expect(firstPage.getByText("You were signed out")).toBeVisible({ timeout: 20_000 });

      await firstPage.getByRole("button", { name: "Sign in again" }).click();
      await expect(firstPage).toHaveURL(/\/login\?reason=superseded$/);
      await expect(
        firstPage.getByText(/previous session ended because this account signed in elsewhere/i),
      ).toBeVisible();

      // The second browser is unaffected.
      await expect(secondPage).toHaveURL(new RegExp(`${SEED_USERS.coder.home}$`));
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("signing out returns to the login page and clears the session", async ({ page }) => {
    await signIn(page, "root");

    await page.getByRole("button", { name: new RegExp(SEED_USERS.root.displayName) }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("the seed password is not accepted for a deactivated account shape", async ({ page }) => {
  // A username that does not exist must fail exactly like a wrong password:
  // same message, same status, so accounts cannot be enumerated.
  await page.goto("/login");
  await page.getByLabel("Username").fill("no.such.account");
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
});
