"use client";

import { useState } from "react";
import { Checkbox, Stack, Text } from "@chakra-ui/react";
import {
  ASSESSMENT_DURATION_MINUTES,
  type ExecutionMode,
  type ExitPolicy,
  type FocusLossAction,
  type GradingStrategy,
  type TimeMode,
} from "@ambatucode/shared";
import { TextField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { describeRange, readInt, settleInt, typingProblem, type IntRange } from "./number-input";
import type { TabProps } from "./problem-tabs";

// Mirrors the bounds in the shared assessment schema, which is what the server
// enforces. Duration already has a named constant there and uses it.
const TIME_LIMIT_MS: IntRange = { min: 100, max: 60_000 };
const MEMORY_LIMIT_MB: IntRange = { min: 16, max: 2_048 };
const FOCUS_LOSS_THRESHOLD: IntRange = { min: 0, max: 100 };

/** Execution and memory ceilings applied to every run and submission. */
export function LimitsTab({ draft, onChange }: TabProps) {
  return (
    <Stack gap="5" maxWidth="32rem">
      <NumberField
        label="Time limit per test case (ms)"
        range={TIME_LIMIT_MS}
        value={draft.timeLimitMs}
        onChange={(timeLimitMs) => onChange({ timeLimitMs })}
      />

      <NumberField
        label="Memory limit (MB)"
        range={MEMORY_LIMIT_MB}
        value={draft.memoryLimitMb}
        onChange={(memoryLimitMb) => onChange({ memoryLimitMb })}
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
          <NumberField
            label="Duration (minutes)"
            range={ASSESSMENT_DURATION_MINUTES}
            value={draft.durationMinutes ?? ASSESSMENT_DURATION_MINUTES.min}
            onChange={(durationMinutes) => onChange({ durationMinutes })}
          />

          <SelectField
            label="Execution mode"
            value={draft.executionMode ?? "INDIVIDUAL"}
            onChange={(value) =>
              onChange({
                executionMode: value as ExecutionMode,
                // Cleared rather than left behind: the two are mutually
                // exclusive, and the server refuses the pair outright.
                ...(value === "LIVE" ? { isOpenAccess: false } : {}),
              })
            }
            options={[
              { value: "INDIVIDUAL", label: "Individual" },
              { value: "LIVE", label: "Live" },
            ]}
            helperText="An individual timer pauses while a Coder is disconnected. A live timer never pauses."
          />
        </>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          An untimed assessment has no deadline.
        </Text>
      )}

      {/* What leaving the workspace means. It belongs beside timing rather
          than under anti-cheat: for an untimed exercise this is a convenience,
          and only in an exam does it become a control. */}
      <SelectField
        label="Leaving the workspace"
        value={draft.exitPolicy}
        onChange={(value) => onChange({ exitPolicy: value as ExitPolicy })}
        options={[
          { value: "RESUME", label: "Keep the attempt open" },
          { value: "SUBMIT", label: "Submits the attempt, after a warning" },
          { value: "BLOCKED", label: "Block leaving" },
        ]}
        helperText="Coming back resumes the saved draft. An individual timer pauses while the Coder is away; a live one does not."
      />

      {/* Open access sits with timing because that is what it interacts with:
          a live assessment cannot be open, and an individual one that is open
          starts its timer the moment the Coder does. */}
      <Toggle
        label="Open access"
        description="Any Coder enrolled in the module can start this assessment whenever they like, without a session being scheduled for them."
        checked={draft.isOpenAccess}
        onChange={(checked) => onChange({ isOpenAccess: checked })}
        disabled={draft.executionMode === "LIVE"}
      />

      {draft.executionMode === "LIVE" ? (
        <Text fontSize="sm" color="fg.muted">
          A live assessment cannot be open access.
        </Text>
      ) : null}

      <Text fontSize="xs" color="fg.muted">
        A session can override the duration and execution mode when it is created.
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
          />

          <NumberField
            label="Losses tolerated first"
            range={FOCUS_LOSS_THRESHOLD}
            value={antiCheat.focusLossThreshold}
            onChange={(focusLossThreshold) => set({ focusLossThreshold })}
            helperText="0 acts on the first one. 2 lets two pass and acts on the third."
          />
        </>
      ) : null}

      <Toggle
        label="Hide leaderboards during this assessment"
        checked={antiCheat.hideLeaderboard}
        onChange={(checked) => set({ hideLeaderboard: checked })}
      />
    </Stack>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The reason is always spelled out beside it; a dead control on its own is a puzzle. */
  disabled?: boolean;
}) {
  return (
    <Stack gap="1">
      <Checkbox.Root
        checked={checked}
        disabled={disabled}
        colorPalette="accent"
        onCheckedChange={(details) => onChange(details.checked === true)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>{label}</Checkbox.Label>
      </Checkbox.Root>
      {description ? (
        <Text fontSize="xs" color="fg.muted" ps="6">
          {description}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * A whole number, held as the text being typed and committed to the draft only
 * once that text reads as a number in range. Leaving the field pulls whatever
 * is there into range, so the draft never holds a value the server refuses —
 * and the Architect watches the correction happen rather than finding it later.
 */
function NumberField({
  label,
  range,
  value,
  onChange,
  helperText,
}: {
  label: string;
  range: IntRange;
  value: number;
  onChange: (value: number) => void;
  helperText?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [committed, setCommitted] = useState(value);

  // A value set from outside — the server, a reload — replaces the text. One
  // that came from this field's own typing is already on screen, perhaps as
  // "0250", and rewriting it under the cursor would fight the Architect.
  if (value !== committed) {
    setCommitted(value);
    const current = readInt(raw, range);
    if (current.kind !== "valid" || current.value !== value) setRaw(String(value));
  }

  const rangeText = describeRange(range);

  return (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      min={range.min}
      max={range.max}
      value={raw}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setRaw(next);
        const reading = readInt(next, range);
        if (reading.kind === "valid" && reading.value !== value) onChange(reading.value);
      }}
      onBlur={() => {
        const settled = settleInt(raw, range, value);
        setRaw(String(settled));
        if (settled !== value) onChange(settled);
      }}
      errorText={typingProblem(readInt(raw, range), range)}
      helperText={helperText ? `${rangeText} ${helperText}` : rangeText}
    />
  );
}
