import { createLogger, resolveLogLevel, type Logger } from "@ambatucode/shared";

/** The realtime server's logger. See apps/web/src/server/logger.ts. */
export const log: Logger = createLogger({
  service: "realtime",
  level: resolveLogLevel(process.env.LOG_LEVEL),
});
