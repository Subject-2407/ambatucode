import "server-only";
import { prisma } from "@ambatucode/db";
import type {
  AuthenticatedUser,
  ModuleItemKind,
  ModuleItemRef,
  NextModuleItem,
} from "@ambatucode/shared";
import { assertCanRead } from "./modules";

/**
 * Where a Coder goes next.
 *
 * The Module overview already lays its contents out in one order — the
 * Materials of a Section, then its Assessments, then the next Section — and a
 * Coder reads it that way. Until now the only way to follow that order was to
 * go back to the overview and find your place in it again, once per item.
 *
 * The sequence is rebuilt here from the same rows the overview renders, rather
 * than stored, because it is entirely derived: reordering a Section changes it,
 * publishing a Material changes it, and a stored copy would be a second answer
 * to drift from the first.
 */

/**
 * Unpublished items are absent for a Coder and present for the owner, which is
 * the same rule the overview uses. It matters here: a Next that skipped a
 * Material for the Architect previewing their own Module would be lying about
 * what a Coder will walk through.
 */
export async function moduleSequence(
  actor: AuthenticatedUser,
  moduleId: string,
): Promise<{ moduleSlug: string; items: ModuleItemRef[] }> {
  const { isOwner } = await assertCanRead(actor, moduleId);
  const published = isOwner ? {} : { isPublished: true };

  const module = await prisma.module.findUniqueOrThrow({
    where: { id: moduleId },
    select: {
      slug: true,
      sections: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          materials: {
            where: published,
            orderBy: { orderIndex: "asc" },
            select: { id: true, title: true },
          },
          assessments: {
            where: published,
            orderBy: { orderIndex: "asc" },
            select: { id: true, title: true },
          },
        },
      },
    },
  });

  const items: ModuleItemRef[] = [];
  for (const section of module.sections) {
    for (const material of section.materials) {
      items.push({
        kind: "MATERIAL",
        id: material.id,
        title: material.title,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
    for (const assessment of section.assessments) {
      items.push({
        kind: "ASSESSMENT",
        id: assessment.id,
        title: assessment.title,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }

  return { moduleSlug: module.slug, items };
}

/**
 * The item after this one, or null at the end of the Module.
 *
 * An item that is not in the sequence — one the reader may not see, or one that
 * has just been unpublished — answers null rather than the first item. Sending
 * a Coder back to the beginning of the Module because their current page went
 * away is worse than offering them the way out to the overview.
 */
export async function nextModuleItem(
  actor: AuthenticatedUser,
  moduleId: string,
  from: { kind: ModuleItemKind; id: string },
): Promise<NextModuleItem> {
  const { moduleSlug, items } = await moduleSequence(actor, moduleId);
  const index = items.findIndex((item) => item.kind === from.kind && item.id === from.id);
  return { moduleSlug, next: index < 0 ? null : (items[index + 1] ?? null) };
}
