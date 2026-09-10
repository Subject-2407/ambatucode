import { z } from "zod";
import { MODULE_VISIBILITIES, type EnrollmentStatus, type ModuleVisibility } from "../enums";

/**
 * Module CRUD and the Coder-facing catalog.
 *
 * Two view types rather than one: `ModuleSummary` is what a catalog row needs
 * and is safe for anyone who may see the Module at all, while `ModuleDetail`
 * carries the section tree and is only ever built for a reader who passed the
 * access guard. Collapsing them into one optional-heavy type would make it
 * impossible to tell, at a call site, which check has already run.
 */

export const moduleSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may only contain lower-case letters, digits, and single hyphens",
  );

export const moduleTitleSchema = z.string().trim().min(1).max(160);

export const createModuleRequestSchema = z.object({
  title: moduleTitleSchema,
  /** Absent means "derive it from the title" — the server owns that fallback. */
  slug: moduleSlugSchema.optional(),
  description: z.string().trim().max(2000).nullish(),
  visibility: z.enum(MODULE_VISIBILITIES).default("PUBLIC"),
  isPublished: z.boolean().default(false),
});
export type CreateModuleRequest = z.infer<typeof createModuleRequestSchema>;

export const updateModuleRequestSchema = z
  .object({
    title: moduleTitleSchema.optional(),
    slug: moduleSlugSchema.optional(),
    description: z.string().trim().max(2000).nullish(),
    visibility: z.enum(MODULE_VISIBILITIES).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateModuleRequest = z.infer<typeof updateModuleRequestSchema>;

/**
 * `scope` decides whose shelf is being read, not merely how it is filtered.
 * A Coder browsing the catalog and an Architect opening their builder ask
 * very different questions of the same table, and naming the intent here keeps
 * the service from guessing it from the caller's role.
 */
export const MODULE_SCOPES = ["catalog", "owned", "enrolled"] as const;
export type ModuleScope = (typeof MODULE_SCOPES)[number];

export const listModulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(MODULE_SCOPES).default("catalog"),
  search: z.string().trim().max(160).optional(),
});
export type ListModulesQuery = z.infer<typeof listModulesQuerySchema>;

/** How the viewer stands in relation to a Module, resolved server-side. */
export type ModuleViewerState = {
  isOwner: boolean;
  /** Null when the viewer has never requested access. */
  enrollmentStatus: EnrollmentStatus | null;
  /** True when the viewer may open Sections, Materials, and Practice. */
  canRead: boolean;
};

export type ModuleSummary = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  visibility: ModuleVisibility;
  isPublished: boolean;
  owner: { id: string; displayName: string };
  sectionCount: number;
  viewer: ModuleViewerState;
  createdAt: string;
  updatedAt: string;
};

export type ModuleDetail = ModuleSummary & {
  sections: ModuleSectionView[];
};

/**
 * A Section as it appears inside a Module tree. Assessments arrive in a later
 * phase and get their own array beside `materials`; they are absent here
 * rather than stubbed, so a screen cannot render an empty list that looks like
 * "no assessments" when the truth is "not built yet".
 */
export type ModuleSectionView = {
  id: string;
  moduleId: string;
  title: string;
  orderIndex: number;
  materials: ModuleMaterialSummary[];
};

export type ModuleMaterialSummary = {
  id: string;
  sectionId: string;
  title: string;
  orderIndex: number;
  isPublished: boolean;
  practiceCount: number;
};
