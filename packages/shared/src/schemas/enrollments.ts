import { z } from "zod";
import { ENROLLMENT_STATUSES, type EnrollmentStatus } from "../enums";

/**
 * Enrollment. A Public Module grants access on request; a Closed one records
 * the request as PENDING until the owning Architect decides.
 *
 * The request body is empty on purpose: which of the two paths applies is a
 * property of the Module, never something the client may assert. Sending a
 * desired status would let a Coder ask to be APPROVED.
 */

/** Only a decision may be patched — an Architect cannot rewrite the request. */
export const ENROLLMENT_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type EnrollmentDecision = (typeof ENROLLMENT_DECISIONS)[number];

export const decideEnrollmentRequestSchema = z.object({
  status: z.enum(ENROLLMENT_DECISIONS),
});
export type DecideEnrollmentRequest = z.infer<typeof decideEnrollmentRequestSchema>;

export const listEnrollmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(ENROLLMENT_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;

/** The Architect's view of one enrollment request. Carries no grading data. */
export type EnrollmentView = {
  id: string;
  moduleId: string;
  status: EnrollmentStatus;
  coder: { id: string; username: string; displayName: string };
  decidedBy: { id: string; displayName: string } | null;
  decidedAt: string | null;
  createdAt: string;
};

/** What a Coder gets back after asking to join. */
export type EnrollmentRequestResult = {
  moduleId: string;
  status: EnrollmentStatus;
  /** True when access is already granted, false while the request is pending. */
  canRead: boolean;
};
