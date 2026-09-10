import "server-only";
import { prisma } from "@ambatucode/db";
import {
  AppError,
  type AuthenticatedUser,
  type ModuleVisibility,
  type UserRole,
} from "@ambatucode/shared";
import { getSession, type SessionContext } from "./session";

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  }
  return session;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  return (await requireSession()).user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "Insufficient permissions");
  }
  return user;
}

export function requireRoot(): Promise<AuthenticatedUser> {
  return requireRole("ROOT");
}

/**
 * Root administers infrastructure and accounts but is explicitly barred from
 * grading records, participant submissions, and leaderboards. Every service
 * function that returns one of those calls this first, so the restriction
 * holds even if a route forgets to check — hiding a button is not
 * authorization, and neither is a route-level guard alone.
 */
export function assertNotRoot(user: Pick<AuthenticatedUser, "role">): void {
  if (user.role === "ROOT") {
    throw new AppError("FORBIDDEN", "Root cannot access grading, submission, or leaderboard data");
  }
}

/**
 * Enough of a Module to decide what its viewer may do with it. Loaded once by
 * the guards below and handed to the service, so a handler never pays for the
 * same row twice.
 */
export type ModuleContext = {
  id: string;
  ownerId: string;
  visibility: ModuleVisibility;
  isPublished: boolean;
};

async function loadModuleContext(moduleId: string): Promise<ModuleContext> {
  const found = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, ownerId: true, visibility: true, isPublished: true },
  });
  if (!found) {
    throw new AppError("NOT_FOUND", "Module not found");
  }
  return found;
}

/**
 * Authoring access: the Architect who owns this Module, and nobody else.
 *
 * Root is refused rather than waved through. Root administers infrastructure
 * and accounts; a Module's content belongs to the Architect who wrote it, and
 * a global administrator quietly holding edit rights over every Module is not
 * a power the SRS grants.
 */
export async function requireModuleOwner(
  actor: Pick<AuthenticatedUser, "id" | "role">,
  moduleId: string,
): Promise<ModuleContext> {
  const context = await loadModuleContext(moduleId);
  if (actor.role !== "ARCHITECT" || context.ownerId !== actor.id) {
    throw new AppError("FORBIDDEN", "Only the owning Architect may manage this module");
  }
  return context;
}

/**
 * Reading access: an approved Coder, or the owning Architect previewing their
 * own work.
 *
 * An unpublished Module answers NOT_FOUND rather than FORBIDDEN for everyone
 * else — a draft's existence is not something a Coder is entitled to infer.
 * A published Module the Coder has not joined answers FORBIDDEN instead,
 * because there the correct next step is to enroll, and saying so is the whole
 * point of a Closed module's request flow.
 */
export async function requireEnrolled(
  actor: Pick<AuthenticatedUser, "id" | "role">,
  moduleId: string,
): Promise<ModuleContext> {
  const context = await loadModuleContext(moduleId);

  if (actor.role === "ARCHITECT" && context.ownerId === actor.id) {
    return context;
  }

  if (actor.role !== "CODER" || !context.isPublished) {
    throw new AppError("NOT_FOUND", "Module not found");
  }

  const enrollment = await prisma.moduleEnrollment.findUnique({
    where: { moduleId_userId: { moduleId, userId: actor.id } },
    select: { status: true },
  });

  if (enrollment?.status !== "APPROVED") {
    throw new AppError("FORBIDDEN", "Enroll in this module to read its content");
  }

  return context;
}
