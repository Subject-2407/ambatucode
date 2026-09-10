import "server-only";
import { prisma } from "@ambatucode/db";
import { AppError } from "@ambatucode/shared";

/**
 * Walks a content id back up to the Module that governs it.
 *
 * Every guard in this layer asks about a Module, but the routes are addressed
 * by Section, Material, or Practice Activity. Resolving that in one place is
 * what keeps the three content services asking the same question — a second
 * copy of this lookup is a second chance to forget the `isPublished` half.
 */

export async function moduleIdForSection(sectionId: string): Promise<string> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { moduleId: true },
  });
  if (!section) {
    throw new AppError("NOT_FOUND", "Section not found");
  }
  return section.moduleId;
}

export type MaterialScope = {
  materialId: string;
  sectionId: string;
  moduleId: string;
  /** False while the Architect is still writing it, which hides it from Coders. */
  isPublished: boolean;
};

export async function scopeForMaterial(materialId: string): Promise<MaterialScope> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { sectionId: true, isPublished: true, section: { select: { moduleId: true } } },
  });
  if (!material) {
    throw new AppError("NOT_FOUND", "Material not found");
  }
  return {
    materialId,
    sectionId: material.sectionId,
    moduleId: material.section.moduleId,
    isPublished: material.isPublished,
  };
}

export async function scopeForPractice(practiceId: string): Promise<MaterialScope> {
  const practice = await prisma.practiceActivity.findUnique({
    where: { id: practiceId },
    select: { materialId: true },
  });
  if (!practice) {
    throw new AppError("NOT_FOUND", "Practice activity not found");
  }
  return scopeForMaterial(practice.materialId);
}
