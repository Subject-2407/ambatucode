-- CreateEnum
CREATE TYPE "TestScriptValidationStatus" AS ENUM ('UNVALIDATED', 'VALIDATING', 'PASSED', 'FAILED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "referenceSolutionsJson" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "AssessmentTestScript" ADD COLUMN     "validationChangedAt" TIMESTAMP(3),
ADD COLUMN     "validationJobId" TEXT,
ADD COLUMN     "validationStatus" "TestScriptValidationStatus" NOT NULL DEFAULT 'UNVALIDATED',
ADD COLUMN     "validationSummary" TEXT;

-- AlterTable
ALTER TABLE "PracticeActivity" ADD COLUMN     "referenceSolutionsJson" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "PracticeTestScript" ADD COLUMN     "validationChangedAt" TIMESTAMP(3),
ADD COLUMN     "validationJobId" TEXT,
ADD COLUMN     "validationStatus" "TestScriptValidationStatus" NOT NULL DEFAULT 'UNVALIDATED',
ADD COLUMN     "validationSummary" TEXT;

