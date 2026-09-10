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
  /** The catalog a Coder browses and enrolls from. */
  modules: "/modules",
  /** Coder-facing Module pages are addressed by slug, which is the readable
   * half of the URL a Coder may end up typing or sharing. */
  module: (moduleSlug: string) => `/modules/${moduleSlug}`,
  material: (moduleSlug: string, materialId: string) =>
    `/modules/${moduleSlug}/materials/${materialId}`,

  // Architect
  manageModules: "/manage/modules",
  /** The Architect's own tree is addressed by id: a builder URL survives a
   * slug rename, which a Coder-facing link does not need to. */
  moduleBuilder: (moduleId: string) => `/manage/modules/${moduleId}/builder`,
  moduleEnrollments: (moduleId: string) => `/manage/modules/${moduleId}/enrollments`,
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
