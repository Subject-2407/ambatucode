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
 * The waiting room before an Assessment Session starts.
 *
 * The SRS has participants declare themselves READY so the Architect can see
 * who is actually at their machine before pressing Start. Three consequences
 * shape this hook.
 *
 * Presence is announced on arrival. Opening the lobby sends this visit's
 * readiness, which is what marks the Coder as here on the Architect's board —
 * otherwise a Coder sitting and waiting would look exactly like one who never
 * turned up.
 *
 * A reconnect re-sends the same answer. It used to send "not ready" on every
 * connect, so a Wi-Fi blip quietly withdrew a Coder's READY on the server
 * while their screen went on saying they were ready.
 *
 * Leaving says so. The socket outlives the page — it belongs to the whole app —
 * so without an explicit leave a Coder who wandered back to the dashboard
 * stayed "in the lobby", and ready, for as long as the tab was open.
 *
 * Reloading the page still clears READY. That is the honest behaviour: the
 * Architect is about to start an exam on the strength of that number, and a
 * reloaded page is not evidence that someone is sitting in front of it.
 */

export type LobbyState = {
  ready: boolean;
  /** True while the server has not yet confirmed the last change. */
  saving: boolean;
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
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<AssessmentSessionStatus | null>(null);
  const [counts, setCounts] = useState<SessionCounts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /** What this visit last said, read by the reconnect handler. */
  const readyRef = useRef(false);
  const startedRef = useRef(onStarted);
  useEffect(() => {
    startedRef.current = onStarted;
  }, [onStarted]);

  const emitReady = useCallback(
    (next: boolean) => {
      const socket = getSocket();
      if (!socket.connected) {
        // Sent on the next connect, which re-announces whatever readyRef says.
        return;
      }
      setSaving(true);
      const ack: AckFn = (result) => {
        setSaving(false);
        if (result.ok) {
          setProblem(null);
          return;
        }
        // The server refused — most often because the session has already
        // started or does not expect this Coder. Reflect its answer rather
        // than leaving the button claiming something untrue.
        readyRef.current = false;
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

    const announcePresence = () => emitReady(readyRef.current);

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
      if (socket.connected) socket.emit(CLIENT_EVENTS.LOBBY_LEAVE, { sessionId });
    };
  }, [emitReady, enabled, sessionId]);

  const setReady = useCallback(
    (next: boolean) => {
      readyRef.current = next;
      setReadyState(next);
      emitReady(next);
    },
    [emitReady],
  );

  return { ready, saving, status, counts, problem, setReady };
}
