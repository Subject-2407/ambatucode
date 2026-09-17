"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthenticatedUser } from "@ambatucode/shared";
import { apiClient, isApiError } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type SessionContextValue = {
  user: AuthenticatedUser;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return value;
}

/** A revoked cookie can produce a burst of socket events; verify at most this often. */
const VERIFY_THROTTLE_MS = 3_000;

/**
 * Holds the authenticated user for client components and owns the socket
 * lifetime: connected once the user is known, torn down on logout.
 *
 * The user object comes from the Server Component layout that already
 * validated the session. This provider never decides who the user is — it only
 * reacts when the server says that user is no longer signed in.
 */
export function SessionProvider({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLoggingOut, setLoggingOut] = useState(false);
  const [superseded, setSuperseded] = useState(false);
  const lastVerifiedAt = useRef(0);
  /**
   * Set the moment a sign-out begins, and never cleared.
   *
   * Logging out revokes the session server-side, which drops this socket the
   * same way a rival login would. Without this flag the user's own deliberate
   * sign-out races the supersede notice and can end on a modal telling them
   * their account signed in somewhere else — alarming, and untrue.
   *
   * A ref rather than the `isLoggingOut` state because the socket listeners
   * below close over their first render and would keep reading `false`.
   */
  const isSigningOut = useRef(false);

  const logout = useCallback(async () => {
    isSigningOut.current = true;
    setLoggingOut(true);
    try {
      await apiClient.post("/api/auth/logout");
    } finally {
      disconnectSocket();
      queryClient.clear();
      setLoggingOut(false);
      router.replace(routes.login);
      router.refresh();
    }
  }, [queryClient, router]);

  useEffect(() => {
    const socket = connectSocket();

    /**
     * A dropped socket is not proof of anything: the realtime server may simply
     * be restarting. Only apps/web can say whether the session is still valid,
     * so the socket event is a trigger to ask, never the answer itself.
     */
    const verifySession = () => {
      // Our own sign-out already knows the session is gone.
      if (isSigningOut.current) return;

      const now = Date.now();
      if (now - lastVerifiedAt.current < VERIFY_THROTTLE_MS) return;
      lastVerifiedAt.current = now;

      void apiClient.get("/api/auth/me").catch((error: unknown) => {
        if (isApiError(error) && error.code === "UNAUTHENTICATED") {
          setSuperseded(true);
          disconnectSocket();
        }
      });
    };

    const onDisconnect = (reason: string) => {
      // The server hung up on us deliberately — the likeliest cause is this
      // account signing in somewhere else. Anything else is a transport blip
      // that socket.io will retry on its own.
      if (reason === "io server disconnect") verifySession();
    };

    // A rejected handshake is the other way a dead session shows up. Only the
    // auth rejection is worth checking: a transport failure repeats on every
    // backoff attempt and would turn an offline realtime server into a poll.
    const onConnectError = (error: Error) => {
      if (error.message === "UNAUTHENTICATED") verifySession();
    };

    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, []);

  const goToLogin = () => {
    queryClient.clear();
    router.replace(`${routes.login}?reason=superseded`);
    router.refresh();
  };

  return (
    <SessionContext.Provider value={{ user, logout, isLoggingOut }}>
      {children}
      <Modal
        open={superseded}
        onOpenChange={() => undefined}
        blocking
        title="You were signed out"
        description="This account signed in on another browser or device. Ambatucode allows one active session per account, so this one has ended."
        footer={
          <Button onClick={goToLogin} autoFocus>
            Sign in again
          </Button>
        }
      />
    </SessionContext.Provider>
  );
}
