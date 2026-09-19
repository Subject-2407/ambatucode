import { afterEach, describe, expect, it, vi } from "vitest";
import { GREETINGS } from "./greetings";
import { advance, INITIAL_GREETING_STATE, type GreetingState } from "./greeting-machine";

/**
 * The rotation silently stopping is the failure mode worth guarding: nothing
 * throws, nothing logs, the line simply sits there and the title screen looks
 * like a static image somebody forgot to finish.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drives the machine as the component does, without timers or a renderer. */
function run(steps: number, state: GreetingState = INITIAL_GREETING_STATE): GreetingState[] {
  const seen: GreetingState[] = [];
  let current = state;
  for (let step = 0; step < steps; step += 1) {
    current = advance(current).next;
    seen.push(current);
  }
  return seen;
}

describe("advance", () => {
  it("picks a line on the first tick rather than at render, so SSR matches", () => {
    expect(INITIAL_GREETING_STATE.started).toBe(false);
    const { next, delay } = advance(INITIAL_GREETING_STATE);
    expect(next.started).toBe(true);
    expect(next.typed).toBe(0);
    // Nothing is on screen yet, so the swap costs no frame.
    expect(delay).toBe(0);
  });

  it("types the whole line, holds it, then erases it back to nothing", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const line = GREETINGS[0] ?? "";

    const frames = run(1 + line.length + 1 + 1 + line.length);
    const typed = frames.map((frame) => frame.typed);

    expect(Math.max(...typed)).toBe(line.length);
    expect(frames.at(-1)?.typed).toBe(0);
    expect(frames.some((frame) => frame.phase === "holding")).toBe(true);
    expect(frames.some((frame) => frame.phase === "erasing")).toBe(true);
  });

  it("always comes back round to typing a new line", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const line = GREETINGS[0] ?? "";

    // One full cycle plus the first frame of the next.
    const frames = run(1 + line.length + 1 + 1 + line.length + 1);
    const last = frames.at(-1);

    expect(last?.phase).toBe("typing");
    expect(last?.index).not.toBe(0);
  });

  it("never swaps a line for itself, which would read as being stuck", () => {
    // Every draw the generator can produce, at the moment a swap happens.
    for (const draw of [0, 0.25, 0.5, 0.75, 0.999999]) {
      vi.spyOn(Math, "random").mockReturnValue(draw);
      for (let index = 0; index < GREETINGS.length; index += 1) {
        const erased: GreetingState = { index, typed: 0, phase: "erasing", started: true };
        const { next } = advance(erased);
        expect(next.index, `draw ${draw} from line ${index}`).not.toBe(index);
        expect(next.index).toBeGreaterThanOrEqual(0);
        expect(next.index).toBeLessThan(GREETINGS.length);
      }
      vi.restoreAllMocks();
    }
  });
});
