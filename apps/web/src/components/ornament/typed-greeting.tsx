"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Box, Text } from "@chakra-ui/react";
import { GREETINGS } from "./greetings";
import { advance, INITIAL_GREETING_STATE, type GreetingState } from "./greeting-machine";

/**
 * The line under the wordmark on the title screen, typed one character at a
 * time and swapped for another after it has been read.
 *
 * It is the one place in the product allowed a joke. Everywhere else a Coder
 * is either learning or being graded, and neither is improved by the interface
 * being funny at them — but signing in is a moment of waiting, and a lab full
 * of students opening this page twice a week will read it more often than any
 * other string in the app.
 */

const STILLNESS = "(prefers-reduced-motion: reduce)";

function subscribeToStillness(onChange: () => void): () => void {
  const query = window.matchMedia(STILLNESS);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Read as external state rather than synced through an effect: the preference
 * exists before the first render, and discovering it afterwards would mean
 * typing one frame at somebody who asked for stillness.
 */
function usePrefersStillness(): boolean {
  return useSyncExternalStore(
    subscribeToStillness,
    () => window.matchMedia(STILLNESS).matches,
    () => false,
  );
}

export function TypedGreeting() {
  const still = usePrefersStillness();
  const [state, setState] = useState<GreetingState>(INITIAL_GREETING_STATE);

  useEffect(() => {
    // Stillness stops the rotation, but not the one pick that happens on
    // mount: otherwise this build only ever shows a single line, on every
    // machine that has animations turned off, forever.
    if (still && state.started) return;
    const { next, delay } = advance(state);
    const timer = setTimeout(() => setState(next), delay);
    return () => clearTimeout(timer);
  }, [still, state]);

  const line = GREETINGS[state.index] ?? "";
  // Stillness gets one line, whole, and no rotation. The joke survives; the
  // movement does not.
  const shown = still ? line : line.slice(0, state.typed);

  return (
    <Text
      // The mono stack, not the display face: this is a terminal line, and it
      // should read as one typed at a prompt rather than as a heading.
      textStyle="data"
      fontSize="sm"
      color="accent.fg"
      minHeight="1.5em"
      textAlign="center"
      /*
       * The text changes character by character, which a screen reader would
       * otherwise announce as a stream of fragments. It is decoration, so it is
       * hidden outright and nothing is lost.
       */
      aria-hidden
    >
      <Box as="span" opacity="0.6">
        {"> "}
      </Box>
      {shown}
      {still ? null : (
        <Box as="span" animation="caretBlink 1.1s steps(1, end) infinite">
          _
        </Box>
      )}
    </Text>
  );
}
