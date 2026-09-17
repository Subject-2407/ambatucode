"use client";

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Box, Flex } from "@chakra-ui/react";

/**
 * Two panes and a divider the user can drag.
 *
 * The ratio is kept per user in `localStorage`, which is the right storage for
 * it: it is a per-browser convenience, it means nothing to anyone else, and it
 * must never be something an attempt depends on. A blocked or cleared store
 * simply falls back to the default split.
 *
 * It is read through `useSyncExternalStore` rather than in an effect, because
 * this component is server-rendered: the server snapshot is the default split
 * and the browser's stored value replaces it on hydration, with no mismatch
 * and no frame of the wrong layout.
 *
 * The divider is a real `separator` with arrow-key support. During an
 * assessment a Coder may be working entirely from the keyboard, and a panel
 * they cannot resize without a mouse is a panel they cannot read.
 */

const KEYBOARD_STEP = 0.02;

/** Nothing else writes this key, so there is no change to subscribe to. */
function subscribe(): () => void {
  return () => undefined;
}

function serverSnapshot(): string | null {
  return null;
}

export function SplitPane({
  direction,
  storageKey,
  defaultRatio = 0.5,
  minRatio = 0.2,
  maxRatio = 0.8,
  first,
  second,
  label,
}: {
  direction: "horizontal" | "vertical";
  storageKey: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  first: ReactNode;
  second: ReactNode;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const horizontal = direction === "horizontal";

  const readStored = useCallback((): string | null => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);

  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot);
  /** Takes over the moment the user drags; the store is only the starting point. */
  const [dragged, setDragged] = useState<number | null>(null);

  const parsed = stored === null ? Number.NaN : Number.parseFloat(stored);
  const ratio = clamp(
    dragged ?? (Number.isFinite(parsed) ? parsed : defaultRatio),
    minRatio,
    maxRatio,
  );

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // A private window or blocked site data. The split still works for this
        // visit; it just will not be remembered.
      }
    },
    [storageKey],
  );

  const applyFromPointer = (clientX: number, clientY: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const raw = horizontal
      ? (clientX - bounds.left) / bounds.width
      : (clientY - bounds.top) / bounds.height;
    setDragged(clamp(raw, minRatio, maxRatio));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    applyFromPointer(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persist(ratio);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
    const increase = horizontal ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    const next = clamp(
      ratio + (event.key === increase ? KEYBOARD_STEP : -KEYBOARD_STEP),
      minRatio,
      maxRatio,
    );
    setDragged(next);
    persist(next);
  };

  const percent = `${String(Math.round(ratio * 1000) / 10)}%`;

  return (
    <Flex
      ref={containerRef}
      direction={horizontal ? "row" : "column"}
      height="100%"
      width="100%"
      minHeight="0"
      minWidth="0"
    >
      <Box
        flexBasis={percent}
        flexGrow="0"
        flexShrink="0"
        minWidth="0"
        minHeight="0"
        overflow="hidden"
      >
        {first}
      </Box>

      <Box
        role="separator"
        aria-label={label}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        flexShrink="0"
        width={horizontal ? "3px" : "100%"}
        height={horizontal ? "100%" : "3px"}
        bg="border.default"
        cursor={horizontal ? "col-resize" : "row-resize"}
        _hover={{ bg: "accent.solid" }}
        _focusVisible={{ bg: "accent.solid" }}
        touchAction="none"
      />

      <Box flex="1" minWidth="0" minHeight="0" overflow="hidden">
        {second}
      </Box>
    </Flex>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
