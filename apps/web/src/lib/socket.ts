import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@ambatucode/shared";
import { clientEnv } from "./env";

/**
 * The Socket.IO client singleton.
 *
 * There is no separate socket credential: apps/realtime authenticates the
 * handshake against the same session cookie apps/web issued, so connecting is
 * only meaningful once the user is authenticated. `connectSocket` is therefore
 * called from the session provider, never from a component, and
 * `disconnectSocket` runs on logout so a revoked cookie cannot keep a socket
 * alive.
 *
 * Reconnection is delegated to the client's own backoff: exponential from 500ms
 * to a 10s ceiling with jitter, retried indefinitely. An assessment attempt can
 * outlast a long outage, and giving up on it would strand a Coder mid-exam.
 */

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const RECONNECTION_DELAY_MS = 500;
const RECONNECTION_DELAY_MAX_MS = 10_000;

let socket: AppSocket | null = null;

function createSocket(): AppSocket {
  return io(clientEnv.NEXT_PUBLIC_REALTIME_URL, {
    path: "/socket.io",
    // The handshake carries the httpOnly session cookie; apps/realtime runs on
    // its own port, so credentials must be sent explicitly.
    withCredentials: true,
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: RECONNECTION_DELAY_MS,
    reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
    randomizationFactor: 0.5,
  });
}

/** Returns the singleton, creating it on first use. Does not connect. */
export function getSocket(): AppSocket {
  socket ??= createSocket();
  return socket;
}

export function connectSocket(): AppSocket {
  const instance = getSocket();
  if (!instance.connected) instance.connect();
  return instance;
}

/**
 * Tears the singleton down completely rather than just disconnecting it, so the
 * next login opens a fresh handshake instead of replaying listeners registered
 * under the previous session.
 */
export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
