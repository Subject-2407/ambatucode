import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@ambatucode/db";
import { hashSessionToken, isAppError, isSessionLive } from "@ambatucode/shared";
import { hashPassword } from "../auth/password";
import { closeRedis } from "../redis";
import { login, logout } from "./auth";

/**
 * Exercises FR-AUTH-02 against the real database: an account holds at most one
 * live session, and a second login supersedes the first.
 *
 * Usernames are randomised so repeated runs do not share a Redis rate-limit
 * window with each other.
 */

const PASSWORD = "CorrectHorse123!";
const suffix = randomBytes(4).toString("hex");
const username = `itest_${suffix}`;
const inactiveUsername = `itestoff_${suffix}`;

let userId: string;
let inactiveUserId: string;

async function liveSessionsFor(id: string) {
  const sessions = await prisma.session.findMany({
    where: { userId: id },
    select: { id: true, revokedAt: true, revokedReason: true, expiresAt: true },
  });
  return sessions.filter((session) =>
    isSessionLive({ revokedAt: session.revokedAt, expiresAt: session.expiresAt }),
  );
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const [active, inactive] = await Promise.all([
    prisma.user.create({
      data: { username, passwordHash, displayName: "Integration Coder", role: "CODER" },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        username: inactiveUsername,
        passwordHash,
        displayName: "Deactivated Coder",
        role: "CODER",
        isActive: false,
      },
      select: { id: true },
    }),
  ]);
  userId = active.id;
  inactiveUserId = inactive.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, inactiveUserId] } } });
  await prisma.$disconnect();
  await closeRedis();
});

describe("login", () => {
  it("authenticates a valid credential and issues a hashed session", async () => {
    const outcome = await login({
      username,
      password: PASSWORD,
      userAgent: "vitest",
      ipAddress: `10.0.0.${Math.floor(Math.random() * 200)}`,
    });

    expect(outcome.user.username).toBe(username);
    expect(outcome.user.role).toBe("CODER");
    expect(outcome.token).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The raw token is never stored — only its hash.
    const stored = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(outcome.token) },
      select: { userId: true },
    });
    expect(stored?.userId).toBe(userId);

    const rawTokenRow = await prisma.session.findFirst({
      where: { tokenHash: outcome.token },
      select: { id: true },
    });
    expect(rawTokenRow).toBeNull();
  });

  it("supersedes the previous session so only one stays live", async () => {
    const first = await login({
      username,
      password: PASSWORD,
      userAgent: "browser-a",
      ipAddress: "10.0.1.1",
    });
    const second = await login({
      username,
      password: PASSWORD,
      userAgent: "browser-b",
      ipAddress: "10.0.1.2",
    });

    const live = await liveSessionsFor(userId);
    expect(live).toHaveLength(1);

    const survivor = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(second.token) },
      select: { id: true },
    });
    expect(live[0]?.id).toBe(survivor?.id);

    const killed = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(first.token) },
      select: { revokedAt: true, revokedReason: true },
    });
    expect(killed?.revokedAt).not.toBeNull();
    expect(killed?.revokedReason).toBe("SUPERSEDED");
  });

  it("rejects a wrong password without revoking the live session", async () => {
    const before = await liveSessionsFor(userId);

    await expect(
      login({ username, password: "WrongPassword1!", userAgent: null, ipAddress: "10.0.2.1" }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "UNAUTHENTICATED");

    const after = await liveSessionsFor(userId);
    expect(after.map((session) => session.id)).toEqual(before.map((session) => session.id));
  });

  it("gives an unknown username the same error as a bad password", async () => {
    await expect(
      login({
        username: `missing_${suffix}`,
        password: PASSWORD,
        userAgent: null,
        ipAddress: "10.0.3.1",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) &&
        error.code === "UNAUTHENTICATED" &&
        error.message === "Invalid username or password",
    );
  });

  it("refuses a deactivated account", async () => {
    await expect(
      login({
        username: inactiveUsername,
        password: PASSWORD,
        userAgent: null,
        ipAddress: "10.0.4.1",
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "UNAUTHENTICATED");

    expect(await liveSessionsFor(inactiveUserId)).toHaveLength(0);
  });
});

describe("logout", () => {
  it("revokes the caller's session", async () => {
    const outcome = await login({
      username,
      password: PASSWORD,
      userAgent: "browser-c",
      ipAddress: "10.0.5.1",
    });
    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(outcome.token) },
      select: { id: true },
    });

    await logout(session.id, userId);

    expect(await liveSessionsFor(userId)).toHaveLength(0);
    const revoked = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { revokedReason: true },
    });
    expect(revoked.revokedReason).toBe("LOGOUT");
  });
});
