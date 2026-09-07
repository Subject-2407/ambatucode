import type { UserRole } from "@ambatucode/shared";

/**
 * Every path the UI links to, in one place.
 *
 * Route groups map to roles, and the three role trees are kept on distinct URL
 * prefixes on purpose. A Coder reads a Module at `/modules/[moduleSlug]` while
 * an Architect edits one at `/manage/modules/[moduleId]`; without the prefix
 * both groups would claim `/modules/[...]` with different parameter names,
 * which the App Router rejects outright.
 */
export const routes = {
  login: "/login",

  // Coder
  dashboard: "/dashboard",
  profile: "/profile",

  // Architect
  manageModules: "/manage/modules",
  manageGrades: "/manage/grades",

  // Root
  adminUsers: "/admin/users",
} as const;

const HOME_BY_ROLE: Readonly<Record<UserRole, string>> = {
  CODER: routes.dashboard,
  ARCHITECT: routes.manageModules,
  ROOT: routes.adminUsers,
};

/** Where a user lands after signing in, and where a wrong-shell visit sends them. */
export function homePathForRole(role: UserRole): string {
  return HOME_BY_ROLE[role];
}
