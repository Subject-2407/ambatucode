-- AlterTable
ALTER TABLE "AssessmentTestScript" ADD COLUMN     "showTestNames" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubmissionTestResult" ADD COLUMN     "testScriptId" TEXT;

-- AddForeignKey
ALTER TABLE "SubmissionTestResult" ADD CONSTRAINT "SubmissionTestResult_testScriptId_fkey" FOREIGN KEY ("testScriptId") REFERENCES "AssessmentTestScript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

