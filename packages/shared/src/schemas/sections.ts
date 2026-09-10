import { z } from "zod";

/**
 * Section CRUD and reordering.
 *
 * Reorder takes the complete ordered list of section ids rather than a moved
 * id and a target position. Drag-and-drop already knows the resulting order,
 * and sending it whole lets the server rewrite every `orderIndex` in one
 * transaction — there is no intermediate state where two Sections share an
 * index, and a request that omits or invents an id is rejected outright.
 */

export const sectionTitleSchema = z.string().trim().min(1).max(160);

export const createSectionRequestSchema = z.object({
  title: sectionTitleSchema,
});
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;

export const updateSectionRequestSchema = z.object({
  title: sectionTitleSchema,
});
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;

export const reorderSectionsRequestSchema = z.object({
  sectionIds: z.array(z.string().min(1)).min(1).max(200),
});
export type ReorderSectionsRequest = z.infer<typeof reorderSectionsRequestSchema>;

export type SectionView = {
  id: string;
  moduleId: string;
  title: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};
