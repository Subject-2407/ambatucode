import "server-only";
import { PRISMA_FOREIGN_KEY_VIOLATION, isPrismaErrorCode, prisma } from "@ambatucode/db";
import {
  AppError,
  type AuthenticatedUser,
  type CreateSectionRequest,
  type ReorderSectionsRequest,
  type SectionView,
  type UpdateSectionRequest,
} from "@ambatucode/shared";
import { toSectionView } from "../serializers/content";
import { moduleIdForSection } from "./content-scope";
import { assertCanRead, assertCanWrite } from "./modules";

/**
 * Sections and their ordering.
 *
 * `orderIndex` is dense and rewritten wholesale on every reorder, so it is
 * always the presentation order and never a sparse remnant of past drags.
 */

const SECTION_SELECT = {
  id: true,
  moduleId: true,
  title: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listSections(
  actor: AuthenticatedUser,
  moduleId: string,
): Promise<SectionView[]> {
  await assertCanRead(actor, moduleId);
  const rows = await prisma.section.findMany({
    where: { moduleId },
    select: SECTION_SELECT,
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(toSectionView);
}

export async function createSection(
  actor: AuthenticatedUser,
  moduleId: string,
  input: CreateSectionRequest,
): Promise<SectionView> {
  await assertCanWrite(actor, moduleId);

  // Counting and inserting in one transaction so two Sections created at once
  // cannot land on the same index.
  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.section.count({ where: { moduleId } });
    return tx.section.create({
      data: { moduleId, title: input.title, orderIndex: count },
      select: SECTION_SELECT,
    });
  });

  return toSectionView(created);
}

export async function updateSection(
  actor: AuthenticatedUser,
  sectionId: string,
  input: UpdateSectionRequest,
): Promise<SectionView> {
  await assertCanWrite(actor, await moduleIdForSection(sectionId));

  const updated = await prisma.section.update({
    where: { id: sectionId },
    data: { title: input.title },
    select: SECTION_SELECT,
  });
  return toSectionView(updated);
}

export async function deleteSection(actor: AuthenticatedUser, sectionId: string): Promise<void> {
  const moduleId = await moduleIdForSection(sectionId);
  await assertCanWrite(actor, moduleId);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.section.delete({ where: { id: sectionId } });
      // Closing the gap immediately keeps the indexes dense, so the next
      // create appends rather than colliding with a hole left behind.
      const remaining = await tx.section.findMany({
        where: { moduleId },
        select: { id: true },
        orderBy: { orderIndex: "asc" },
      });
      await Promise.all(
        remaining.map((section, index) =>
          tx.section.update({ where: { id: section.id }, data: { orderIndex: index } }),
        ),
      );
    });
  } catch (error) {
    // An Assessment that has been answered cannot be deleted, so a Section
    // holding graded history refuses to disappear with it.
    if (isPrismaErrorCode(error, PRISMA_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(
        "CONFLICT",
        "This section has graded history and cannot be deleted; unpublish it instead",
      );
    }
    throw error;
  }
}

/**
 * A reorder must name every Section in the Module exactly once.
 *
 * Rejecting a partial list is the point: a request built from a stale tree
 * would otherwise silently drop the Sections it never knew about, and a
 * duplicate id would leave two of them fighting over one index.
 */
export function assertCompleteOrdering(currentIds: string[], requestedIds: string[]): void {
  const current = new Set(currentIds);
  const requested = new Set(requestedIds);

  if (requested.size !== requestedIds.length) {
    throw new AppError("VALIDATION_FAILED", "Section ids must be unique");
  }
  if (requested.size !== current.size || requestedIds.some((id) => !current.has(id))) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Reorder must list every section in the module exactly once",
    );
  }
}

export async function reorderSections(
  actor: AuthenticatedUser,
  moduleId: string,
  input: ReorderSectionsRequest,
): Promise<SectionView[]> {
  await assertCanWrite(actor, moduleId);

  return prisma.$transaction(async (tx) => {
    const current = await tx.section.findMany({
      where: { moduleId },
      select: { id: true },
      orderBy: { orderIndex: "asc" },
    });

    assertCompleteOrdering(
      current.map((section) => section.id),
      input.sectionIds,
    );

    // One transaction, so the tree is never observed mid-shuffle.
    await Promise.all(
      input.sectionIds.map((id, index) =>
        tx.section.update({ where: { id }, data: { orderIndex: index } }),
      ),
    );

    const rows = await tx.section.findMany({
      where: { moduleId },
      select: SECTION_SELECT,
      orderBy: { orderIndex: "asc" },
    });
    return rows.map(toSectionView);
  });
}
