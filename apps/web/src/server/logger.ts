import "server-only";
import { createLogger, resolveLogLevel, type Logger } from "@ambatucode/shared";

/**
 * The web app's logger.
 *
 * Built once at module load rather than through `getServerEnv()`, so a
 * configuration failure can still be logged — a logger that needs valid
 * configuration to exist cannot report that the configuration is invalid.
 */
export const log: Logger = createLogger({
  service: "web",
  level: resolveLogLevel(process.env.LOG_LEVEL),
});
