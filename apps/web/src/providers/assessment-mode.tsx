"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The one flag that says "an attempt is in progress on this screen".
 *
 * The SRS asks for the interface to calm down during a formal assessment:
 * navigation out of the way, gamification gone, the timer the most prominent
 * thing on screen. Driving that from a single flag rather than from
 * conditionals scattered through the shell is what keeps it from drifting —
 * there is exactly one place that decides what assessment mode looks like.
 */

type AssessmentModeValue = {
  active: boolean;
  setActive: (active: boolean) => void;
};

const AssessmentModeContext = createContext<AssessmentModeValue | null>(null);

export function AssessmentModeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <AssessmentModeContext.Provider value={value}>{children}</AssessmentModeContext.Provider>;
}

export function useAssessmentMode(): AssessmentModeValue {
  const value = useContext(AssessmentModeContext);
  if (!value) throw new Error("useAssessmentMode must be used inside an AssessmentModeProvider");
  return value;
}

/**
 * Holds assessment mode on for exactly as long as the calling component is
 * mounted, so navigating away — including through the browser's back button —
 * restores the ordinary shell without anyone having to remember to switch it
 * off.
 */
export function useEnterAssessmentMode(): void {
  const { setActive } = useAssessmentMode();
  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);
}
