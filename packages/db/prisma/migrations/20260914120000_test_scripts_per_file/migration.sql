-- A language may now hold several single-file scripts, one per path.
-- DropIndex
DROP INDEX "AssessmentTestScript_assessmentId_language_key";

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTestScript_assessmentId_language_entrypoint_key" ON "AssessmentTestScript"("assessmentId", "language", "entrypoint");
