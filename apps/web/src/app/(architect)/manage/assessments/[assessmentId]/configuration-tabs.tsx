"use client";

import { Checkbox, Stack, Text } from "@chakra-ui/react";
import {
  ASSESSMENT_DURATION_MINUTES,
  type ExecutionMode,
  type FocusLossAction,
  type GradingStrategy,
  type TimeMode,
} from "@ambatucode/shared";
import { TextField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import type { TabProps } from "./problem-tabs";

/** Execution and memory ceilings applied to every run and submission. */
export function LimitsTab({ draft, onChange }: TabProps) {
  return (
    <Stack gap="5" maxWidth="32rem">
      <TextField
        label="Time limit per test case (ms)"
        type="number"
        min={100}
        max={60_000}
        value={String(draft.timeLimitMs)}
        onChange={(event) =>
          onChange({ timeLimitMs: toInt(event.currentTarget.value, 100, 60_000) })
        }
        helperText="Wall-clock time a single case may take before it is cut off."
      />

      <TextField
        label="Memory limit (MB)"
        type="number"
        min={16}
        max={2_048}
        value={String(draft.memoryLimitMb)}
        onChange={(event) =>
          onChange({ memoryLimitMb: toInt(event.currentTarget.value, 16, 2_048) })
        }
        helperText="Applied to the sandbox container, not only to the program."
      />

      <SelectField
        label="Grading"
        value={draft.gradingStrategy}
        onChange={(value) => onChange({ gradingStrategy: value as GradingStrategy })}
        options={[
          { value: "WEIGHTED_AVERAGE", label: "Weighted average of the cases" },
          { value: "ALL_OR_NOTHING", label: "All or nothing" },
        ]}
        helperText="Weighted average gives partial credit; all or nothing scores 100 only when every case passes."
      />
    </Stack>
  );
}

/**
 * Timing, cascading rather than disabling.
 *
 * Choosing Untimed removes the duration and the execution mode from the form
 * entirely instead of greying them out, because they then have no value at all
 * — a greyed-out "30 minutes" invites the reading that the number still means
 * something.
 */
export function TimingTab({ draft, onChange }: TabProps) {
  return (
    <Stack gap="5" maxWidth="32rem">
      <SelectField
        label="Time constraint"
        value={draft.timeMode}
        onChange={(value) => onChange(applyTimeMode(value as TimeMode, draft.durationMinutes))}
        options={[
          { value: "UNTIMED", label: "Untimed" },
          { value: "TIMED", label: "Timed" },
        ]}
      />

      {draft.timeMode === "TIMED" ? (
        <>
          <TextField
            label="Duration (minutes)"
            type="number"
            min={ASSESSMENT_DURATION_MINUTES.min}
            max={ASSESSMENT_DURATION_MINUTES.max}
            value={String(draft.durationMinutes ?? ASSESSMENT_DURATION_MINUTES.min)}
            onChange={(event) =>
              onChange({
                durationMinutes: toInt(
                  event.currentTarget.value,
                  ASSESSMENT_DURATION_MINUTES.min,
                  ASSESSMENT_DURATION_MINUTES.max,
                ),
              })
            }
          />

          <SelectField
            label="Execution mode"
            value={draft.executionMode ?? "INDIVIDUAL"}
            onChange={(value) => onChange({ executionMode: value as ExecutionMode })}
            options={[
              { value: "INDIVIDUAL", label: "Individual — each Coder has their own timer" },
              { value: "LIVE", label: "Live — everyone shares one timer" },
            ]}
            helperText="An individual timer pauses while a Coder is disconnected. A live timer never pauses."
          />
        </>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          An untimed assessment has no deadline. Every other rule — one formal submission per
          attempt, grading, anti-cheat — still applies.
        </Text>
      )}

      <Text fontSize="xs" color="fg.muted">
        A session can override the duration and execution mode when it is created, so the same
        assessment can run 30 minutes live for one class and 45 minutes individual for another.
      </Text>
    </Stack>
  );
}

/** Switching away from TIMED clears what has no meaning outside it. */
function applyTimeMode(timeMode: TimeMode, currentDuration: number | null) {
  if (timeMode === "UNTIMED") {
    return { timeMode, durationMinutes: null, executionMode: null } as const;
  }
  return {
    timeMode,
    durationMinutes: currentDuration ?? 30,
    executionMode: "INDIVIDUAL" as ExecutionMode,
  };
}

/**
 * Anti-cheat.
 *
 * Every control here is a deterrent, and the copy says so: a determined Coder
 * with developer tools can defeat the client-side half of any of them. What
 * they cannot defeat is the log, which is the part that actually matters.
 */
export function AntiCheatTab({ draft, onChange }: TabProps) {
  const { antiCheat } = draft;
  const set = (changes: Partial<typeof antiCheat>) =>
    onChange({ antiCheat: { ...antiCheat, ...changes } });

  return (
    <Stack gap="5" maxWidth="32rem">
      <Toggle
        label="Restrict copy and paste"
        description="Blocks pasting into the editor and copying the problem statement out. Copying within a Coder's own code stays allowed."
        checked={antiCheat.blockClipboard}
        onChange={(checked) => set({ blockClipboard: checked })}
      />

      <Toggle
        label="Disable the right-click menu"
        description="Suppresses the browser context menu inside the workspace."
        checked={antiCheat.blockContextMenu}
        onChange={(checked) => set({ blockContextMenu: checked })}
      />

      <Toggle
        label="Detect leaving the window"
        description="Records when a Coder switches tabs or applications. Coders are told this is being recorded."
        checked={antiCheat.detectFocusLoss}
        onChange={(checked) => set({ detectFocusLoss: checked })}
      />

      {antiCheat.detectFocusLoss ? (
        <>
          <SelectField
            label="What happens on focus loss"
            value={antiCheat.focusLossAction}
            onChange={(value) => set({ focusLossAction: value as FocusLossAction })}
            options={[
              { value: "LOG_ONLY", label: "Log it only" },
              { value: "WARN", label: "Warn the Coder" },
              { value: "AUTO_SUBMIT", label: "Submit the attempt automatically" },
            ]}
            helperText="Every focus loss is logged whichever of these is chosen."
          />

          <TextField
            label="Losses tolerated first"
            type="number"
            min={0}
            max={100}
            value={String(antiCheat.focusLossThreshold)}
            onChange={(event) =>
              set({ focusLossThreshold: toInt(event.currentTarget.value, 0, 100) })
            }
            helperText="0 acts on the first one. 2 lets two pass and acts on the third."
          />
        </>
      ) : null}

      <Toggle
        label="Hide leaderboards during this assessment"
        description="Keeps competitive displays out of the way while an attempt is in progress."
        checked={antiCheat.hideLeaderboard}
        onChange={(checked) => set({ hideLeaderboard: checked })}
      />

      <Text fontSize="xs" color="fg.muted">
        These controls deter and record. They are not a security boundary, and a disconnect is never
        treated as cheating.
      </Text>
    </Stack>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Stack gap="1">
      <Checkbox.Root
        checked={checked}
        colorPalette="accent"
        onCheckedChange={(details) => onChange(details.checked === true)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>{label}</Checkbox.Label>
      </Checkbox.Root>
      <Text fontSize="xs" color="fg.muted" ps="6">
        {description}
      </Text>
    </Stack>
  );
}

/** A number input can hold anything, including nothing. Clamp rather than trust. */
function toInt(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}
