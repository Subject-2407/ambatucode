import { GREETINGS } from "./greetings";

/**
 * The state machine behind the typed line on the title screen.
 *
 * It lives apart from the component for the same reason the lines themselves
 * do: the rotation getting stuck is a bug you want a test to catch, and a test
 * should not have to mount React and run fake timers to see one frame follow
 * another.
 */

const TYPE_MS = 55;
const HOLD_MS = 2600;
const ERASE_MS = 22;

type Phase = "typing" | "holding" | "erasing";
export type GreetingState = { index: number; typed: number; phase: Phase; started: boolean };
type State = GreetingState;

export const INITIAL_GREETING_STATE: State = {
  index: 0,
  typed: 0,
  phase: "typing",
  started: false,
};

/**
 * Picks a line other than the one showing.
 *
 * A plain `Math.random()` over the list can land on the line already on screen,
 * and the erase-and-retype that follows reads as the rotation being broken
 * rather than as a coincidence.
 */
function pickOther(current: number): number {
  const offset = 1 + Math.floor(Math.random() * (GREETINGS.length - 1));
  return (current + offset) % GREETINGS.length;
}

/**
 * Works out the next frame and how long to wait before showing it.
 *
 * Kept pure and outside the component so the effect only ever schedules — the
 * transition itself happens in the timer callback, never synchronously inside
 * the effect, which would cascade a render on every keystroke.
 */
export function advance(state: State): { next: State; delay: number } {
  // The first tick runs after mount, so it is the earliest point a random
  // choice can be made without the server and the client disagreeing. Nothing
  // has been typed yet, so swapping the line here is invisible.
  if (!state.started) {
    return {
      next: { ...state, index: Math.floor(Math.random() * GREETINGS.length), started: true },
      delay: 0,
    };
  }

  const line = GREETINGS[state.index] ?? "";

  if (state.phase === "typing") {
    return state.typed >= line.length
      ? { next: { ...state, phase: "holding" }, delay: HOLD_MS }
      : { next: { ...state, typed: state.typed + 1 }, delay: TYPE_MS };
  }

  if (state.phase === "holding") {
    return { next: { ...state, phase: "erasing" }, delay: ERASE_MS };
  }

  if (state.typed > 0) {
    return { next: { ...state, typed: state.typed - 1 }, delay: ERASE_MS };
  }

  return {
    next: {
      ...state,
      // Random rather than sequential: the list is short enough that a fixed
      // order becomes recognisable within a single sitting.
      index: pickOther(state.index),
      phase: "typing",
    },
    delay: TYPE_MS,
  };
}
