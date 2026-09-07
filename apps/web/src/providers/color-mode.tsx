"use client";

import { Moon, Sun } from "lucide-react";
import { ThemeProvider, useTheme, type ThemeProviderProps } from "next-themes";
import { IconButton } from "@/components/ui/button";

/**
 * next-themes drives the `.dark` class on <html>, which is exactly the selector
 * Chakra's `_dark` condition looks for. `disableTransitionOnChange` stops every
 * themed element animating at once when the mode flips.
 */
export function ColorModeProvider(props: Omit<ThemeProviderProps, "attribute">) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange {...props} />
  );
}

export type ColorMode = "light" | "dark";

/**
 * `resolvedTheme` is undefined on the server and through the first client
 * render, which is precisely the window in which the resolved mode is unknown.
 * `isReady` reports that window rather than tracking mount separately.
 */
export function useColorMode() {
  const { resolvedTheme, setTheme } = useTheme();
  const colorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";
  return {
    colorMode,
    isReady: resolvedTheme !== undefined,
    setColorMode: setTheme,
    toggleColorMode: () => setTheme(colorMode === "dark" ? "light" : "dark"),
  };
}

export function ColorModeToggle() {
  const { colorMode, isReady, toggleColorMode } = useColorMode();

  return (
    <IconButton
      aria-label={isReady ? `Switch to ${colorMode === "dark" ? "light" : "dark"} mode` : "Theme"}
      size="sm"
      onClick={toggleColorMode}
      disabled={!isReady}
    >
      {isReady && colorMode === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </IconButton>
  );
}
