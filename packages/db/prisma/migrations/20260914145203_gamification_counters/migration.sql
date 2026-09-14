-- AlterTable
ALTER TABLE "AssessmentAttempt" ADD COLUMN     "runCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PracticeProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceActivityId" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "passedAllAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeProgress_userId_idx" ON "PracticeProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeProgress_userId_practiceActivityId_key" ON "PracticeProgress"("userId", "practiceActivityId");

-- AddForeignKey
ALTER TABLE "PracticeProgress" ADD CONSTRAINT "PracticeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeProgress" ADD CONSTRAINT "PracticeProgress_practiceActivityId_fkey" FOREIGN KEY ("practiceActivityId") REFERENCES "PracticeActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
