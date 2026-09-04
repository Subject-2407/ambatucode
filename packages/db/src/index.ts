import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client for the whole process. Next.js recreates modules on every
 * hot reload in development, so the instance is parked on globalThis to stop
 * each reload from opening a fresh connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "./errors";
export * from "@prisma/client";
