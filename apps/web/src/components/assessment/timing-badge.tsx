import { Timer } from "lucide-react";
import type { ExecutionMode } from "@ambatucode/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * How an Assessment or one of its sessions is timed, said the same way
 * everywhere.
 *
 * The module overview, the assessment page, and each session card used to
 * phrase and colour this three different ways — amber on one, the accent on
 * the next, bare text on the third — so the same "45 min · Live" looked like a
 * warning in one place and an invitation in another. It is a fact about the
 * exam, not an alert, and it wears the neutral tone with the timer icon doing
 * the work.
 */
export function TimingBadge({
  durationMinutes,
  executionMode,
  ...props
}: {
  /** Null for an untimed Assessment or session. */
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
} & Omit<BadgeProps, "tone" | "children">) {
  if (durationMinutes === null) {
    return (
      <Badge tone="neutral" {...props}>
        Untimed
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" plain {...props}>
      <Timer size={12} aria-hidden />
      {durationMinutes} min
      {executionMode === null ? null : ` · ${executionMode === "LIVE" ? "Live" : "Individual"}`}
    </Badge>
  );
}
