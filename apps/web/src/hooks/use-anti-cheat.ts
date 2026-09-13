"use client";

import { useEffect, type RefObject } from "react";
import type { AnticheatClipboardPayload, AnticheatFocusPayload } from "@ambatucode/shared";
import type { AntiCheatConfig } from "@ambatucode/shared";
import { FOCUS_LOSS_DEBOUNCE_MS, blocksClipboardEvent } from "@/lib/anti-cheat";

/**
 * The client-side anti-cheat controls, driven entirely by the Assessment's own
 * configuration.
 *
 * What happens about a focus loss is not decided here. This hook reports; the
 * server counts, applies the configured threshold, and answers with a warning
 * or an auto-submit. That split is deliberate — a Coder who tampers with this
 * file can stop the reports, but cannot invent an attempt state.
 */
export function useAntiCheat(input: {
  enabled: boolean;
  config: AntiCheatConfig;
  /** The workspace root. Clipboard and context-menu handlers bind here. */
  rootRef: RefObject<HTMLElement | null>;
  /** The editor within it, where an internal copy stays allowed. */
  editorRef: RefObject<HTMLElement | null>;
  onFocus: (state: AnticheatFocusPayload["state"]) => void;
  onClipboard: (action: AnticheatClipboardPayload["action"]) => void;
}): void {
  const { enabled, config, rootRef, editorRef, onFocus, onClipboard } = input;
  const { blockClipboard, blockContextMenu, detectFocusLoss } = config;

  // Clipboard. The `copy`/`cut`/`paste` events are the accurate signal — they
  // fire for the keyboard chord, the context menu, and the browser's own menu
  // alike, so there is no separate keydown handler to double-count them.
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !blockClipboard || !root) return;

    const handle = (action: AnticheatClipboardPayload["action"]) => (event: Event) => {
      const target = event.target;
      const insideEditor =
        target instanceof Node && (editorRef.current?.contains(target) ?? false);
      if (!blocksClipboardEvent({ action, insideEditor })) return;
      event.preventDefault();
      onClipboard(action);
    };

    const onCopy = handle("COPY");
    const onCut = handle("CUT");
    const onPaste = handle("PASTE");

    // Capture phase, so Monaco's own handlers do not get there first.
    root.addEventListener("copy", onCopy, true);
    root.addEventListener("cut", onCut, true);
    root.addEventListener("paste", onPaste, true);
    return () => {
      root.removeEventListener("copy", onCopy, true);
      root.removeEventListener("cut", onCut, true);
      root.removeEventListener("paste", onPaste, true);
    };
  }, [blockClipboard, editorRef, enabled, onClipboard, rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !blockContextMenu || !root) return;

    const onContextMenu = (event: Event) => {
      event.preventDefault();
      onClipboard("CONTEXT_MENU");
    };
    root.addEventListener("contextmenu", onContextMenu, true);
    return () => root.removeEventListener("contextmenu", onContextMenu, true);
  }, [blockContextMenu, enabled, onClipboard, rootRef]);

  /**
   * Focus. Debounced in both directions so the browser's own momentary blurs —
   * opening a dialog, clicking the address bar and coming straight back — do
   * not reach an Architect's feed as an incident.
   *
   * `visibilitychange` and `window.blur` are watched together because neither
   * covers the other: switching tabs fires visibility, moving to another
   * application fires blur, and some platforms fire only one of the two.
   */
  useEffect(() => {
    if (!enabled || !detectFocusLoss) return;

    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    let reported = false;

    const wentAway = () => {
      if (reported || awayTimer !== null) return;
      awayTimer = setTimeout(() => {
        awayTimer = null;
        reported = true;
        onFocus("LOST");
      }, FOCUS_LOSS_DEBOUNCE_MS);
    };

    const cameBack = () => {
      if (awayTimer !== null) {
        clearTimeout(awayTimer);
        awayTimer = null;
      }
      if (!reported) return;
      reported = false;
      onFocus("REGAINED");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") wentAway();
      else cameBack();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", wentAway);
    window.addEventListener("focus", cameBack);
    return () => {
      if (awayTimer !== null) clearTimeout(awayTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", wentAway);
      window.removeEventListener("focus", cameBack);
    };
  }, [detectFocusLoss, enabled, onFocus]);
}
