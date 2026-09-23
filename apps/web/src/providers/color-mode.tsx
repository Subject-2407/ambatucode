"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import {
  COLOR_MODE_COOKIE,
  COLOR_MODE_COOKIE_MAX_AGE,
  DEFAULT_COLOR_MODE_PREFERENCE,
  type ColorMode,
  type ColorModePreference,
} from "@/lib/color-mode-cookie";

export type { ColorMode, ColorModePreference };

/**
 * The colour mode, held once for the whole app.
 *
 * This replaces `next-themes`, which keeps the preference in `localStorage`.
 * That storage is invisible to the server, so every server-rendered page —
 * which here is all of them — had to guess the theme and correct itself after
 * hydration. The cookie is sent with the document request, so the server puts
 * the right class on `<html>` and there is nothing to correct.
 *
 * The class it writes is `.dark`, which is exactly the selector Chakra's
 * `_dark` condition looks for, so no component changes.
 */

const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

type ColorModeContextValue = {
  /** What the reader chose. "system" is a choice, not the absence of one. */
  preference: ColorModePreference;
  /** What that resolves to right now; null until the device has been asked. */
  resolved: ColorMode | null;
  setPreference: (next: ColorModePreference) => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function systemColorMode(): ColorMode | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(SYSTEM_QUERY).matches ? "dark" : "light";
}

/**
 * Applies the mode to the document.
 *
 * `colorScheme` is set alongside the class so the browser's own chrome — form
 * controls, scrollbars, the canvas behind an overscroll — follows the app
 * instead of staying on the system default.
 */
function applyColorMode(mode: ColorMode, preference: ColorModePreference): void {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  root.dataset.colorModePreference = preference;
}

function writeCookie(preference: ColorModePreference): void {
  // `SameSite=Lax` is right for a preference: it rides top-level navigations,
  // which is what a server-rendered page is, and nothing else needs it.
  document.cookie = `${COLOR_MODE_COOKIE}=${preference}; path=/; max-age=${String(
    COLOR_MODE_COOKIE_MAX_AGE,
  )}; SameSite=Lax`;
}

export function ColorModeProvider({
  /** Read from the cookie on the server, so the first paint is already right. */
  initialPreference = DEFAULT_COLOR_MODE_PREFERENCE,
  children,
}: {
  initialPreference?: ColorModePreference;
  children: ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ColorModePreference>(initialPreference);
  // Deliberately null on the server and through hydration: under "system" the
  // answer lives on the device, and rendering a guess would mismatch the markup
  // the server sent. Consumers read `isReady` rather than papering over it.
  const [systemMode, setSystemMode] = useState<ColorMode | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SYSTEM_QUERY);
    const sync = () => setSystemMode(media.matches ? "dark" : "light");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const resolved: ColorMode | null = preference === "system" ? systemMode : preference;

  // The pre-paint script already set the class for the first render. This keeps
  // it in step afterwards: a preference change, and a device that flips while
  // the tab is open under "system".
  useEffect(() => {
    if (resolved === null) return;
    applyColorMode(resolved, preference);
  }, [resolved, preference]);

  const setPreference = useCallback((next: ColorModePreference) => {
    setPreferenceState(next);
    writeCookie(next);
    const mode = next === "system" ? systemColorMode() : next;
    if (mode) applyColorMode(mode, next);
  }, []);

  const value = useMemo<ColorModeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

/**
 * `resolved` is null on the server and through the first client render, which
 * is precisely the window in which the mode is unknown. `isReady` reports that
 * window rather than tracking mount separately.
 */
export function useColorMode() {
  const context = useContext(ColorModeContext);
  if (context === null) {
    throw new Error("useColorMode must be used inside ColorModeProvider");
  }
  const { preference, resolved, setPreference } = context;
  const colorMode: ColorMode = resolved ?? "light";

  return {
    colorMode,
    preference,
    isReady: resolved !== null,
    setPreference,
    setColorMode: setPreference,
    toggleColorMode: () => setPreference(colorMode === "dark" ? "light" : "dark"),
  };
}

/** The order the toggle walks. "System" is in the cycle, not hidden in a menu. */
const CYCLE: readonly ColorModePreference[] = ["system", "light", "dark"];

const PREFERENCE_LABEL: Readonly<Record<ColorModePreference, string>> = {
  system: "Follow device",
  light: "Light",
  dark: "Dark",
};

/**
 * One control, three states.
 *
 * A plain light/dark switch cannot express "follow my device", so choosing the
 * theme once would silently opt the reader out of their device ever changing it
 * again. Cycling through system keeps that choice reachable.
 */
export function ColorModeToggle({ size = "sm" }: { size?: "sm" | "md" }) {
  const { preference, colorMode, isReady, setPreference } = useColorMode();
  const next = CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length] ?? "system";

  const icon =
    preference === "system" ? (
      <Monitor aria-hidden />
    ) : colorMode === "dark" ? (
      <Moon aria-hidden />
    ) : (
      <Sun aria-hidden />
    );

  return (
    <IconButton
      aria-label={
        isReady
          ? `Theme: ${PREFERENCE_LABEL[preference]}. Switch to ${PREFERENCE_LABEL[next]}`
          : "Theme"
      }
      title={PREFERENCE_LABEL[preference]}
      size={size}
      onClick={() => setPreference(next)}
      disabled={!isReady}
    >
      {isReady ? icon : <Monitor aria-hidden />}
    </IconButton>
  );
}
