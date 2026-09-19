import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/providers/app-providers";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes writes the theme class on <html> before paint, which the
    // server render cannot predict; suppressing the warning is the documented
    // way to allow that one attribute to differ.
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
