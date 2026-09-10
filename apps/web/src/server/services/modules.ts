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
  moduleSlugSchema,
  type AuthenticatedUser,
  type CreateModuleRequest,
  type ListModulesQuery,
  type ModuleDetail,
  type ModuleSummary,
  type ModuleViewerState,
  type Paginated,
  type UpdateModuleRequest,
} from "@ambatucode/shared";
import { requireEnrolled, requireModuleOwner } from "../auth/guards";
import { toModuleDetail, toModuleSectionViews, toModuleSummary } from "../serializers/content";

/**
 * Module lifecycle and the catalog a Coder browses.
 *
 * Every read here decides what the viewer may see from the row itself rather
 * than from the caller's word for it, so a future caller cannot reach this
 * from a route that forgot a guard.
 */

/**
 * Root administers accounts and infrastructure, not learning content. Refusing
 * at the service boundary — not merely in the navigation — is what makes that
 * a rule rather than a convention.
 */
function assertContentAudience(actor: Pick<AuthenticatedUser, "role">): void {
  if (actor.role === "ROOT") {
    throw new AppError("FORBIDDEN", "Root does not take part in learning content");
  }
}

/** The viewer's own enrollment row travels with every module read. */
function moduleSelect(viewerId: string) {
  return {
    id: true,
    title: true,
    slug: true,
    description: true,
    visibility: true,
    isPublished: true,
    ownerId: true,
    createdAt: true,
    updatedAt: true,
    owner: { select: { id: true, displayName: true } },
    _count: { select: { sections: true } },
    enrollments: {
      where: { userId: viewerId },
      select: { status: true },
      take: 1,
    },
  } satisfies Prisma.ModuleSelect;
}

type ModuleRowWithViewer = Prisma.ModuleGetPayload<{ select: ReturnType<typeof moduleSelect> }>;

function viewerStateFor(
  actor: Pick<AuthenticatedUser, "id" | "role">,
  row: ModuleRowWithViewer,
): ModuleViewerState {
  const isOwner = actor.role === "ARCHITECT" && row.ownerId === actor.id;
  const enrollmentStatus = row.enrollments[0]?.status ?? null;
  return {
    isOwner,
    enrollmentStatus,
    canRead: isOwner || (row.isPublished && enrollmentStatus === "APPROVED"),
  };
}

/**
 * A readable slug derived from the title, used when the Architect does not
 * supply one. Collisions are left to the unique index rather than guessed at
 * with a counter — two Modules called the same thing is a naming decision, and
 * silently creating "binary-search-2" hides it.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const parsed = moduleSlugSchema.safeParse(base);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Title does not produce a usable slug; provide one");
  }
  return parsed.data;
}

export async function listModules(
  actor: AuthenticatedUser,
  query: ListModulesQuery,
): Promise<Paginated<ModuleSummary>> {
  assertContentAudience(actor);

  const search = query.search
    ? {
        OR: [
          { title: { contains: query.search, mode: "insensitive" as const } },
          { description: { contains: query.search, mode: "insensitive" as const } },
        ],
      }
    : {};

  let where: Prisma.ModuleWhereInput;
  switch (query.scope) {
    case "owned":
      if (actor.role !== "ARCHITECT") {
        throw new AppError("FORBIDDEN", "Only an Architect owns modules");
      }
      where = { ownerId: actor.id, ...search };
      break;
    case "enrolled":
      if (actor.role !== "CODER") {
        throw new AppError("FORBIDDEN", "Only a Coder enrolls in modules");
      }
      where = {
        isPublished: true,
        enrollments: { some: { userId: actor.id, status: "APPROVED" } },
        ...search,
      };
      break;
    default:
      // The catalog lists Closed modules too. Closed governs who may enter,
      // not who may know it exists — a Coder cannot request access to a module
      // the catalog hides from them.
      where = { isPublished: true, ...search };
      break;
  }

  const [total, rows] = await prisma.$transaction([
    prisma.module.count({ where }),
    prisma.module.findMany({
      where,
      select: moduleSelect(actor.id),
      orderBy: [{ title: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map((row) => toModuleSummary(row, viewerStateFor(actor, row), row._count.sections)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** A Module is addressable by id for the Architect and by slug for the Coder. */
export type ModuleRef = { id: string } | { slug: string };

/**
 * The Module with its section tree.
 *
 * A Coder who has not joined still gets the module itself — that is the page
 * the Enroll button lives on — but no sections. `viewer.canRead` says which of
 * the two answers this is, so an empty tree is never mistaken for an empty
 * module.
 */
export async function getModule(actor: AuthenticatedUser, ref: ModuleRef): Promise<ModuleDetail> {
  assertContentAudience(actor);

  const row = await prisma.module.findUnique({
    where: ref,
    select: moduleSelect(actor.id),
  });
  if (!row) {
    throw new AppError("NOT_FOUND", "Module not found");
  }

  const viewer = viewerStateFor(actor, row);
  if (!viewer.canRead && !row.isPublished) {
    // A draft belongs to its Architect alone; its existence is not public.
    throw new AppError("NOT_FOUND", "Module not found");
  }

  if (!viewer.canRead) {
    return toModuleDetail(row, viewer, []);
  }

  const sections = await prisma.section.findMany({
    where: { moduleId: row.id },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      moduleId: true,
      title: true,
      orderIndex: true,
      materials: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          sectionId: true,
          title: true,
          orderIndex: true,
          isPublished: true,
          _count: { select: { practiceActivities: true } },
        },
      },
    },
  });

  return toModuleDetail(
    row,
    viewer,
    toModuleSectionViews(sections, { includeUnpublishedMaterials: viewer.isOwner }),
  );
}

export async function createModule(
  actor: AuthenticatedUser,
  input: CreateModuleRequest,
): Promise<ModuleSummary> {
  if (actor.role !== "ARCHITECT") {
    throw new AppError("FORBIDDEN", "Only an Architect may create modules");
  }

  try {
    const created = await prisma.module.create({
      data: {
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: input.description ?? null,
        visibility: input.visibility,
        isPublished: input.isPublished,
        ownerId: actor.id,
      },
      select: moduleSelect(actor.id),
    });
    return toModuleSummary(created, viewerStateFor(actor, created), 0);
  } catch (error) {
    if (isPrismaErrorCode(error, PRISMA_UNIQUE_VIOLATION)) {
      throw new AppError("CONFLICT", "A module with this slug already exists");
    }
    throw error;
  }
}

export async function updateModule(
  actor: AuthenticatedUser,
  moduleId: string,
  input: UpdateModuleRequest,
): Promise<ModuleSummary> {
  await requireModuleOwner(actor, moduleId);

  try {
    const updated = await prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.description === undefined ? {} : { description: input.description ?? null }),
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
      },
      select: moduleSelect(actor.id),
    });
    return toModuleSummary(updated, viewerStateFor(actor, updated), updated._count.sections);
  } catch (error) {
    if (isPrismaErrorCode(error, PRISMA_UNIQUE_VIOLATION)) {
      throw new AppError("CONFLICT", "A module with this slug already exists");
    }
    throw error;
  }
}

export async function deleteModule(actor: AuthenticatedUser, moduleId: string): Promise<void> {
  await requireModuleOwner(actor, moduleId);

  try {
    await prisma.module.delete({ where: { id: moduleId } });
  } catch (error) {
    // Sections, Materials, and Practice Activities cascade away with the
    // Module. Submissions deliberately do not: an Assessment that has been
    // answered cannot be deleted, so a Module carrying graded history refuses
    // to disappear. Unpublishing is the correct move there.
    if (isPrismaErrorCode(error, PRISMA_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(
        "CONFLICT",
        "This module has graded history and cannot be deleted; unpublish it instead",
      );
    }
    throw error;
  }
}

/**
 * Read guard for the content services below. They each need the Module a
 * Section, Material, or Practice Activity belongs to, and they all need the
 * same two answers about it.
 */
export async function assertCanRead(
  actor: AuthenticatedUser,
  moduleId: string,
): Promise<{ isOwner: boolean }> {
  assertContentAudience(actor);
  const context = await requireEnrolled(actor, moduleId);
  return { isOwner: context.ownerId === actor.id };
}

export async function assertCanWrite(actor: AuthenticatedUser, moduleId: string): Promise<void> {
  assertContentAudience(actor);
  await requireModuleOwner(actor, moduleId);
}
