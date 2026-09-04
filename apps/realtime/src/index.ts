import { prisma } from "@ambatucode/db";
import { getEnv } from "./env";
import { createRealtimeServer } from "./server";

const server = createRealtimeServer();
const port = getEnv().REALTIME_PORT;

void server.listen(port).then(() => {
  console.info(`[realtime] listening on port ${port}`);
});

const shutdown = (signal: string): void => {
  console.info(`[realtime] ${signal} received, shutting down`);
  void server
    .close()
    .finally(() => prisma.$disconnect())
    .finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
