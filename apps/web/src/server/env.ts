import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once on first access. Validation is lazy so
 * `next build` and unit tests do not require a populated environment just to
 * import a route module.
 *
 * Nothing here is prefixed NEXT_PUBLIC_, so none of it can reach the browser
 * bundle.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  EXECUTION_CALLBACK_SECRET: z.string().min(32),
  INTERNAL_API_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(300),
  // Left unset it follows NODE_ENV. It is overridable because a Secure cookie
  // sent over plain HTTP is discarded by the browser, and an offline-first lab
  // LAN without TLS is a deployment this product supports — there the flag has
  // to come off deliberately, not be discovered at a login screen that loops.
  SESSION_COOKIE_SECURE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment — ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getServerEnv().NODE_ENV === "production";
}

/**
 * Whether the session cookie carries the `Secure` attribute.
 *
 * Production by default, because that is where TLS belongs. The override is
 * for the deployment this product actually targets: a lab LAN served over
 * plain HTTP, where every browser drops a Secure cookie and no one can sign in.
 */
export function isSessionCookieSecure(): boolean {
  return getServerEnv().SESSION_COOKIE_SECURE ?? isProduction();
}
