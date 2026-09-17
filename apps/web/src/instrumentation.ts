/**
 * Process-level setup for the web app.
 *
 * Next.js calls `register()` once per server process, before the first
 * request. It is the only hook that runs outside a request, which makes it the
 * only place a shutdown handler can be installed — a route handler runs too
 * late and a module side effect runs on every hot reload.
 */

export async function register(): Promise<void> {
  // The edge runtime has no signals, no Redis client, and no Prisma. Guarding
  // on the runtime keeps the Node-only imports below out of that bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerShutdownHandlers } = await import("./server/shutdown");
  registerShutdownHandlers();
}
