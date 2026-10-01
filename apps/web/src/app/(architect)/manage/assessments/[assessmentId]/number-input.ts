/**
 * What the text in a bounded whole-number field means, read while the
 * Architect is still typing it.
 *
 * The field holds the raw text and only commits a number once that text reads
 * as one in range. Clamping every keystroke instead made some values
 * impossible to type: clearing "5000" to write "250" snapped the empty field
 * to the minimum, and the first digit of anything below the minimum did the
 * same.
 */

export type IntRange = { min: number; max: number };

export type IntReading =
  | { kind: "valid"; value: number }
  | { kind: "empty" }
  | { kind: "not-a-number" }
  /** Too small for now, though more digits could still fix it. */
  | { kind: "below" }
  /** Too large, and no further digit can make it smaller. */
  | { kind: "above" };

export function readInt(raw: string, range: IntRange): IntReading {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  // Digits only: `parseInt` would take "12abc" as 12 and "1e3" as 1.
  if (!/^-?\d+$/.test(text)) return { kind: "not-a-number" };

  const value = Number.parseInt(text, 10);
  if (value < range.min) return { kind: "below" };
  if (value > range.max) return { kind: "above" };
  return { kind: "valid", value };
}

/**
 * The number a field settles on once the Architect leaves it: the value they
 * typed, pulled into range, or `fallback` when the text was never a number.
 */
export function settleInt(raw: string, range: IntRange, fallback: number): number {
  const reading = readInt(raw, range);
  switch (reading.kind) {
    case "valid":
      return reading.value;
    case "below":
      return range.min;
    case "above":
      return range.max;
    case "empty":
    case "not-a-number":
      return fallback;
  }
}

/** "Between 100 and 60,000." — the range spelled out under the field. */
export function describeRange(range: IntRange, unit?: string): string {
  const suffix = unit ? ` ${unit}` : "";
  return `Between ${formatInt(range.min)} and ${formatInt(range.max)}${suffix}.`;
}

/**
 * The problem worth interrupting the Architect for while they type, or null.
 *
 * Only the readings no further keystroke can repair: a value above the maximum
 * only grows with another digit, and text that is not a number stays that way.
 * A value below the minimum is usually the first digit of a valid one, so it
 * waits for the field to be left before anything is said.
 */
export function typingProblem(reading: IntReading, range: IntRange): string | null {
  if (reading.kind === "above") return `At most ${formatInt(range.max)}.`;
  if (reading.kind === "not-a-number") return "Whole numbers only.";
  return null;
}

function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}
