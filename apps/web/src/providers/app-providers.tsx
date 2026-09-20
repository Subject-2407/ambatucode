"use client";

import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@/theme";
import { Toaster } from "@/components/ui/toaster";
import type { ColorModePreference } from "@/lib/color-mode-cookie";
import { ColorModeProvider } from "./color-mode";
import { QueryProvider } from "./query-client";

/**
 * Every client-side provider the app needs, mounted once in the root layout.
 *
 * Deliberately not here: SessionProvider. It needs an authenticated user, which
 * only a role layout has, and mounting it at the root would open a socket on
 * the login page.
 */
export function AppProviders({
  colorModePreference,
  children,
}: {
  /** Read from the cookie by the root layout; the server knows it, so we do. */
  colorModePreference: ColorModePreference;
  children: ReactNode;
}) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider initialPreference={colorModePreference}>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
