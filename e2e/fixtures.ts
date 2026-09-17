import type { Page } from "@playwright/test";

/**
 * The accounts `pnpm db:seed` creates. Keeping them here means a seed change
 * breaks one file rather than every spec.
 */
export const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Ambatucode123!";

export const SEED_USERS = {
  root: { username: "root", displayName: "System Root", home: "/admin/users" },
  architect: { username: "architect1", displayName: "Architect One", home: "/manage/modules" },
  coder: { username: "coder01", displayName: "Coder 01", home: "/dashboard" },
  /** Owns the seeded Closed module, so approval flows have a second Architect. */
  architectTwo: { username: "architect2", displayName: "Architect Two", home: "/manage/modules" },
  /**
   * Enrolled in nothing by the seed, which is exactly what the enrollment specs
   * need: a Coder who still has to ask.
   */
  unenrolledCoder: { username: "coder10", displayName: "Coder 10", home: "/dashboard" },
} as const;

export type SeedUserKey = keyof typeof SEED_USERS;

export async function signIn(page: Page, key: SeedUserKey): Promise<void> {
  const user = SEED_USERS[key];
  await page.goto("/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${user.home}`);
}

/** Signs out through the user menu, the way a person would. */
export async function signOut(page: Page, key: SeedUserKey): Promise<void> {
  await page.getByRole("button", { name: new RegExp(SEED_USERS[key].displayName) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}
