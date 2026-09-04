import { z } from "zod";

const realtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  REALTIME_CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
});

export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

let cached: RealtimeEnv | null = null;

export function getEnv(): RealtimeEnv {
  if (cached) return cached;

  const parsed = realtimeEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid realtime environment — ${issues}`);
  }

  cached = parsed.data;
  return cached;
}
