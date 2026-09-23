-- Why a failing test failed, in words a Coder can act on.
--
-- Additive and nullable: every row graded before this column existed reads as
-- "not recorded", which is what the serializers already expect from a null
-- here, and no historical grade changes.
--
-- It holds the platform's own sentence — "An assertion failed", "Your code
-- threw NullPointerException" — never the framework's message, which quotes
-- the value the test expected.
ALTER TABLE "SubmissionTestResult" ADD COLUMN "failureDetail" TEXT;
