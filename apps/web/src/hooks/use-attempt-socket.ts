"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLIENT_EVENTS,
  HEARTBEAT_INTERVAL_MS,
  SERVER_EVENTS,
  type AnticheatClipboardPayload,
  type AnticheatFocusPayload,
  type AttemptStatePayload,
  type AttemptWarningPayload,
  type SessionStatePayload,
} from "@ambatucode/shared";
import { measureSkew } from "@/lib/attempt-clock";
import { getSocket } from "@/lib/socket";

/**
 * The attempt's realtime connection: join, heartbeat, timing corrections, and
 * the three ways an attempt can end out from under the Coder.
 *
 * Everything the workspace knows about time comes through here, and all of it
 * originates server-side. The hook never decides that an attempt has expired,
 * never resumes a clock on its own, and never treats a dropped socket as a
 * verdict about the attempt — it only reports what the server last said.
 */

export type AttemptConnection = "CONNECTING" | "ONLINE" | "OFFLINE";

/**
 * Why the workspace stopped accepting work, when it did.
 *
 * All three are terminal and all three are the server's decision. The Coder
 * cannot dismiss their way back into an attempt that has ended.
 */
export type AttemptTerminal =
  { kind: "NONE" } | { kind: "SUPERSEDED" } | { kind: "AUTO_SUBMITTED"; submissionId: string };

export type AttemptTimerState = {
  /** Server epoch milliseconds. Compare only after adding `skewMs` to `Date.now()`. */
  deadlineMs: number | null;
  /** Server clock minus this browser's clock. */
  skewMs: number;
  paused: boolean;
  /** What the countdown shows while paused, when the clock is not running. */
  frozenRemainingMs: number | null;
};

export type UseAttemptSocketResult = {
  state: AttemptStatePayload | null;
  sessionState: SessionStatePayload | null;
  connection: AttemptConnection;
  timer: AttemptTimerState;
  warning: AttemptWarningPayload | null;
  dismissWarning: () => void;
  terminal: AttemptTerminal;
  reportFocus: (state: AnticheatFocusPayload["state"]) => void;
  reportClipboard: (action: AnticheatClipboardPayload["action"]) => void;
};

export function useAttemptSocket(input: {
  attemptId: string;
  /** From the server-rendered attempt view; a paused clock needs it to freeze. */
  durationMinutes: number | null;
  /** The deadline the page was rendered with, before the socket says anything. */
  initialDeadlineMs: number | null;
  initialServerTimeMs: number;
  initialPaused: boolean;
}): UseAttemptSocketResult {
  const { attemptId, durationMinutes, initialDeadlineMs, initialServerTimeMs, initialPaused } =
    input;

  const [state, setState] = useState<AttemptStatePayload | null>(null);
  const [sessionState, setSessionState] = useState<SessionStatePayload | null>(null);
  const [connection, setConnection] = useState<AttemptConnection>("CONNECTING");
  const [warning, setWarning] = useState<AttemptWarningPayload | null>(null);
  const [terminal, setTerminal] = useState<AttemptTerminal>({ kind: "NONE" });
  const [timer, setTimer] = useState<AttemptTimerState>(() => ({
    deadlineMs: initialDeadlineMs,
    skewMs: measureSkew(initialServerTimeMs),
    paused: initialPaused,
    frozenRemainingMs: null,
  }));

  const durationMs = useMemo(
    () => (durationMinutes === null ? null : durationMinutes * 60_000),
    [durationMinutes],
  );
  /** Read inside socket listeners, which close over their first render. */
  const durationRef = useRef(durationMs);
  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    const socket = getSocket();

    const join = () => {
      setConnection("ONLINE");
      socket.emit(CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    };

    const onAttemptState = (payload: AttemptStatePayload) => {
      setState(payload);
      setTimer({
        deadlineMs: payload.deadlineMs,
        skewMs: measureSkew(payload.serverTimeMs),
        paused: payload.paused,
        frozenRemainingMs: payload.paused ? payload.remainingMs : null,
      });
    };

    /**
     * A tick is the authoritative correction, and it carries a deadline
     * implicitly: `serverTimeMs + remainingMs` is where the server says this
     * attempt ends. Deriving it here rather than asking for one more field
     * also means a resumed Individual clock corrects itself within one tick,
     * with no extra round trip and no new event.
     */
    const onTick = (payload: { remainingMs: number; serverTimeMs: number }) => {
      setTimer((current) => ({
        ...current,
        deadlineMs: payload.serverTimeMs + payload.remainingMs,
        skewMs: measureSkew(payload.serverTimeMs),
        paused: false,
        frozenRemainingMs: null,
      }));
    };

    const onPaused = (payload: { consumedMs: number }) => {
      const total = durationRef.current;
      setTimer((current) => ({
        ...current,
        paused: true,
        deadlineMs: null,
        frozenRemainingMs: total === null ? null : Math.max(0, total - payload.consumedMs),
      }));
    };

    /**
     * The resume payload carries consumed time, not a new deadline, so this
     * rebuilds one from the time that was left. It is a bridge and nothing
     * more: the next `attempt:tick` replaces it with the server's own figure
     * within a few seconds, and the server is what enforces the deadline
     * regardless of what this number says.
     */
    const onResumed = (payload: { consumedMs: number }) => {
      const total = durationRef.current;
      setTimer((current) => {
        const remaining = total === null ? null : Math.max(0, total - payload.consumedMs);
        return {
          ...current,
          paused: false,
          frozenRemainingMs: null,
          deadlineMs:
            remaining === null ? current.deadlineMs : Date.now() + current.skewMs + remaining,
        };
      });
    };

    const onAutoSubmitted = (payload: { submissionId: string }) => {
      setTerminal({ kind: "AUTO_SUBMITTED", submissionId: payload.submissionId });
    };

    /**
     * Another device took this attempt over. There is no reclaiming it: trying
     * would start a tug of war between two browsers, and the Coder is standing
     * at whichever one they meant to use.
     */
    const onSuperseded = () => {
      setTerminal({ kind: "SUPERSEDED" });
    };

    const onWarning = (payload: AttemptWarningPayload) => setWarning(payload);
    const onSessionState = (payload: SessionStatePayload) => setSessionState(payload);
    const onDisconnect = () => setConnection("OFFLINE");

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on(SERVER_EVENTS.ATTEMPT_STATE, onAttemptState);
    socket.on(SERVER_EVENTS.ATTEMPT_TICK, onTick);
    socket.on(SERVER_EVENTS.ATTEMPT_PAUSED, onPaused);
    socket.on(SERVER_EVENTS.ATTEMPT_RESUMED, onResumed);
    socket.on(SERVER_EVENTS.ATTEMPT_AUTO_SUBMITTED, onAutoSubmitted);
    socket.on(SERVER_EVENTS.ATTEMPT_SUPERSEDED, onSuperseded);
    socket.on(SERVER_EVENTS.ATTEMPT_WARNING, onWarning);
    socket.on(SERVER_EVENTS.SESSION_STATE, onSessionState);

    // The session provider owns connecting; if it already has, `connect` will
    // not fire again and the join has to be made here.
    if (socket.connected) join();

    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit(CLIENT_EVENTS.ATTEMPT_HEARTBEAT, { attemptId });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeat);
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off(SERVER_EVENTS.ATTEMPT_STATE, onAttemptState);
      socket.off(SERVER_EVENTS.ATTEMPT_TICK, onTick);
      socket.off(SERVER_EVENTS.ATTEMPT_PAUSED, onPaused);
      socket.off(SERVER_EVENTS.ATTEMPT_RESUMED, onResumed);
      socket.off(SERVER_EVENTS.ATTEMPT_AUTO_SUBMITTED, onAutoSubmitted);
      socket.off(SERVER_EVENTS.ATTEMPT_SUPERSEDED, onSuperseded);
      socket.off(SERVER_EVENTS.ATTEMPT_WARNING, onWarning);
      socket.off(SERVER_EVENTS.SESSION_STATE, onSessionState);
    };
  }, [attemptId]);

  const reportFocus = useCallback(
    (focusState: AnticheatFocusPayload["state"]) => {
      const socket = getSocket();
      if (socket.connected)
        socket.emit(CLIENT_EVENTS.ANTICHEAT_FOCUS, { attemptId, state: focusState });
    },
    [attemptId],
  );

  const reportClipboard = useCallback(
    (action: AnticheatClipboardPayload["action"]) => {
      const socket = getSocket();
      if (socket.connected) socket.emit(CLIENT_EVENTS.ANTICHEAT_CLIPBOARD, { attemptId, action });
    },
    [attemptId],
  );

  const dismissWarning = useCallback(() => setWarning(null), []);

  return {
    state,
    sessionState,
    connection,
    timer,
    warning,
    dismissWarning,
    terminal,
    reportFocus,
    reportClipboard,
  };
}
