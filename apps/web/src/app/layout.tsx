import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppProviders } from "@/providers/app-providers";
import {
  COLOR_MODE_COOKIE,
  COLOR_MODE_SCRIPT,
  parseColorModePreference,
} from "@/lib/color-mode-cookie";
import "./fonts.css";

export const metadata: Metadata = {
  title: {
    default: "Ambatucode",
    template: "%s · Ambatucode",
  },
  description: "Offline-first LMS and coding assessment platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The chrome should follow whichever theme the user resolved to.
  // Matches bg.canvas in each theme: bone.300 on paper, brand.950 on dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ded8c6" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1c29" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The preference is kept in a cookie precisely so this render can read it.
  // Every page in the product is server rendered, so without it each one would
  // paint in the wrong theme until hydration corrected it.
  const preference = parseColorModePreference((await cookies()).get(COLOR_MODE_COOKIE)?.value);

  return (
    // The pre-paint script below may add `.dark` under the "system" preference,
    // which the server render cannot predict; suppressing the warning is the
    // documented way to allow that one attribute to differ.
    <html
      lang="en"
      className={preference === "dark" ? "dark" : undefined}
      style={preference === "system" ? undefined : { colorScheme: preference }}
      data-color-mode-preference={preference}
      suppressHydrationWarning
    >
      <head>
        {/* Resolves "follow my device" before the first paint. An explicit
            light or dark preference is already settled on <html> above, so for
            those this runs to completion having done nothing.

            A bare <script> with a string child, not dangerouslySetInnerHTML,
            which this codebase never uses, and not `next/script`, which defers
            even a beforeInteractive inline script into its own bootstrap — by
            which point the first frame has been painted in the wrong theme,
            which is the entire thing this is here to prevent. The source is a
            constant containing no markup characters, so React writes it out
            unchanged; see COLOR_MODE_SCRIPT. */}
        <script>{COLOR_MODE_SCRIPT}</script>
      </head>
      <body>
        <AppProviders colorModePreference={preference}>{children}</AppProviders>
      </body>
    </html>
  );
}
