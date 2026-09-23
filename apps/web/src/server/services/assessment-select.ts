import "server-only";
import type { Prisma } from "@ambatucode/db";

/**
 * The columns every Assessment read starts from.
 *
 * It lives in a module of its own rather than in  so that
 *  can reach it without importing the assessment service — which
 * would close a cycle now that the assessment service ends and opens the
 * session behind an open-access Assessment.
 *
 * Nothing Architect-only is in it: reference solutions, hidden cases, and
 * scripts are selected explicitly by the reads that are allowed to see them.
 */
export const ASSESSMENT_SELECT = {
  id: true,
  sectionId: true,
  title: true,
  orderIndex: true,
  isPublished: true,
  isOpenAccess: true,
  timeMode: true,
  durationMinutes: true,
  executionMode: true,
  problemStatement: true,
  allowedLanguages: true,
  starterCodeJson: true,
  timeLimitMs: true,
  memoryLimitMb: true,
  gradingStrategy: true,
  exitPolicy: true,
  antiCheatConfigJson: true,
  createdAt: true,
  updatedAt: true,
  section: { select: { moduleId: true } },
} satisfies Prisma.AssessmentSelect;
