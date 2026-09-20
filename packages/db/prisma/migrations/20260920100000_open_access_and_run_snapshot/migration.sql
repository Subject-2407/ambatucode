-- CreateEnum
CREATE TYPE "SessionAccess" AS ENUM ('LISTED', 'MODULE');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "isOpenAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AssessmentSession" ADD COLUMN     "access" "SessionAccess" NOT NULL DEFAULT 'LISTED',
ADD COLUMN     "isOpenAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AssessmentAttempt" ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "lastRunLanguage" TEXT,
ADD COLUMN     "lastRunSourceCode" TEXT;

-- CreateIndex
CREATE INDEX "AssessmentSession_assessmentId_isOpenAccess_idx" ON "AssessmentSession"("assessmentId", "isOpenAccess");
