import "server-only";
import {
  PRISMA_FOREIGN_KEY_VIOLATION,
  PRISMA_UNIQUE_VIOLATION,
  type Prisma,
  isPrismaErrorCode,
  prisma,
} from "@ambatucode/db";
import {
  AppError,
  type AdminUser,
  type AuthenticatedUser,
  type CreateUserRequest,
  type ListUsersQuery,
  type Paginated,
  type UpdateUserRequest,
} from "@ambatucode/shared";
import { hashPassword } from "../auth/password";
import { revokeLiveSessions } from "../auth/session";
import { publishSessionRevoked } from "../realtime/publish";
import { toAdminUser } from "../serializers/user";

/**
 * Global account administration. Root-only, and the check lives here rather
 * than only on the route so no future caller can reach it another way.
 */

const ADMIN_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function assertRoot(actor: AuthenticatedUser): void {
  if (actor.role !== "ROOT") {
    throw new AppError("FORBIDDEN", "Only Root may administer user accounts");
  }
}

/** Kills every live session for a user and tells apps/realtime to drop them. */
async function terminateSessions(userId: string, reason: string): Promise<void> {
  const revoked = await prisma.$transaction((tx) => revokeLiveSessions(tx, userId, reason));
  await publishSessionRevoked({ sessionIds: revoked, userId, reason });
}

export async function listUsers(
  actor: AuthenticatedUser,
  query: ListUsersQuery,
): Promise<Paginated<AdminUser>> {
  assertRoot(actor);

  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.search
      ? {
          OR: [
            { username: { contains: query.search, mode: "insensitive" } },
            { displayName: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: ADMIN_USER_SELECT,
      orderBy: [{ role: "asc" }, { username: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toAdminUser),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createUser(
  actor: AuthenticatedUser,
  input: CreateUserRequest,
): Promise<AdminUser> {
  assertRoot(actor);

  const passwordHash = await hashPassword(input.password);

  try {
    const created = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        role: input.role,
        isActive: input.isActive,
      },
      select: ADMIN_USER_SELECT,
    });
    return toAdminUser(created);
  } catch (error) {
    if (isPrismaErrorCode(error, PRISMA_UNIQUE_VIOLATION)) {
      throw new AppError("CONFLICT", "Username is already taken");
    }
    throw error;
  }
}

export async function updateUser(
  actor: AuthenticatedUser,
  userId: string,
  input: UpdateUserRequest,
): Promise<AdminUser> {
  assertRoot(actor);

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "User not found");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: input,
    select: ADMIN_USER_SELECT,
  });

  // A deactivated account must lose its live session immediately, not at the
  // next expiry.
  if (input.isActive === false) {
    await terminateSessions(userId, "DEACTIVATED");
  }

  return toAdminUser(updated);
}

export async function resetUserPassword(
  actor: AuthenticatedUser,
  userId: string,
  password: string,
): Promise<void> {
  assertRoot(actor);

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "User not found");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });

  await terminateSessions(userId, "PASSWORD_RESET");
}

export async function deleteUser(actor: AuthenticatedUser, userId: string): Promise<void> {
  assertRoot(actor);

  if (actor.id === userId) {
    throw new AppError("CONFLICT", "You cannot delete your own account");
  }

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "User not found");
  }

  await terminateSessions(userId, "DELETED");

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    // Submissions, owned Modules, and graded attempts are historical records
    // and must survive. Root deactivates such an account instead of deleting.
    if (isPrismaErrorCode(error, PRISMA_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(
        "CONFLICT",
        "User has historical records and cannot be deleted; deactivate the account instead",
      );
    }
    throw error;
  }
}
