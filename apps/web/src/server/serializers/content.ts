import "server-only";
import {
  AppError,
  EMPTY_RICH_TEXT_DOCUMENT,
  isLanguage,
  practiceTestCasesSchema,
  richTextDocumentSchema,
  starterCodeMapSchema,
  type EnrollmentStatus,
  type EnrollmentView,
  type Language,
  type MaterialDetail,
  type MaterialSummary,
  type ModuleDetail,
  type ModuleMaterialSummary,
  type ModuleSectionView,
  type ModuleSummary,
  type ModuleViewerState,
  type ModuleVisibility,
  type PracticeActivityView,
  type SectionView,
} from "@ambatucode/shared";
import type { z } from "zod";

/**
 * Row-to-response translation for learning content.
 *
 * Two jobs, both of which have to happen in one place to be trustworthy.
 * First, nothing reaches the wire that a route did not choose to send — no
 * bare owner id, no raw Json column. Second, every Json column is parsed on
 * the way out with the same schema that guarded it on the way in: a column
 * written by an older editor build is exactly as untrusted as a request body.
 */

type JsonValue = unknown;

/**
 * A stored document that no longer matches its schema is a defect in this
 * system, not a client error, so it surfaces as INTERNAL with the column named
 * — and never as a half-rendered response that hides the drift.
 */
function parseStored<Schema extends z.ZodType>(
  schema: Schema,
  value: JsonValue,
  column: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("INTERNAL", `Stored ${column} does not match its schema`);
  }
  return parsed.data;
}

// --- Module ------------------------------------------------------------------

type ModuleRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  visibility: ModuleVisibility;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; displayName: string };
};

export function toModuleSummary(
  row: ModuleRow,
  viewer: ModuleViewerState,
  sectionCount: number,
): ModuleSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    isPublished: row.isPublished,
    owner: { id: row.owner.id, displayName: row.owner.displayName },
    sectionCount,
    viewer,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SectionTreeRow = {
  id: string;
  moduleId: string;
  title: string;
  orderIndex: number;
  materials: Array<{
    id: string;
    sectionId: string;
    title: string;
    orderIndex: number;
    isPublished: boolean;
    _count: { practiceActivities: number };
  }>;
};

/**
 * The tree an Architect sees and the tree a Coder sees differ by exactly one
 * rule: an unpublished Material is invisible to the reader. Passing that in as
 * a flag keeps the two callers from inventing their own filter.
 */
export function toModuleSectionViews(
  rows: SectionTreeRow[],
  options: { includeUnpublishedMaterials: boolean },
): ModuleSectionView[] {
  return rows.map((section) => ({
    id: section.id,
    moduleId: section.moduleId,
    title: section.title,
    orderIndex: section.orderIndex,
    materials: section.materials
      .filter((material) => options.includeUnpublishedMaterials || material.isPublished)
      .map((material): ModuleMaterialSummary => ({
        id: material.id,
        sectionId: material.sectionId,
        title: material.title,
        orderIndex: material.orderIndex,
        isPublished: material.isPublished,
        practiceCount: material._count.practiceActivities,
      })),
  }));
}

export function toModuleDetail(
  row: ModuleRow,
  viewer: ModuleViewerState,
  sections: ModuleSectionView[],
): ModuleDetail {
  return { ...toModuleSummary(row, viewer, sections.length), sections };
}

// --- Section -----------------------------------------------------------------

type SectionRow = {
  id: string;
  moduleId: string;
  title: string;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toSectionView(row: SectionRow): SectionView {
  return {
    id: row.id,
    moduleId: row.moduleId,
    title: row.title,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Material ----------------------------------------------------------------

type MaterialRow = {
  id: string;
  sectionId: string;
  title: string;
  orderIndex: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { practiceActivities: number };
};

export function toMaterialSummary(row: MaterialRow): MaterialSummary {
  return {
    id: row.id,
    sectionId: row.sectionId,
    title: row.title,
    orderIndex: row.orderIndex,
    isPublished: row.isPublished,
    practiceCount: row._count.practiceActivities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isEmptyObject(value: JsonValue): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export function toMaterialDetail(
  row: MaterialRow & { contentJson: JsonValue },
  practiceActivities: PracticeActivityView[],
): MaterialDetail {
  // A Material nobody has typed into yet holds the column default, which is
  // not a document. Reading that as empty is correct; anything else malformed
  // is not, and parseStored says so rather than rendering a blank page.
  const content = isEmptyObject(row.contentJson)
    ? EMPTY_RICH_TEXT_DOCUMENT
    : parseStored(richTextDocumentSchema, row.contentJson, "Material.contentJson");

  return { ...toMaterialSummary(row), content, practiceActivities };
}

// --- Practice ----------------------------------------------------------------

type PracticeRow = {
  id: string;
  materialId: string;
  title: string;
  orderIndex: number;
  prompt: string;
  allowedLanguages: string[];
  starterCodeJson: JsonValue;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCasesJson: JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export function toPracticeActivityView(row: PracticeRow): PracticeActivityView {
  return {
    id: row.id,
    materialId: row.materialId,
    title: row.title,
    orderIndex: row.orderIndex,
    prompt: row.prompt,
    // The column is a plain string array in PostgreSQL, so a value written by
    // an older build could name a language this release no longer knows.
    allowedLanguages: row.allowedLanguages.filter((value): value is Language => isLanguage(value)),
    starterCode: parseStored(
      starterCodeMapSchema,
      row.starterCodeJson,
      "PracticeActivity.starterCodeJson",
    ),
    timeLimitMs: row.timeLimitMs,
    memoryLimitMb: row.memoryLimitMb,
    // Expected outputs included, deliberately: every practice case is visible
    // to the Coder by definition. An exercise that needs a hidden case belongs
    // in an Assessment, not here.
    testCases: parseStored(
      practiceTestCasesSchema,
      row.testCasesJson,
      "PracticeActivity.testCasesJson",
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Enrollment --------------------------------------------------------------

type EnrollmentRow = {
  id: string;
  moduleId: string;
  status: EnrollmentStatus;
  decidedAt: Date | null;
  createdAt: Date;
  user: { id: string; username: string; displayName: string };
  decidedBy: { id: string; displayName: string } | null;
};

export function toEnrollmentView(row: EnrollmentRow): EnrollmentView {
  return {
    id: row.id,
    moduleId: row.moduleId,
    status: row.status,
    coder: {
      id: row.user.id,
      username: row.user.username,
      displayName: row.user.displayName,
    },
    decidedBy: row.decidedBy
      ? { id: row.decidedBy.id, displayName: row.decidedBy.displayName }
      : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
