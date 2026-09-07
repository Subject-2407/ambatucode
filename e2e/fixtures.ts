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
