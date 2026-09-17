import "server-only";
import {
  errorFields,
  REDIS_CHANNELS,
  type AssessmentBroadcastMessage,
  type ExecutionStatusMessage,
  type GamificationMessage,
  type SessionRevokedMessage,
} from "@ambatucode/shared";
import { getPublisher } from "../redis";
import { log } from "../logger";

/**
 * apps/web owns the session table but not the sockets. When a session dies it
 * announces the fact on Redis so apps/realtime can drop any socket still
 * holding that session id.
 */
export async function publishSessionRevoked(message: SessionRevokedMessage): Promise<void> {
  if (message.sessionIds.length === 0) return;
  try {
    await getPublisher().publish(REDIS_CHANNELS.SESSION_REVOKED, JSON.stringify(message));
  } catch (error) {
    // A dropped notification must not fail the login or logout that caused it.
    // The socket is still rejected on its next authenticated action.
    log.error("publish.session_revoked_failed", errorFields(error));
  }
}

/**
 * Announces an execution job's state so apps/realtime can deliver it to the
 * Coder waiting on it.
 *
 * Best-effort, like the revocation notice above: a Coder who misses the push
 * still has `GET /api/submissions/[submissionId]/status` to fall back on for a
 * formal submission, and a lost Run result costs nothing but a re-run. Failing
 * the worker callback over an undelivered notification would be far worse —
 * the worker would retry, and the grade is already persisted.
 */
export async function publishExecutionStatus(message: ExecutionStatusMessage): Promise<void> {
  try {
    await getPublisher().publish(REDIS_CHANNELS.EXECUTION_STATUS, JSON.stringify(message));
  } catch (error) {
    log.error("publish.execution_status_failed", errorFields(error));
  }
}

/**
 * Tells apps/realtime about an assessment change apps/web just committed.
 *
 * Best-effort for the same reason as the two above: the change is already in
 * the database, which is the source of truth. A socket that misses the push
 * catches up on its next `attempt:join`, and the monitor snapshot endpoint is
 * always current. Failing the request that made the change would be worse.
 */
export async function publishAssessmentBroadcast(
  message: AssessmentBroadcastMessage,
): Promise<void> {
  try {
    await getPublisher().publish(REDIS_CHANNELS.ASSESSMENT_BROADCAST, JSON.stringify(message));
  } catch (error) {
    log.error("publish.assessment_broadcast_failed", errorFields(error));
  }
}

/**
 * Announces an award or a refreshed leaderboard.
 *
 * Best-effort like the rest of this module. The award row is already written
 * and the board recomputes on the next read, so a lost push costs a toast and
 * a few seconds of staleness — not a grade.
 *
 * Nothing suppressed reaches here: a board belonging to an assessment with
 * `hideLeaderboard` is never published in the first place, so apps/realtime can
 * fan out whatever arrives without re-deciding who is allowed to see it.
 */
export async function publishGamification(message: GamificationMessage): Promise<void> {
  try {
    await getPublisher().publish(REDIS_CHANNELS.GAMIFICATION, JSON.stringify(message));
  } catch (error) {
    log.error("publish.gamification_failed", errorFields(error));
  }
}
