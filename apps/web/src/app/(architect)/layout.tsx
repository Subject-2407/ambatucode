import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageSession } from "@/lib/require-page-session";

export const dynamic = "force-dynamic";

export default async function ArchitectLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession("ARCHITECT");
  return <AppShell user={session.user}>{children}</AppShell>;
}
