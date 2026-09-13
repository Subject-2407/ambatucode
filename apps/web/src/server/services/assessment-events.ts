import "server-only";
import { toJsonInput, type Prisma } from "@ambatucode/db";
import type { AssessmentEventType, MonitorEventPayload } from "@ambatucode/shared";
import { publishAssessmentBroadcast } from "../realtime/publish";
import { toMonitorEventPayload } from "../serializers/assessment";

/**
 * The meaningful-event log, as apps/web writes it.
 *
 * Written inside the caller's transaction so an event can never describe a
 * transition that rolled back, and announced only after commit so the monitor
 * never shows one either. Heartbeats never come through here.
 */

export type EventInput = {
  sessionId: string;
  type: AssessmentEventType;
  userId?: string | null;
  attemptId?: string | null;
  durationMs?: number | null;
  occurredAt?: Date;
  /** Small readable facts only. Never source code, never test data. */
  payload?: Record<string, string | number | boolean | null>;
};

export async function recordEvent(
  client: Prisma.TransactionClient,
  input: EventInput,
): Promise<MonitorEventPayload> {
  const row = await client.assessmentEvent.create({
    data: {
      sessionId: input.sessionId,
      type: input.type,
      userId: input.userId ?? null,
      attemptId: input.attemptId ?? null,
      durationMs: input.durationMs ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      payloadJson: toJsonInput(input.payload ?? {}),
    },
    select: {
      id: true,
      sessionId: true,
      userId: true,
      attemptId: true,
      type: true,
      durationMs: true,
      occurredAt: true,
      payloadJson: true,
    },
  });
  return toMonitorEventPayload(row);
}

export async function announceEvents(events: readonly MonitorEventPayload[]): Promise<void> {
  for (const event of events) {
    await publishAssessmentBroadcast({ type: "MONITOR_EVENT", payload: event });
  }
}
