import type { MonitorEventPayload } from "@ambatucode/shared";

/**
 * Combines the live feed with the HTTP snapshot's backlog: newest first, each
 * event once, at most `limit` of them.
 *
 * The two overlap whenever an event lands between the snapshot being read and
 * the monitor room being joined, so an event can arrive both ways. It is one
 * event, and the Architect should see it once.
 */
export function mergeEvents(
  live: readonly MonitorEventPayload[],
  snapshot: readonly MonitorEventPayload[],
  limit: number,
): MonitorEventPayload[] {
  const byId = new Map<string, MonitorEventPayload>();
  for (const event of [...snapshot, ...live]) byId.set(event.id, event);
  return [...byId.values()]
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, limit);
}
