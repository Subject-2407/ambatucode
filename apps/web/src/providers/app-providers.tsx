"use client";

import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@/theme";
import { Toaster } from "@/components/ui/toaster";
import { ColorModeProvider } from "./color-mode";
import { QueryProvider } from "./query-client";

/**
 * Every client-side provider the app needs, mounted once in the root layout.
 *
 * Deliberately not here: SessionProvider. It needs an authenticated user, which
 * only a role layout has, and mounting it at the root would open a socket on
 * the login page.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
