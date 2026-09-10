import type { Metadata } from "next";
import { requirePageSession } from "@/lib/require-page-session";
import { ModulesScreen } from "./modules-screen";

export const metadata: Metadata = { title: "Modules" };
export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  await requirePageSession("CODER");
  return <ModulesScreen />;
}
