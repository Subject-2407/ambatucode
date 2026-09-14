-- CreateTable
CREATE TABLE "PracticeTestScript" (
    "id" TEXT NOT NULL,
    "practiceActivityId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "framework" "TestScriptFramework" NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeTestScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeTestScript_practiceActivityId_language_path_key" ON "PracticeTestScript"("practiceActivityId", "language", "path");

-- AddForeignKey
ALTER TABLE "PracticeTestScript" ADD CONSTRAINT "PracticeTestScript_practiceActivityId_fkey" FOREIGN KEY ("practiceActivityId") REFERENCES "PracticeActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
