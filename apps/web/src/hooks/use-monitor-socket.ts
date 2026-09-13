"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type MonitorEventPayload,
  type MonitorParticipantPayload,
  type SessionStatePayload,
} from "@ambatucode/shared";
import { getSocket } from "@/lib/socket";

/**
 * The Architect's live view of one Assessment Session.
 *
 * A session of a hundred participants produces a burst of events every time
 * something happens to all of them at once — a start, a deadline, a lab's
 * network hiccup. Applying each one as it arrives would re-render the grid
 * hundreds of times a second, so arrivals are buffered and flushed once per
 * animation frame. The feed stays live; the render does not.
 */

/** Enough scrollback to explain what just happened, bounded so it cannot grow forever. */
const MAX_EVENTS = 500;

export type MonitorFeed = {
  sessionState: SessionStatePayload | null;
  /** Keyed by user id; the latest delta for each participant wins. */
  participants: ReadonlyMap<string, MonitorParticipantPayload>;
  /** Newest first, so the stream reads from the top. */
  events: MonitorEventPayload[];
  connected: boolean;
};

export function useMonitorSocket(input: {
  sessionId: string;
  /** Seeds from the HTTP snapshot so the feed continues rather than starts. */
  initialEvents?: MonitorEventPayload[];
}): MonitorFeed {
  const { sessionId, initialEvents } = input;

  const [sessionState, setSessionState] = useState<SessionStatePayload | null>(null);
  const [participants, setParticipants] = useState<ReadonlyMap<string, MonitorParticipantPayload>>(
    () => new Map(),
  );
  const [events, setEvents] = useState<MonitorEventPayload[]>(() =>
    initialEvents ? [...initialEvents].reverse() : [],
  );
  const [connected, setConnected] = useState(false);

  /** Arrivals since the last frame. Flushed together, never applied one by one. */
  const pendingParticipants = useRef<MonitorParticipantPayload[]>([]);
  const pendingEvents = useRef<MonitorEventPayload[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const flush = () => {
      frame.current = null;

      const participantBatch = pendingParticipants.current;
      if (participantBatch.length > 0) {
        pendingParticipants.current = [];
        setParticipants((current) => {
          const next = new Map(current);
          for (const participant of participantBatch) next.set(participant.userId, participant);
          return next;
        });
      }

      const eventBatch = pendingEvents.current;
      if (eventBatch.length > 0) {
        pendingEvents.current = [];
        setEvents((current) => [...eventBatch.reverse(), ...current].slice(0, MAX_EVENTS));
      }
    };

    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(flush);
    };

    const join = () => {
      setConnected(true);
      socket.emit(CLIENT_EVENTS.MONITOR_JOIN, { sessionId });
    };

    const onSessionState = (payload: SessionStatePayload) => {
      if (payload.sessionId !== sessionId) return;
      setSessionState(payload);
    };

    const onParticipant = (payload: MonitorParticipantPayload) => {
      if (payload.sessionId !== sessionId) return;
      pendingParticipants.current.push(payload);
      schedule();
    };

    const onEvent = (payload: MonitorEventPayload) => {
      if (payload.sessionId !== sessionId) return;
      pendingEvents.current.push(payload);
      schedule();
    };

    const onDisconnect = () => setConnected(false);

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on(SERVER_EVENTS.SESSION_STATE, onSessionState);
    socket.on(SERVER_EVENTS.MONITOR_PARTICIPANT, onParticipant);
    socket.on(SERVER_EVENTS.MONITOR_EVENT, onEvent);
    if (socket.connected) join();

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pendingParticipants.current = [];
      pendingEvents.current = [];
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off(SERVER_EVENTS.SESSION_STATE, onSessionState);
      socket.off(SERVER_EVENTS.MONITOR_PARTICIPANT, onParticipant);
      socket.off(SERVER_EVENTS.MONITOR_EVENT, onEvent);
    };
  }, [sessionId]);

  return { sessionState, participants, events, connected };
}
