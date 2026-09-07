import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageSession } from "@/lib/require-page-session";

export const dynamic = "force-dynamic";

export default async function CoderLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession("CODER");
  return <AppShell user={session.user}>{children}</AppShell>;
}
