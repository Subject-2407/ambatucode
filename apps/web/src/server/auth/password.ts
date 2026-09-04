import "server-only";
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * OWASP-recommended argon2id parameters. Mirrored in
 * packages/db/prisma/seed.ts — change both together.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as a failed login, never as a crash.
    return false;
  }
}

/**
 * A genuine argon2id hash over a throwaway secret, computed once per process.
 * It has to be real: verifying a malformed hash fails on parse and returns far
 * faster than a real verification, which would reintroduce the timing leak
 * this exists to close.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString("hex"), ARGON2_OPTIONS);
  return dummyHashPromise;
}

/**
 * Burn the same amount of CPU as a real verification so response timing does
 * not leak whether the username exists.
 */
export async function consumeDummyVerification(password: string): Promise<void> {
  try {
    await verify(await getDummyHash(), password);
  } catch {
    // Expected to fail; the point is the elapsed time, not the result.
  }
}
