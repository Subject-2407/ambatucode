-- Scheduled sessions gain a closing time and a readiness gate.
--
-- Both are additive and default to the behaviour that was there before: a
-- session with no `closesAt` runs exactly as it did, and `requireAllReady`
-- false is the old rule where Start is never blocked.
ALTER TABLE "AssessmentSession" ADD COLUMN "closesAt" TIMESTAMP(3);
ALTER TABLE "AssessmentSession" ADD COLUMN "requireAllReady" BOOLEAN NOT NULL DEFAULT false;

-- A retake granted after its session ended. Existing attempts keep the old
-- rule, which is that they belong to their session's lifecycle entirely.
ALTER TABLE "AssessmentAttempt" ADD COLUMN "grantedOutsideSession" BOOLEAN NOT NULL DEFAULT false;
