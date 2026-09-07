import { z } from "zod";

/**
 * Browser-visible configuration. Only NEXT_PUBLIC_* variables may appear here —
 * anything else belongs in `src/server/env.ts` and must never cross into a
 * client bundle.
 *
 * Each variable is read as a static `process.env.NEXT_PUBLIC_*` member so
 * Next.js can inline it at build time; a dynamic lookup would resolve to
 * `undefined` in the browser.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_REALTIME_URL: z.string().url().default("http://localhost:3001"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

function parseClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid client environment — ${issues}`);
  }

  return parsed.data;
}

export const clientEnv = parseClientEnv();
