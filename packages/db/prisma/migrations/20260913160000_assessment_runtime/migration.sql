-- AlterEnum
ALTER TYPE "AssessmentEventType" ADD VALUE 'ATTEMPT_EXPIRED';

-- DropIndex
DROP INDEX "AssessmentTestScript_assessmentId_idx";

-- AlterTable
ALTER TABLE "AssessmentParticipant" ADD COLUMN     "isListed" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "AssessmentParticipant_sessionId_isListed_idx" ON "AssessmentParticipant"("sessionId", "isListed");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTestScript_assessmentId_language_key" ON "AssessmentTestScript"("assessmentId", "language");

