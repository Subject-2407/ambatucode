import "server-only";
import { prisma, toJsonInput } from "@ambatucode/db";
import {
  AppError,
  EMPTY_RICH_TEXT_DOCUMENT,
  type AuthenticatedUser,
  type CreateMaterialRequest,
  type MaterialDetail,
  type MaterialSummary,
  type UpdateMaterialRequest,
} from "@ambatucode/shared";
import {
  toMaterialDetail,
  toMaterialSummary,
  toPracticeActivityView,
} from "../serializers/content";
import { moduleIdForSection, scopeForMaterial } from "./content-scope";
import { assertInteractiveBlocksValid } from "./interactive-blocks";
import { assertCanRead, assertCanWrite } from "./modules";

/**
 * Materials — the instructional half of a Section.
 *
 * `isPublished` is a real boundary, not a badge: an unpublished Material
 * answers NOT_FOUND for a Coder, because a draft the Architect is still
 * writing is not content that exists yet as far as the reader is concerned.
 *
 * A Material is also the only place an Interactive Block may live, so it is
 * the only write path that validates one. The block and its surrounding prose
 * save together, which is what keeps them atomic: one save, one version, and
 * no orphan row when a block is deleted from the document.
 */

const MATERIAL_SELECT = {
  id: true,
  sectionId: true,
  title: true,
  orderIndex: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { practiceActivities: true } },
} as const;

const MATERIAL_DETAIL_SELECT = {
  ...MATERIAL_SELECT,
  contentJson: true,
  practiceActivities: {
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      materialId: true,
      title: true,
      orderIndex: true,
      prompt: true,
      allowedLanguages: true,
      starterCodeJson: true,
      timeLimitMs: true,
      memoryLimitMb: true,
      testCasesJson: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

export async function listMaterials(
  actor: AuthenticatedUser,
  sectionId: string,
): Promise<MaterialSummary[]> {
  const moduleId = await moduleIdForSection(sectionId);
  const { isOwner } = await assertCanRead(actor, moduleId);

  const rows = await prisma.material.findMany({
    where: { sectionId, ...(isOwner ? {} : { isPublished: true }) },
    select: MATERIAL_SELECT,
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(toMaterialSummary);
}

export async function getMaterial(
  actor: AuthenticatedUser,
  materialId: string,
): Promise<MaterialDetail> {
  const scope = await scopeForMaterial(materialId);
  const { isOwner } = await assertCanRead(actor, scope.moduleId);
  if (!scope.isPublished && !isOwner) {
    throw new AppError("NOT_FOUND", "Material not found");
  }

  const row = await prisma.material.findUniqueOrThrow({
    where: { id: materialId },
    select: MATERIAL_DETAIL_SELECT,
  });

  return toMaterialDetail(row, row.practiceActivities.map(toPracticeActivityView));
}

export async function createMaterial(
  actor: AuthenticatedUser,
  sectionId: string,
  input: CreateMaterialRequest,
): Promise<MaterialSummary> {
  const moduleId = await moduleIdForSection(sectionId);
  await assertCanWrite(actor, moduleId);

  if (input.content) assertInteractiveBlocksValid(input.content, { origin: "request" });

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.material.count({ where: { sectionId } });
    return tx.material.create({
      data: {
        sectionId,
        title: input.title,
        orderIndex: count,
        contentJson: toJsonInput(input.content ?? EMPTY_RICH_TEXT_DOCUMENT),
        isPublished: input.isPublished,
      },
      select: MATERIAL_SELECT,
    });
  });

  return toMaterialSummary(created);
}

export async function updateMaterial(
  actor: AuthenticatedUser,
  materialId: string,
  input: UpdateMaterialRequest,
): Promise<MaterialSummary> {
  const scope = await scopeForMaterial(materialId);
  await assertCanWrite(actor, scope.moduleId);

  if (input.content) assertInteractiveBlocksValid(input.content, { origin: "request" });

  const updated = await prisma.material.update({
    where: { id: materialId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.content === undefined ? {} : { contentJson: toJsonInput(input.content) }),
      ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
    },
    select: MATERIAL_SELECT,
  });
  return toMaterialSummary(updated);
}

export async function deleteMaterial(actor: AuthenticatedUser, materialId: string): Promise<void> {
  const scope = await scopeForMaterial(materialId);
  await assertCanWrite(actor, scope.moduleId);

  // Practice Activities cascade with the Material. Nothing graded hangs off
  // one, so unlike a Section this delete has no history to protect.
  await prisma.$transaction(async (tx) => {
    await tx.material.delete({ where: { id: materialId } });
    const remaining = await tx.material.findMany({
      where: { sectionId: scope.sectionId },
      select: { id: true },
      orderBy: { orderIndex: "asc" },
    });
    await Promise.all(
      remaining.map((material, index) =>
        tx.material.update({ where: { id: material.id }, data: { orderIndex: index } }),
      ),
    );
  });
}
