import { prisma } from "@ambatucode/db";
import { errorFields } from "@ambatucode/shared";
import { getEnv } from "./env";
import { log } from "./logger";
import { createRealtimeServer } from "./server";

const server = createRealtimeServer();
const port = getEnv().REALTIME_PORT;

void server.listen(port).then(() => {
  log.info("server.listening", { port });
  // Deadline alarms are consumed by the long-running process only; building
  // a server for a test does not start taking jobs off the shared queue.
  server.deadlines.start();
});

/**
 * Graceful shutdown.
 *
 * Sockets are dropped, the deadline worker drains, and the Redis and Prisma
 * connections close — in that order, because a deadline job that fires during
 * teardown still needs a database to write to.
 *
 * The timeout is the point of the whole thing: a shutdown that hangs waiting
 * on a connection which will never close is indistinguishable from a crash to
 * whoever sent the signal, and ends the same way. Exiting on our own terms
 * means the deadline sweep on the next start has less to clean up.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutdown.started", { signal });

  const deadline = setTimeout(() => {
    log.error("shutdown.timed_out", { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  deadline.unref();

  void server
    .close()
    .catch((error: unknown) => {
      log.warn("shutdown.close_failed", { resource: "server", ...errorFields(error) });
    })
    .then(() => prisma.$disconnect())
    .catch((error: unknown) => {
      log.warn("shutdown.close_failed", { resource: "prisma", ...errorFields(error) });
    })
    .finally(() => {
      clearTimeout(deadline);
      log.info("shutdown.complete", { signal });
      process.exit(0);
    });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
