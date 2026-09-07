import { BookOpen, LayoutDashboard, User, Users, type LucideIcon } from "lucide-react";
import type { UserRole } from "@ambatucode/shared";
import { routes } from "@/lib/routes";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * The menu each role sees. It lists only destinations that exist today —
 * a nav entry pointing at an unbuilt screen is worse than no entry, and later
 * phases add their own as they land.
 */
const NAV_BY_ROLE: Readonly<Record<UserRole, readonly NavItem[]>> = {
  CODER: [
    { href: routes.dashboard, label: "Dashboard", icon: LayoutDashboard },
    { href: routes.profile, label: "Profile", icon: User },
  ],
  ARCHITECT: [{ href: routes.manageModules, label: "Modules", icon: BookOpen }],
  ROOT: [{ href: routes.adminUsers, label: "Users", icon: Users }],
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
