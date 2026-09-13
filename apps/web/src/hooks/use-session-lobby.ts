"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AckFn,
  type AssessmentSessionStatus,
  type SessionCounts,
  type SessionStartedPayload,
  type SessionStatePayload,
} from "@ambatucode/shared";
import { getSocket } from "@/lib/socket";

/**
 * The waiting room before a Live Assessment Session starts.
 *
 * The SRS has participants declare themselves READY so the Architect can see
 * who is actually at their machine before pressing Start. Two consequences
 * shape this hook.
 *
 * Presence is announced on arrival. Opening the lobby emits readiness as
 * `false`, which is what marks the participant ONLINE on the Architect's
 * board — otherwise a Coder sitting and waiting would be indistinguishable
 * from one who never turned up.
 *
 * Reloading the page therefore clears READY. That is the honest behaviour: the
 * Architect is about to start an exam on the strength of that number, and a
 * browser that has just been reloaded is not evidence that someone is sitting
 * in front of it.
 */

export type LobbyState = {
  ready: boolean;
  status: AssessmentSessionStatus | null;
  counts: SessionCounts | null;
  /** Set when the server refused a readiness change, with its reason. */
  problem: string | null;
  setReady: (ready: boolean) => void;
};

export function useSessionLobby(input: {
  sessionId: string;
  enabled: boolean;
  /** Fired when the Architect starts the session. */
  onStarted: (payload: SessionStartedPayload) => void;
}): LobbyState {
  const { sessionId, enabled, onStarted } = input;

  const [ready, setReadyState] = useState(false);
  const [status, setStatus] = useState<AssessmentSessionStatus | null>(null);
  const [counts, setCounts] = useState<SessionCounts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const startedRef = useRef(onStarted);
  useEffect(() => {
    startedRef.current = onStarted;
  }, [onStarted]);

  const emitReady = useCallback(
    (next: boolean) => {
      const socket = getSocket();
      if (!socket.connected) return;
      const ack: AckFn = (result) => {
        if (result.ok) {
          setProblem(null);
          return;
        }
        // The server refused — most often because the session has already
        // started or this Coder is not on its list. Reflect its answer rather
        // than leaving the toggle claiming something untrue.
        setReadyState(false);
        setProblem(result.message);
      };
      socket.emit(CLIENT_EVENTS.ATTEMPT_READY, { sessionId, ready: next }, ack);
    },
    [sessionId],
  );

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const announcePresence = () => emitReady(false);

    const onSessionState = (payload: SessionStatePayload) => {
      if (payload.sessionId !== sessionId) return;
      setStatus(payload.status);
      setCounts(payload.counts);
    };

    const onSessionStarted = (payload: SessionStartedPayload) => {
      if (payload.sessionId !== sessionId) return;
      setStatus("RUNNING");
      startedRef.current(payload);
    };

    socket.on("connect", announcePresence);
    socket.on(SERVER_EVENTS.SESSION_STATE, onSessionState);
    socket.on(SERVER_EVENTS.SESSION_STARTED, onSessionStarted);
    if (socket.connected) announcePresence();

    return () => {
      socket.off("connect", announcePresence);
      socket.off(SERVER_EVENTS.SESSION_STATE, onSessionState);
      socket.off(SERVER_EVENTS.SESSION_STARTED, onSessionStarted);
    };
  }, [emitReady, enabled, sessionId]);

  const setReady = useCallback(
    (next: boolean) => {
      setReadyState(next);
      emitReady(next);
    },
    [emitReady],
  );

  return { ready, status, counts, problem, setReady };
}
