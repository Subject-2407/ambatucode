import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageSession } from "@/lib/require-page-session";

export const dynamic = "force-dynamic";

// Named for the Root role, not for the App Router's root layout.
export default async function RootRoleLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession("ROOT");
  return <AppShell user={session.user}>{children}</AppShell>;
}
