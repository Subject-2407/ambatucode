import type { UserRole } from "@ambatucode/shared";
import type { SpriteName } from "@/components/ui/pixel-sprites";
import { routes } from "@/lib/routes";

export type NavItem = {
  href: string;
  label: string;
  icon: SpriteName;
};

/**
 * The menu each role sees. It lists only destinations that exist today —
 * a nav entry pointing at an unbuilt screen is worse than no entry, and later
 * phases add their own as they land.
 *
 * The rail shows the sprite and hides the label, so `label` is what assistive
 * technology and the hover flyout both read. It is never decorative, and it is
 * the accessible name the end-to-end suite selects on.
 */
const NAV_BY_ROLE: Readonly<Record<UserRole, readonly NavItem[]>> = {
  CODER: [
    { href: routes.dashboard, label: "Dashboard", icon: "home" },
    { href: routes.modules, label: "Modules", icon: "books" },
    { href: routes.submissions, label: "Submissions", icon: "doc" },
    { href: routes.achievements, label: "Achievements", icon: "trophy" },
    { href: routes.profile, label: "Profile", icon: "user" },
  ],
  ARCHITECT: [
    { href: routes.manageModules, label: "Modules", icon: "books" },
    { href: routes.manageGrades, label: "Grades", icon: "clipboard" },
  ],
  // Root administers users and nothing else here. No leaderboards, no grading
  // records, no Titles — the restriction is enforced in the data access layer,
  // and the navigation should not imply a door that the server will not open.
  ROOT: [{ href: routes.adminUsers, label: "Users", icon: "users" }],
};

export function navItemsForRole(role: UserRole): readonly NavItem[] {
  return NAV_BY_ROLE[role];
}

/** How a role is named in the UI. Matches the SRS vocabulary exactly. */
export const ROLE_LABEL: Readonly<Record<UserRole, string>> = {
  ROOT: "Root",
  ARCHITECT: "Architect",
  CODER: "Coder",
};
