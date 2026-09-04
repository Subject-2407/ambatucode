import { prisma } from "@ambatucode/db";
import { getRedis } from "@/server/redis";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type HealthReport = {
  status: "ok" | "degraded";
  database: boolean;
  redis: boolean;
  serverTimeMs: number;
};

async function check(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

export const GET = route(async () => {
  const [database, redis] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(() => getRedis().ping()),
  ]);

  const report: HealthReport = {
    status: database && redis ? "ok" : "degraded",
    database,
    redis,
    serverTimeMs: Date.now(),
  };

  return ok(report, report.status === "ok" ? 200 : 503);
});
