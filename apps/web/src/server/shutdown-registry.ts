/**
 * Who needs closing when the process stops.
 *
 * Each module that opens a long-lived connection registers its own closer the
 * first time it opens one. Nothing that was never used is ever registered, so
 * shutdown closes exactly what is open.
 *
 * The indirection exists for a build reason as much as a design one.
 * `instrumentation.ts` is the only hook Next.js gives for a shutdown handler,
 * and Next compiles it in a bundling pass where `serverExternalPackages` does
 * not apply — a path from there to ioredis, bullmq, or Prisma fails to resolve
 * Node's own built-ins and takes the whole instrumentation module down with
 * it, silently leaving the process with no shutdown handling at all. This file
 * imports nothing, so the path stops here.
 *
 * Parked on `globalThis` for the same reason the Prisma client is: a dev
 * reload re-evaluates the module and a module-scoped array would lose every
 * closer registered before it.
 */

export type Closer = { name: string; close: () => Promise<unknown> };

const globalForShutdown = globalThis as unknown as { ambatucodeClosers?: Closer[] };

export function registerCloser(name: string, close: () => Promise<unknown>): void {
  globalForShutdown.ambatucodeClosers ??= [];
  // Idempotent by name: a module re-evaluated by a dev reload must not queue
  // its closer twice.
  if (globalForShutdown.ambatucodeClosers.some((closer) => closer.name === name)) return;
  globalForShutdown.ambatucodeClosers.push({ name, close });
}

/**
 * Closers in the order they should run, which is the reverse of the order they
 * were opened: the queue drains before the Redis connection it rides on, and
 * the database goes last because a closer may still need to write.
 */
export function registeredClosers(): Closer[] {
  return [...(globalForShutdown.ambatucodeClosers ?? [])].reverse();
}
