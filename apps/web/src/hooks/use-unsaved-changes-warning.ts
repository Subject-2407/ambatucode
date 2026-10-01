"use client";

import { useEffect } from "react";

/**
 * Asks the browser to confirm before the tab is closed, reloaded, or pointed
 * at another site while `active` is true.
 *
 * It covers leaving the document and nothing else. A client-side navigation
 * inside the app never fires `beforeunload`, so a screen holding unsaved work
 * still has to guard its own links and selections.
 *
 * No message is offered: every current browser shows its own wording and
 * ignores whatever a page supplies.
 */
export function useUnsavedChangesWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // The older half of the protocol, which some engines still require
      // before they will show the prompt at all.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
