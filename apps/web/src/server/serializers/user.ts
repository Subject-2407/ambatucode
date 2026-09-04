import "server-only";
import type { AdminUser, AuthenticatedUser, UserRole } from "@ambatucode/shared";

/**
 * Serializers are the only place a database row becomes a response body.
 * Going through them keeps `passwordHash` and every other internal column from
 * ever reaching the wire by accident.
 */

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
};

type AdminUserRow = UserRow & {
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
  };
}

/** Root-facing account view. Carries no grading, submission, or score data. */
export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
