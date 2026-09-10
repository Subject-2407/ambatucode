import { hash } from "@node-rs/argon2";
import { PrismaClient, UserRole } from "@prisma/client";
import { seedContent, seedEnrollments, seedPractice } from "./seed-content";

/**
 * Baseline accounts for local development: one Root, two Architects, twenty
 * Coders. Idempotent — rerunning it updates the existing rows instead of
 * failing on the unique username.
 */

const prisma = new PrismaClient();

// OWASP-recommended argon2id parameters. Mirrored in
// apps/web/src/server/auth/password.ts — change both together.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Ambatucode123!";

type SeedUser = {
  username: string;
  displayName: string;
  role: UserRole;
};

function buildSeedUsers(): SeedUser[] {
  const users: SeedUser[] = [
    { username: "root", displayName: "System Root", role: UserRole.ROOT },
    { username: "architect1", displayName: "Architect One", role: UserRole.ARCHITECT },
    { username: "architect2", displayName: "Architect Two", role: UserRole.ARCHITECT },
  ];

  for (let index = 1; index <= 20; index += 1) {
    const suffix = String(index).padStart(2, "0");
    users.push({
      username: `coder${suffix}`,
      displayName: `Coder ${suffix}`,
      role: UserRole.CODER,
    });
  }

  return users;
}

async function main(): Promise<void> {
  const passwordHash = await hash(DEFAULT_PASSWORD, ARGON2_OPTIONS);
  const users = buildSeedUsers();

  const ids = new Map<string, string>();
  for (const user of users) {
    const row = await prisma.user.upsert({
      where: { username: user.username },
      create: { ...user, passwordHash, isActive: true },
      update: { displayName: user.displayName, role: user.role, isActive: true },
      select: { id: true },
    });
    ids.set(user.username, row.id);
  }

  const architect1 = ids.get("architect1");
  const architect2 = ids.get("architect2");
  if (!architect1 || !architect2) {
    throw new Error("Architect accounts are missing; the user seed did not run");
  }

  const coderIds = users
    .filter((user) => user.role === UserRole.CODER)
    .map((user) => ids.get(user.username))
    .filter((id): id is string => id !== undefined);

  // Content comes after the accounts because every Module has an owner and
  // every enrollment has a Coder.
  const owners = { architect1, architect2, coderIds };
  await seedContent(prisma, owners);
  await seedPractice(prisma);
  await seedEnrollments(prisma, owners);

  const counts = users.reduce<Record<string, number>>((accumulator, user) => {
    accumulator[user.role] = (accumulator[user.role] ?? 0) + 1;
    return accumulator;
  }, {});

  console.info(
    `Seeded ${users.length} users (${JSON.stringify(counts)}) with the shared development password.`,
  );
  console.info("Seeded 2 modules, 3 sections, 4 materials, 2 practice activities, 8 enrollments.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
