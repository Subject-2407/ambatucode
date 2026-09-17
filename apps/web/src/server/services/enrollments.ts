import "server-only";
import { type Prisma, prisma } from "@ambatucode/db";
import {
  AppError,
  type AuthenticatedUser,
  type DecideEnrollmentRequest,
  type EnrollmentRequestResult,
  type EnrollmentView,
  type ListEnrollmentsQuery,
  type Paginated,
} from "@ambatucode/shared";
import { requireModuleOwner } from "../auth/guards";
import { toEnrollmentView } from "../serializers/content";

/**
 * Enrollment.
 *
 * A Public Module grants access on request; a Closed one records the request
 * and waits for the owning Architect. Which path applies is read from the
 * Module, never from anything the client sends — otherwise a Coder could ask
 * to be approved.
 */

const ENROLLMENT_SELECT = {
  id: true,
  moduleId: true,
  status: true,
  decidedAt: true,
  createdAt: true,
  user: { select: { id: true, username: true, displayName: true } },
  decidedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.ModuleEnrollmentSelect;

export async function requestEnrollment(
  actor: AuthenticatedUser,
  moduleId: string,
): Promise<EnrollmentRequestResult> {
  if (actor.role !== "CODER") {
    throw new AppError("FORBIDDEN", "Only a Coder enrolls in modules");
  }

  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, visibility: true, isPublished: true },
  });
  // An unpublished Module is not merely closed to enrollment; it is not
  // visible at all, so it answers exactly as a missing one does.
  if (!module?.isPublished) {
    throw new AppError("NOT_FOUND", "Module not found");
  }

  const existing = await prisma.moduleEnrollment.findUnique({
    where: { moduleId_userId: { moduleId, userId: actor.id } },
    select: { status: true },
  });

  // Asking twice is not an error — a Coder who reloads the page and presses
  // Enroll again should see where they stand, not a conflict.
  if (existing?.status === "APPROVED" || existing?.status === "PENDING") {
    return { moduleId, status: existing.status, canRead: existing.status === "APPROVED" };
  }

  const status = module.visibility === "PUBLIC" ? "APPROVED" : "PENDING";

  /**
   * A direct enrollment records no decider: nobody approved it, the Module's
   * visibility did. `decidedAt` still moves so the Architect's queue can sort
   * by when access was granted.
   */
  const decision =
    status === "APPROVED"
      ? { decidedAt: new Date(), decidedById: null }
      : { decidedAt: null, decidedById: null };

  await prisma.moduleEnrollment.upsert({
    where: { moduleId_userId: { moduleId, userId: actor.id } },
    // A previously rejected Coder may ask again; the request returns to
    // PENDING and the earlier decision is cleared rather than kept as a
    // permanent bar.
    create: { moduleId, userId: actor.id, status, ...decision },
    update: { status, ...decision },
  });

  return { moduleId, status, canRead: status === "APPROVED" };
}

export async function listEnrollments(
  actor: AuthenticatedUser,
  moduleId: string,
  query: ListEnrollmentsQuery,
): Promise<Paginated<EnrollmentView>> {
  await requireModuleOwner(actor, moduleId);

  const where: Prisma.ModuleEnrollmentWhereInput = {
    moduleId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          user: {
            OR: [
              { username: { contains: query.search, mode: "insensitive" } },
              { displayName: { contains: query.search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.moduleEnrollment.count({ where }),
    prisma.moduleEnrollment.findMany({
      where,
      select: ENROLLMENT_SELECT,
      // Pending requests first: the queue exists to be cleared.
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { items: rows.map(toEnrollmentView), total, page: query.page, pageSize: query.pageSize };
}

export async function decideEnrollment(
  actor: AuthenticatedUser,
  moduleId: string,
  enrollmentId: string,
  input: DecideEnrollmentRequest,
): Promise<EnrollmentView> {
  await requireModuleOwner(actor, moduleId);

  const existing = await prisma.moduleEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, moduleId: true },
  });
  // Scoped to the module in the path, so an Architect cannot decide on a
  // request belonging to someone else's module by guessing an id.
  if (!existing || existing.moduleId !== moduleId) {
    throw new AppError("NOT_FOUND", "Enrollment request not found");
  }

  const updated = await prisma.moduleEnrollment.update({
    where: { id: enrollmentId },
    data: { status: input.status, decidedById: actor.id, decidedAt: new Date() },
    select: ENROLLMENT_SELECT,
  });

  return toEnrollmentView(updated);
}
