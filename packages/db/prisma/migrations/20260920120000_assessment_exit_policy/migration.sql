-- CreateEnum
CREATE TYPE "AssessmentExitPolicy" AS ENUM ('RESUME', 'SUBMIT', 'BLOCKED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "exitPolicy" "AssessmentExitPolicy" NOT NULL DEFAULT 'RESUME';
