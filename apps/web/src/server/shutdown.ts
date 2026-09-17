import "server-only";
import { errorFields } from "@ambatucode/shared";
import { log } from "./logger";
import { registeredClosers } from "./shutdown-registry";

/**
 * Graceful shutdown.
 *
 * The HTTP server belongs to Next.js, which stops accepting connections on its
 * own; what it does not know about is everything this app opened beside it —
 * two Redis connections, the BullMQ producer's third, the deadline queue, and
 * the Prisma pool. Left dangling, those keep the process alive past the
 * signal, and an orchestrator that waited then kills it mid-write.
 *
 * Nothing here imports ioredis, bullmq, or Prisma — not even dynamically.
 * This file is reached from `instrumentation.ts`, which Next.js compiles in
 * its own bundling pass where `serverExternalPackages` does not apply, and any
 * path from there to one of those packages fails to resolve Node's own
 * built-ins and takes the whole instrumentation module down with it. The
 * closers come from `shutdown-registry.ts` instead, registered by the modules
 * that actually opened something.
 *
 * Every close is allowed to fail. A shutdown that hangs because one connection
 * refused to quit is worse than one that gives up on it: the deadline is a
 * hard exit either way.
 */

/** Long enough for a quit handshake, short enough not to be SIGKILLed over. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let installed = false;

async function closeEverything(): Promise<void> {
  for (const { name, close } of registeredClosers()) {
    try {
      await close();
    } catch (error) {
      log.warn("shutdown.close_failed", { resource: name, ...errorFields(error) });
    }
  }
}

export function registerShutdownHandlers(): void {
  // Next.js can call `register()` more than once across a dev reload, and a
  // second set of handlers would run the whole teardown twice.
  if (installed) return;
  installed = true;

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown.started", { signal });

    const deadline = setTimeout(() => {
      log.error("shutdown.timed_out", { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // A pending timer of our own must not be the thing keeping the process up.
    deadline.unref();

    void closeEverything().then(() => {
      clearTimeout(deadline);
      log.info("shutdown.complete", { signal });
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
