import "server-only";
import { prisma } from "@ambatucode/db";
import { AppError } from "@ambatucode/shared";

/**
 * Walks an assessment-side id back up to the Module that governs it — the
 * assessment counterpart of `content-scope.ts`, for the same reason: every
 * guard asks about a Module, and one lookup per resource kind is one place to
 * get the join right.
 */

export type AssessmentScope = {
  assessmentId: string;
  sectionId: string;
  moduleId: string;
  isPublished: boolean;
  isOpenAccess: boolean;
};

export async function scopeForAssessment(assessmentId: string): Promise<AssessmentScope> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      sectionId: true,
      isPublished: true,
      isOpenAccess: true,
      section: { select: { moduleId: true } },
    },
  });
  if (!assessment) {
    throw new AppError("NOT_FOUND", "Assessment not found");
  }
  return {
    assessmentId,
    sectionId: assessment.sectionId,
    moduleId: assessment.section.moduleId,
    isPublished: assessment.isPublished,
    isOpenAccess: assessment.isOpenAccess,
  };
}

export async function scopeForTestCase(testCaseId: string): Promise<AssessmentScope> {
  const testCase = await prisma.assessmentTestCase.findUnique({
    where: { id: testCaseId },
    select: { assessmentId: true },
  });
  if (!testCase) {
    throw new AppError("NOT_FOUND", "Test case not found");
  }
  return scopeForAssessment(testCase.assessmentId);
}

export async function scopeForTestScript(testScriptId: string): Promise<AssessmentScope> {
  const script = await prisma.assessmentTestScript.findUnique({
    where: { id: testScriptId },
    select: { assessmentId: true },
  });
  if (!script) {
    throw new AppError("NOT_FOUND", "Test script not found");
  }
  return scopeForAssessment(script.assessmentId);
}

export type SessionScope = AssessmentScope & { sessionId: string };

export async function scopeForSession(sessionId: string): Promise<SessionScope> {
  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
    select: { assessmentId: true },
  });
  if (!session) {
    throw new AppError("NOT_FOUND", "Session not found");
  }
  return { ...(await scopeForAssessment(session.assessmentId)), sessionId };
}

export type AttemptScope = SessionScope & { attemptId: string; userId: string };

/**
 * Any attempt, whoever it belongs to. For Architect-side reads and for reset
 * and official-score selection, where the caller is authorized against the
 * Module rather than against the attempt's owner — so the ownership check the
 * Coder-facing lookup below performs would be the wrong question entirely.
 */
export async function scopeForAttempt(attemptId: string): Promise<AttemptScope> {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    select: { sessionId: true, userId: true },
  });
  if (!attempt) {
    throw new AppError("NOT_FOUND", "Attempt not found");
  }
  return { ...(await scopeForSession(attempt.sessionId)), attemptId, userId: attempt.userId };
}

/**
 * An attempt that belongs to someone else answers NOT_FOUND, not FORBIDDEN:
 * whether another Coder has an attempt in a session is not the caller's
 * business.
 */
export async function scopeForOwnAttempt(attemptId: string, userId: string): Promise<AttemptScope> {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    select: { sessionId: true, userId: true },
  });
  if (!attempt || attempt.userId !== userId) {
    throw new AppError("NOT_FOUND", "Attempt not found");
  }
  return { ...(await scopeForSession(attempt.sessionId)), attemptId, userId };
}
