import "server-only";
import { prisma } from "@ambatucode/db";
import { AppError, type AuthenticatedUser } from "@ambatucode/shared";
import { getServerEnv } from "../env";
import { consumeDummyVerification, verifyPassword } from "../auth/password";
import { consumeRateLimit } from "../auth/rate-limit";
import {
  issueSession,
  revokeLiveSessions,
  revokeSessionById,
  sessionExpiryFromNow,
} from "../auth/session";
import { publishSessionRevoked } from "../realtime/publish";
import { toAuthenticatedUser } from "../serializers/user";

export type LoginInput = {
  username: string;
  password: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export type LoginOutcome = {
  user: AuthenticatedUser;
  token: string;
  expiresAt: Date;
};

/**
 * Bad credentials, an unknown username, a deactivated account, and a rate-limit
 * lockout all produce this same error. Anything more specific would let an
 * attacker enumerate accounts or probe the lockout window.
 */
function invalidCredentials(): AppError {
  return new AppError("UNAUTHENTICATED", "Invalid username or password");
}

/**
 * Authenticates a user and replaces any existing session.
 *
 * FR-AUTH-02: an account holds at most one live session. The revoke and the
 * insert share a transaction so two simultaneous logins cannot both survive,
 * and the superseded ids are published so live sockets are dropped too.
 */
export async function login(input: LoginInput): Promise<LoginOutcome> {
  const env = getServerEnv();
  const { LOGIN_RATE_LIMIT_MAX: max, LOGIN_RATE_LIMIT_WINDOW_SECONDS: window } = env;

  const limits = await Promise.all([
    consumeRateLimit(`login:user:${input.username.toLowerCase()}`, max, window),
    consumeRateLimit(`login:ip:${input.ipAddress ?? "unknown"}`, max * 5, window),
  ]);
  if (limits.some((limit) => !limit.allowed)) {
    // Still burn a verification so a locked-out username is not detectable by
    // its faster response.
    await consumeDummyVerification(input.password);
    throw invalidCredentials();
  }

  const user = await prisma.user.findUnique({
    where: { username: input.username },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      passwordHash: true,
    },
  });

  if (!user || !user.isActive) {
    await consumeDummyVerification(input.password);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  if (!passwordMatches) {
    throw invalidCredentials();
  }

  const now = new Date();
  const expiresAt = sessionExpiryFromNow(now);

  const { token, supersededSessionIds } = await prisma.$transaction(
    async (tx) => {
      const superseded = await revokeLiveSessions(tx, user.id, "SUPERSEDED", now);
      const issued = await issueSession(tx, {
        userId: user.id,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt,
      });
      return { token: issued.token, supersededSessionIds: superseded };
    },
    // Three indexed statements, but this transaction decides whether a login
    // succeeds. Prisma's 5s default is tight enough that a loaded database
    // turns a valid login into an INTERNAL error, so it is widened here.
    { timeout: 20_000, maxWait: 10_000 },
  );

  await publishSessionRevoked({
    sessionIds: supersededSessionIds,
    userId: user.id,
    reason: "SUPERSEDED",
  });

  return { user: toAuthenticatedUser(user), token, expiresAt };
}

export async function logout(sessionId: string, userId: string): Promise<void> {
  await revokeSessionById(sessionId, "LOGOUT");
  await publishSessionRevoked({ sessionIds: [sessionId], userId, reason: "LOGOUT" });
}
