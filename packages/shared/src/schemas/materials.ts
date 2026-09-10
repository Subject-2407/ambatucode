import { z } from "zod";
import { richTextDocumentSchema, type RichTextDocument } from "./content";
import type { PracticeActivityView } from "./practice";

/**
 * Material CRUD and the reader's view.
 *
 * `contentJson` is parsed with the same schema on the way in and on the way
 * out. A column written by an older editor build is exactly as untrusted as a
 * request body, and a reader that assumes otherwise renders a blank screen for
 * the one Material whose shape drifted.
 */

export const materialTitleSchema = z.string().trim().min(1).max(160);

export const createMaterialRequestSchema = z.object({
  title: materialTitleSchema,
  content: richTextDocumentSchema.optional(),
  isPublished: z.boolean().default(false),
});
export type CreateMaterialRequest = z.infer<typeof createMaterialRequestSchema>;

export const updateMaterialRequestSchema = z
  .object({
    title: materialTitleSchema.optional(),
    content: richTextDocumentSchema.optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateMaterialRequest = z.infer<typeof updateMaterialRequestSchema>;

export type MaterialSummary = {
  id: string;
  sectionId: string;
  title: string;
  orderIndex: number;
  isPublished: boolean;
  practiceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MaterialDetail = MaterialSummary & {
  content: RichTextDocument;
  practiceActivities: PracticeActivityView[];
};
