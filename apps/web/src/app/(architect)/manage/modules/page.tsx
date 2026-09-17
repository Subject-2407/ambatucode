import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { ArchitectModulesScreen } from "./modules-screen";

export const metadata: Metadata = { title: "Modules" };
export const dynamic = "force-dynamic";

export default async function ArchitectModulesPage() {
  await requirePageSession("ARCHITECT");
  return <ArchitectModulesScreen />;
}
