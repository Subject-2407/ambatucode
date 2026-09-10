import { z } from "zod";
import { LANGUAGES, type Language } from "../enums";
import {
  practiceTestCaseSchema,
  starterCodeMapSchema,
  type PracticeTestCase,
  type StarterCodeMap,
} from "./content";

/**
 * Practice Activity CRUD and the Run that executes one.
 *
 * A Practice Run is not a Submission and never becomes one: it writes no row,
 * consumes no attempt, and produces no grade. Its results come back over
 * `submission:status` as the RUN variant, which is why this response carries a
 * job id and nothing else.
 */

export const practiceTitleSchema = z.string().trim().min(1).max(160);

/**
 * A case as the Architect authors it. The id is optional because a case being
 * typed for the first time does not have one yet; the server fills it in and
 * keeps it stable across later edits so the editor's list keys and any client
 * cache survive a reorder.
 */
export const practiceTestCaseInputSchema = practiceTestCaseSchema.partial({ id: true });
export type PracticeTestCaseInput = z.infer<typeof practiceTestCaseInputSchema>;

/**
 * The editable fields of an activity, without defaults.
 *
 * Defaults belong to creation alone. Applied to a patch they would turn every
 * edit into a full rewrite — renaming an activity would quietly reset its time
 * limit to five seconds — and would make an empty body look like a legitimate
 * request, because after defaulting it is no longer empty.
 */
const practiceShape = {
  title: practiceTitleSchema,
  prompt: z.string().trim().min(1).max(20_000),
  /**
   * At least one language, and no duplicates: an activity nobody can run is a
   * dead end the Coder discovers only after opening it.
   */
  allowedLanguages: z
    .array(z.enum(LANGUAGES))
    .min(1)
    .max(LANGUAGES.length)
    .refine((values) => new Set(values).size === values.length, {
      message: "Languages must be unique",
    }),
  starterCode: starterCodeMapSchema,
  timeLimitMs: z.number().int().min(100).max(60_000),
  memoryLimitMb: z.number().int().min(16).max(2_048),
  testCases: z.array(practiceTestCaseInputSchema).min(1).max(50),
};

export const createPracticeRequestSchema = z.object({
  ...practiceShape,
  starterCode: practiceShape.starterCode.default({}),
  timeLimitMs: practiceShape.timeLimitMs.default(5_000),
  memoryLimitMb: practiceShape.memoryLimitMb.default(256),
});
export type CreatePracticeRequest = z.infer<typeof createPracticeRequestSchema>;

export const updatePracticeRequestSchema = z
  .object(practiceShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdatePracticeRequest = z.infer<typeof updatePracticeRequestSchema>;

/**
 * Source code arrives in the request body, exactly as the Assessment submit
 * path does. Practice has no draft to fall back on and never should: what runs
 * is what is in the editor at the moment the Coder pressed Run.
 */
export const runPracticeRequestSchema = z.object({
  language: z.enum(LANGUAGES),
  sourceCode: z.string().max(200_000),
});
export type RunPracticeRequest = z.infer<typeof runPracticeRequestSchema>;

export type RunPracticeResponse = {
  /** Correlates with the `jobId` on the `submission:status` RUN payload. */
  jobId: string;
};

/**
 * The full activity as a Coder sees it — expected outputs included.
 *
 * That is not a leak. Every practice case is visible by definition, which is
 * precisely what separates practice from an Assessment; an exercise that needs
 * a hidden case belongs in an Assessment instead.
 */
export type PracticeActivityView = {
  id: string;
  materialId: string;
  title: string;
  orderIndex: number;
  prompt: string;
  allowedLanguages: Language[];
  starterCode: StarterCodeMap;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCases: PracticeTestCase[];
  createdAt: string;
  updatedAt: string;
};
